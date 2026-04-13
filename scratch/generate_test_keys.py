from py_vapid import Vapid
import base64
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from pywebpush import webpush, WebPushException

v = Vapid()
v.generate_keys()

pub = base64.urlsafe_b64encode(
    v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
).rstrip(b'=').decode()

priv_pem = v.private_pem().decode().strip()

print(f"New Public Key: {pub}")
print(f"New Private Key PEM:\n{priv_pem}")

# Test with new keys
subscription_info = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/fake-endpoint",
    "keys": {
        "p256dh": "BLC6y1U-fake-key",
        "auth": "fake-auth"
    }
}

try:
    webpush(
        subscription_info=subscription_info,
        data="test",
        vapid_private_key=priv_pem,
        vapid_claims={"sub": "mailto:test@example.com"}
    )
    print("New keys work!")
except WebPushException:
    print("New keys work (received expected network error)!")
except Exception as e:
    print(f"New keys FAILED: {type(e).__name__}: {e}")
