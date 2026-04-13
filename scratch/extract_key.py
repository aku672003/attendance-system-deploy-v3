import os
import base64
from cryptography.hazmat.primitives import serialization
from dotenv import load_dotenv

load_dotenv('.env')
priv_val = os.getenv('VAPID_PRIVATE_KEY')

if isinstance(priv_val, str):
    if "\\n" in priv_val:
        priv_val = priv_val.replace("\\n", "\n")
    priv_val = priv_val.strip('"\'')

print(f"Loading key:\n{priv_val}")

try:
    # Try to load as PEM
    key = serialization.load_pem_private_key(priv_val.encode(), password=None)
    # Extract raw 32 bytes
    raw = key.private_numbers().private_value.to_bytes(32, 'big')
    b64 = base64.urlsafe_b64encode(raw).rstrip(b'=').decode()
    print(f"SUCCESS! Raw B64: {b64}")
except Exception as e:
    print(f"FAILED to extract: {e}")
