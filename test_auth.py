import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from django.contrib.auth.hashers import check_password, identify_hasher
from attendance.models import Employee

def log(msg):
    with open("auth_test.log", "a") as f:
        f.write(str(msg) + "\n")
    print(msg, flush=True)

def test_login():
    try:
        user = Employee.objects.get(username='admin')
        log(f"User: {user.username}")
        log(f"Stored Hash: {user.password}")
        
        try:
            hasher = identify_hasher(user.password)
            log(f"Identified Hasher: {hasher.algorithm}")
        except ValueError as e:
             log(f"Hasher Error: {e}")
             return

        if check_password('password', user.password):
             log("SUCCESS: Password is 'password'")
        elif check_password('12345678', user.password):
             log("SUCCESS: Password is '12345678'")
        elif check_password('admin', user.password):
             log("SUCCESS: Password is 'admin'")
        else:
             log("INFO: Password is valid format but unknown plain text.")

    except Employee.DoesNotExist:
        log("User not found")

if __name__ == '__main__':
    test_login()
