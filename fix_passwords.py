import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.models import Employee

def fix_passwords():
    employees = Employee.objects.all()
    count = 0
    for emp in employees:
        pwd = emp.password
        if pwd.startswith('$2y$') or pwd.startswith('$2a$') or pwd.startswith('$2b$'):
            # It's a raw bcrypt hash. Django expects "bcrypt$" prefix or similar for identification
            # Actually, for BCryptPasswordHasher, the format is 'bcrypt$' + hash
            # Let's verify this hypothesis.
            new_pwd = f"bcrypt{pwd}" 
            # Wait, verify format: algorithm$identity$salt$hash? 
            # For bcrypt, Django stores: bcrypt$<iterations>$<salt+hash> usually?
            # actually BCryptPasswordHasher uses bcrypt library which returns the full string.
            # Django stores: algorithm$hash
            # So if algorithm is 'bcrypt', it stores 'bcrypt$$2y$...'
            
            # Let's try prepending 'bcrypt$'
            emp.password = f"bcrypt_sha256${pwd}" # No, standard bcrypt is usually just 'bcrypt'
            # Let's check settings. we used BCryptSHA256PasswordHasher and BCryptPasswordHasher.
            # BCryptPasswordHasher uses 'bcrypt'.
            
            emp.password = f"bcrypt${pwd}"
            emp.save()
            count += 1
            print(f"Fixed password for {emp.username}")
        elif not pwd.startswith('bcrypt$') and not pwd.startswith('pbkdf2_sha256$'):
             # Unknown format, maybe log it
             print(f"Skipping {emp.username}: {pwd[:10]}...")
    
    print(f"Fixed {count} passwords.")

if __name__ == '__main__':
    fix_passwords()
