from py_vapid import Vapid
import base64

v = Vapid()
v.generate_keys()

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
pub_bytes = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
public_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b'=').decode()

private_pem = v.private_pem().decode().strip()

print("=== VAPID KEYS ===")
print("PUBLIC_KEY=" + public_b64)
print("PRIVATE_KEY_PEM=" + private_pem)
