import os
import json
import base64
from pywebpush import webpush, WebPushException
from dotenv import load_dotenv
from pathlib import Path

# Load env
base_dir = Path(__file__).resolve().parent.parent
load_dotenv(os.path.join(base_dir, '.env'))

vapid_private_key = os.getenv('VAPID_PRIVATE_KEY')
vapid_claims_sub = os.getenv('VAPID_CLAIMS_SUB')

print(f"Original VAPID_PRIVATE_KEY: {vapid_private_key[:50]}...")

# Logic from views.py
if isinstance(vapid_private_key, str):
    if "\\n" in vapid_private_key:
        print("Fixing \\n...")
        vapid_private_key = vapid_private_key.replace("\\n", "\n")
    vapid_private_key = vapid_private_key.strip('"\'')

print(f"Cleaned VAPID_PRIVATE_KEY:\n{vapid_private_key}")

# Dummy sub info
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
        vapid_private_key=vapid_private_key,
        vapid_claims={"sub": vapid_claims_sub}
    )
    print("Success! (Or at least it didn't fail on key parsing)")
except WebPushException as ex:
    print(f"WebPushException (Expected): {ex}")
except Exception as ex:
    print(f"FAILED: {type(ex).__name__}: {ex}")
