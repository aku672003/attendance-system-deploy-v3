import os
import json
import base64
from pywebpush import webpush, WebPushException
from dotenv import load_dotenv
from pathlib import Path

# Load env
base_dir = Path(__file__).resolve().parent.parent
load_dotenv(os.path.join(base_dir, '.env'))

vapid_public_key = os.getenv('VAPID_PUBLIC_KEY')
vapid_private_key = os.getenv('VAPID_PRIVATE_KEY')
vapid_claims_sub = os.getenv('VAPID_CLAIMS_SUB')

print(f"VAPID_PUBLIC_KEY: {vapid_public_key}")
print(f"VAPID_PRIVATE_KEY: {vapid_private_key[:50]}...")

# Try to parse the private key
try:
    # If it was saved with literal \n characters (common when writing to .env from python)
    if "\\n" in vapid_private_key:
        print("Found literal \\n in private key. Fixing...")
        fixed_key = vapid_private_key.replace("\\n", "\n")
        # Also remove quotes if they were added
        if fixed_key.startswith('"') and fixed_key.endswith('"'):
            fixed_key = fixed_key[1:-1]
        vapid_private_key = fixed_key

    # Dummy sub info (won't actually send, but tests key parsing)
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
    except WebPushException as ex:
        # We expect a 400 or something because the endpoint is fake, 
        # but if it fails to parse the key, it will throw a different error before making the request.
        print(f"WebPushException (Expected if key is valid): {ex}")
    except Exception as ex:
        print(f"FAILED TO PARSE KEY OR OTHER ERROR: {type(ex).__name__}: {ex}")

except Exception as e:
    print(f"Fixing script failed: {e}")
