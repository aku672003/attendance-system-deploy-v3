import time
import os
from pathlib import Path
from itsdangerous import URLSafeTimedSerializer

# Load .env if it exists
def load_env():
    base_dir = Path(__file__).resolve().parent
    env_path = base_dir / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    key_val = line.strip().split('=', 1)
                    if len(key_val) == 2:
                        os.environ[key_val[0]] = key_val[1]

def generate_gated_token(user_id=1):
    load_env()
    secret_key = os.getenv('ATTENDANCE_SECRET_KEY', 'hanuai-attendance-secret-shared-key')
    
    serializer = URLSafeTimedSerializer(secret_key)
    
    payload = {
        "user_id": user_id,
        "timestamp": int(time.time())
    }
    
    token = serializer.dumps(payload)
    
    print("-" * 60)
    print(f"Gated Access Token Generator (itsdangerous)")
    print("-" * 60)
    print(f"Payload: {payload}")
    print(f"Secret: {secret_key[:4]}...{secret_key[-4:]}")
    print(f"\nGENERATED TOKEN:\n{token}")
    print("-" * 60)
    print(f"\nGATED URL PREVIEW (Valid for 1h):")
    print(f"http://attendance.hanuai.com/api/gated-dashboard?token={token}")
    print("-" * 60)

if __name__ == "__main__":
    generate_gated_token()
