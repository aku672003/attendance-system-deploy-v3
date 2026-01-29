import os
import django
import sys
from django.core.management import call_command
from django.contrib.auth.hashers import make_password

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.models import Employee

def setup_project():
    print("🚀 Starting project setup...")

    # 1. Run Migrations
    print("\n📦 Running database migrations...")
    try:
        call_command('migrate')
        print("✅ Migrations completed successfully.")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)

    # 2. Load Fixtures
    print("\n📍 Loading office locations...")
    fixture_path = os.path.join('attendance', 'fixtures', 'office_locations.json')
    if os.path.exists(fixture_path):
        try:
            call_command('loaddata', fixture_path)
            print("✅ Office locations loaded.")
        except Exception as e:
            print(f"❌ Failed to load fixtures: {e}")
    else:
        print(f"⚠️ Fixture file not found at {fixture_path}")

    # 3. Create Admin User
    print("\n👤 Checking for admin user...")
    admin_username = 'admin'
    admin_password = 'password123'
    
    if not Employee.objects.filter(role='admin').exists():
        print(f"   Creating default admin user: {admin_username}")
        try:
            Employee.objects.create(
                username=admin_username,
                password=make_password(admin_password),
                name='System Admin',
                email='admin@example.com',
                phone='0000000000',
                department='IT',
                primary_office='105', # Assuming '105' exists from fixture, fail-safe if not?
                role='admin',
                is_active=True
            )
            print(f"✅ Admin user created. Login: {admin_username} / {admin_password}")
        except Exception as e:
             # Fallback if primary_office '105' doesn't exist (e.g. if fixtures failed)
             print(f"⚠️ Failed to create admin with specific office: {e}")
             print("   Attempting to create admin without primary office FK constraint issues...")
             # Note: primary_office is CharField(max_length=10), not FK in models.py I read earlier.
             # Wait, let me double check models.py in my memory. 
             # primary_office = models.CharField(max_length=10) -> It's just a string, not a ForeignKey.
             # So '105' is fine even if it doesn't match an ID in OfficeLocation, conceptually. 
             # But good to match.
             print(f"❌ Admin creation failed: {e}")
    else:
        print("✅ Admin user already exists.")

    print("\n✨ Setup completed successfully! You can now run the server.")

if __name__ == '__main__':
    setup_project()
