import hmac
import hashlib
from datetime import datetime
import requests

def test_token_verification():
    # Configuration
    # Note: Use the same secret key as defined in settings.py
    SECRET_KEY = "hanuai-attendance-secret-shared-key"
    BASE_URL = "http://127.0.0.1:8000/api" # Adjust if running on a different port
    
    print("--- Starting Backend Token Verification Test ---")
    
    # 1. Generate valid token
    secret = SECRET_KEY.encode()
    message = datetime.now().strftime("%Y-%m-%d").encode()
    valid_token = hmac.new(secret, message, hashlib.sha256).hexdigest()
    
    print(f"Generated Valid Token: {valid_token}")
    
    # 2. Test valid token
    print("\nTesting Valid Token...")
    try:
        response = requests.post(f"{BASE_URL}/verify-token", json={"token": valid_token})
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing valid token: {e}")

    # 3. Test invalid token
    print("\nTesting Invalid Token...")
    try:
        invalid_token = "i-am-an-invalid-token"
        response = requests.post(f"{BASE_URL}/verify-token", json={"token": invalid_token})
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing invalid token: {e}")

    # 4. Test missing token
    print("\nTesting Missing Token...")
    try:
        response = requests.post(f"{BASE_URL}/verify-token", json={})
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing missing token: {e}")

if __name__ == "__main__":
    test_token_verification()
