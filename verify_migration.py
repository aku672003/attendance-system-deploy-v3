import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.models import (
    Employee, 
    EmployeeProfile, 
    OfficeLocation, 
    DepartmentOfficeAccess, 
    AttendanceRecord, 
    EmployeeRequest, 
    EmployeeDocument
)

def log(msg):
    with open("verification.log", "a") as f:
        f.write(str(msg) + "\n")
    print(msg, flush=True)

def verify():
    try:
        log(f"OfficeLocation: {OfficeLocation.objects.count()}")
        log(f"Employee: {Employee.objects.count()}")
        log(f"EmployeeProfile: {EmployeeProfile.objects.count()}")
        log(f"DepartmentOfficeAccess: {DepartmentOfficeAccess.objects.count()}")
        log(f"EmployeeDocument: {EmployeeDocument.objects.count()}")
        log(f"AttendanceRecord: {AttendanceRecord.objects.count()}")
        log(f"EmployeeRequest (WFH): {EmployeeRequest.objects.count()}")

        try:
            admin = Employee.objects.get(role='admin')
            log(f"Admin found: {admin.username} ({admin.email})")
        except Employee.DoesNotExist:
            log("Admin user NOT found!")
        except Employee.MultipleObjectsReturned:
            log("Multiple admin users found!")
    except Exception as e:
        import traceback
        log(f"Error: {e}")
        traceback.print_exc(file=open("verification.log", "a"))

if __name__ == '__main__':
    verify()
