import time
from functools import wraps
from django.conf import settings
from django.http import HttpResponseForbidden, Http404
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

def get_serializer():
    """Create a serializer using the shared secret key."""
    secret = getattr(settings, "ATTENDANCE_SECRET_KEY", "hanuai-attendance-secret-shared-key")
    return URLSafeTimedSerializer(secret)

def validate_gated_token(token):
    """
    Validates an itsdangerous token.
    Tries the configured ATTENDANCE_SECRET_KEY first,
    then falls back to the default shared key for compatibility.
    Returns (True, data) or (False, error_message).
    """
    if not token:
        return False, "Token Missing"

    # List of secrets to try: [Configured Secret, Default Fallback]
    configured_secret = getattr(settings, "ATTENDANCE_SECRET_KEY", None)
    default_secret = "hanuai-attendance-secret-shared-key"
    
    secrets_to_try = []
    if configured_secret:
        secrets_to_try.append(configured_secret)
    if default_secret not in secrets_to_try:
        secrets_to_try.append(default_secret)

    last_error = "Invalid Token"
    for i, secret in enumerate(secrets_to_try):
        serializer = URLSafeTimedSerializer(secret)
        try:
            # Token is now valid for 1 hour for better security/ux balance
            data = serializer.loads(token, max_age=3600)
            if not isinstance(data, dict) or 'user_id' not in data or 'timestamp' not in data:
                print(f"[SECURITY DEBUG] Attempt {i+1} failed: Invalid Payload Structure")
                return False, "Invalid Token Payload"
            return True, data
        except SignatureExpired:
            print(f"[SECURITY DEBUG] Attempt {i+1} failed: Token Expired (max_age=3600s)")
            return False, "Token Expired"
        except BadSignature:
            print(f"[SECURITY DEBUG] Attempt {i+1} failed: Bad Signature (Secret Mismatch)")
            last_error = "Invalid Token"
            continue
        except Exception as e:
            print(f"[SECURITY DEBUG] Attempt {i+1} failed: Unexpected Error: {str(e)}")
            last_error = str(e)
            continue
            
    print(f"[SECURITY DEBUG] Token Validation Final Response: {last_error}")
    return False, last_error

def require_valid_token(view_func):
    """
    Decorator for Django views that requires a valid, signed token.
    Token must be passed as a GET parameter 'token'.
    Used for the initial SPA page load protection.
    """
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        token = request.GET.get('token')
        
        # Strictly require token presence for gated access
        if not token:
            from .views import error_403_view
            return error_403_view(request)
            
        success, result = validate_gated_token(token)
        
        if not success:
            from .views import error_403_view
            return error_403_view(request, message=result)

        return view_func(request, *args, **kwargs)

    return _wrapped_view

def require_gated_token_api(view_func):
    """
    API version of the gated token decorator.
    Checks for the token in the 'X-Gated-Token' header or 'token' query param.
    Returns JSON error response on failure.
    """
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        from django.http import JsonResponse
        # Check priority: Header > GET param > POST param > JSON body
        token = request.headers.get('X-Gated-Token') or request.GET.get('token')
        
        if not token and request.method in ['POST', 'PUT', 'PATCH']:
            token = request.POST.get('token')
            if not token and hasattr(request, 'data') and isinstance(request.data, dict):
                token = request.data.get('token')
        
        if not token:
            return JsonResponse({'success': False, 'message': 'Gated access required'}, status=403)
            
        success, result = validate_gated_token(token)
        if not success:
            return JsonResponse({'success': False, 'message': f'Invalid token: {result}'}, status=403)
            
        return view_func(request, *args, **kwargs)

    return _wrapped_view

