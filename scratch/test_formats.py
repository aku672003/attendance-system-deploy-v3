from py_vapid import Vapid
import base64
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, NoEncryption
from pywebpush import webpush, WebPushException

v = Vapid()
v.generate_keys()

# Format 1: PEM
priv_pem = v.private_pem().decode().strip()

# Format 2: Raw Base64URL
# v.private_key is an EllipticCurvePrivateKey
# We want the 32 byte private value
priv_raw = v.private_key.private_numbers().private_value.to_bytes(32, 'big')
priv_b64 = base64.urlsafe_b64encode(priv_raw).rstrip(b'=').decode()

print(f"B64 Private: {priv_b64}")

subscription_info = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/fake-endpoint",
    "keys": {
        "p256dh": "BLC6y1U-fake-key",
        "auth": "fake-auth"
    }
}

print("Testing B64 format...")
try:
    webpush(
        subscription_info=subscription_info,
        data="test",
        vapid_private_key=priv_b64,
        vapid_claims={"sub": "mailto:test@example.com"}
    )
    print("B64 format works!")
except WebPushException:
    print("B64 format works (network error)!")
except Exception as e:
    print(f"B64 FAILED: {type(e).__name__}: {e}")

print("\nTesting PEM format...")
try:
    webpush(
        subscription_info=subscription_info,
        data="test",
        vapid_private_key=priv_pem,
        vapid_claims={"sub": "mailto:test@example.com"}
    )
    print("PEM format works!")
except WebPushException:
    print("PEM format works (network error)!")
except Exception as e:
    print(f"PEM FAILED: {type(e).__name__}: {e}")
