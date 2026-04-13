"""
Auto-generate VAPID keys and write to .env on first server start.
Called from apps.py ready() if VAPID_PUBLIC_KEY is not yet set.
"""
import os
import logging
logger = logging.getLogger(__name__)


def ensure_vapid_keys():
    """
    If VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY are not in .env, generate them
    and append them to the .env file so they persist across restarts.
    """
    from django.conf import settings
    if getattr(settings, 'VAPID_PUBLIC_KEY', ''):
        return  # Already configured

    try:
        from py_vapid import Vapid
        import base64
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from pathlib import Path

        v = Vapid()
        v.generate_keys()

        pub = base64.urlsafe_b64encode(
            v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        ).rstrip(b'=').decode()

        # Extract raw private key bytes (32 bytes for P-256) and save as base64url
        # This format is much easier to store in .env and more reliably parsed by pywebpush
        priv_raw = v.private_key.private_numbers().private_value.to_bytes(32, 'big')
        priv_b64 = base64.urlsafe_b64encode(priv_raw).rstrip(b'=').decode()

        # Write keys to .env
        env_path = Path(settings.BASE_DIR) / '.env'
        with open(env_path, 'a') as f:
            f.write(f'\nVAPID_PUBLIC_KEY={pub}\n')
            f.write(f'VAPID_PRIVATE_KEY={priv_b64}\n')
            f.write(f'VAPID_CLAIMS_SUB=mailto:{settings.DEFAULT_FROM_EMAIL}\n')

        # Update runtime settings immediately
        settings.VAPID_PUBLIC_KEY = pub
        settings.VAPID_PRIVATE_KEY = priv_b64
        settings.VAPID_CLAIMS_SUB = f'mailto:{settings.DEFAULT_FROM_EMAIL}'

        logger.info('[Push] VAPID keys generated and saved to .env')
    except Exception as e:
        logger.warning(f'[Push] Could not generate VAPID keys: {e}')
