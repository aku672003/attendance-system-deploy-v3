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
    Returns (True, data) or (False, error_message).
    """
    if not token:
        return False, "Token Missing"

    serializer = get_serializer()
    try:
        data = serializer.loads(token, max_age=60)
        if not isinstance(data, dict) or 'user_id' not in data or 'timestamp' not in data:
            return False, "Invalid Token Payload"
        return True, data
    except SignatureExpired:
        return False, "Token Expired"
    except BadSignature:
        return False, "Invalid Token"
    except Exception as e:
        return False, str(e)

def require_valid_token(view_func):
    """
    Decorator for Django views that requires a valid, signed token.
    Token must be passed as a GET parameter 'token'.
    If invalid, missing or expired, it raises Http404 as requested.
    """
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        token = request.GET.get('token')
        success, result = validate_gated_token(token)
        
        if not success:
            # Explicitly call the custom 404 view to ensure correct template is used
            from .views import error_404_view
            return error_404_view(request)

        return view_func(request, *args, **kwargs)

    return _wrapped_view
