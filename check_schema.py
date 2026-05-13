import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

def check_tasks_schema():
    with connection.cursor() as cursor:
        cursor.execute("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'tasks'")
        columns = cursor.fetchall()
        for col in columns:
            print(col)

if __name__ == "__main__":
    check_tasks_schema()
