import os
import django
import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.models import Employee

users = Employee.objects.filter(name__icontains='akshit')
for u in users:
    print(f"Found: {u.username}, id: {u.id}, Managers count: {u.managers.count()}")
    for m in u.managers.all():
        print(f"  Manager: {m.name}")
