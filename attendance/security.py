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

from .models import Employee

def require_valid_token(view_func):
    """
    Decorator for Django views that requires a valid, signed token.
    Token must be passed as a GET parameter 'token'.
    Used for the initial SPA page load protection.
    """
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        token = request.GET.get('token')
        
        host = request.get_host()
        is_development = '127.0.0.1' in host or 'localhost' in host

        # Strictly require token presence for gated access, except in development
        if is_development:
            # On development, we allow access even without a token or with a mismatched one
            # to support standard login/session alongside gated token tests.
            if token:
                success, result = validate_gated_token(token)
                if success:
                    user_id = result.get('user_id')
                    username = result.get('username')
                    employee = Employee.objects.filter(username=username).first() if username else None
                    if not employee and user_id:
                        employee = Employee.objects.filter(id=user_id).first()
                    if employee:
                        # On local, only bind if token user is admin or matches the requested user
                        requested_id = request.GET.get('user_id') or request.GET.get('employee_id')
                        if employee.role == 'admin' or (requested_id and str(employee.id) == str(requested_id)):
                            request.user = employee
            return view_func(request, *args, **kwargs)

        if not token:
            from .views import error_403_view
            return error_403_view(request, message="Gated Token Missing")
            
        success, result = validate_gated_token(token)
        
        if not success:
            from .views import error_403_view
            return error_403_view(request, message=result)

        # Extraction and Attachment: Bind the correct user from token to request
        user_id = result.get('user_id')
        username = result.get('username')
        employee = None
        
        if username:
            employee = Employee.objects.filter(username=username).first()
        if not employee and user_id:
            employee = Employee.objects.filter(id=user_id).first()
            
        if employee:
            request.user = employee
        else:
            from .views import error_403_view
            return error_403_view(request, message="User associated with token not found")

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
        
        host = request.get_host()
        is_development = '127.0.0.1' in host or 'localhost' in host

        if is_development:
            # On local development, if a token is present, we try to bind the user
            # but we don't block the request if the token is invalid or missing.
            if token:
                success, result = validate_gated_token(token)
                if success:
                    user_id = result.get('user_id')
                    username = result.get('username')
                    employee = Employee.objects.filter(username=username).first() if username else None
                    if not employee and user_id:
                        employee = Employee.objects.filter(id=user_id).first()
                    if employee:
                        # On local, only bind if token user is admin or matches the requested user
                        # Check multiple possible ID params
                        req_id = request.GET.get('user_id') or request.GET.get('employee_id') or \
                                 request.POST.get('user_id') or request.POST.get('employee_id')
                        
                        if employee.role == 'admin' or (req_id and str(employee.id) == str(req_id)) or not req_id:
                            request.user = employee
            return view_func(request, *args, **kwargs)

        if not token:
            return JsonResponse({'success': False, 'message': 'Gated access required'}, status=403)
            
        success, result = validate_gated_token(token)
        if not success:
            return JsonResponse({'success': False, 'message': f'Invalid token: {result}'}, status=403)
            
        # Extraction and Attachment: Bind the correct user from token to request
        user_id = result.get('user_id')
        username = result.get('username')
        employee = None
        
        if username:
            employee = Employee.objects.filter(username=username).first()
        if not employee and user_id:
            employee = Employee.objects.filter(id=user_id).first()

        if employee:
            request.user = employee
        else:
             return JsonResponse({'success': False, 'message': 'User associated with token not found or invalid payload'}, status=403)

        return view_func(request, *args, **kwargs)

    return _wrapped_view

