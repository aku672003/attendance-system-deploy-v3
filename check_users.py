import os
import django
import sys

# Set up Django environment
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.models import Employee

def list_users():
    users = Employee.objects.all()
    if users.count() == 0:
        print("No users found.")
    else:
        print(f"Found {users.count()} users:")
        for user in users:
            print(f"Username: {user.username}, Role: {user.role}, Is Active: {user.is_active}")

if __name__ == '__main__':
    list_users()
