import os
import django
from django.conf import settings

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

db_settings = settings.DATABASES['default']
print(f"ENGINE: {db_settings['ENGINE']}")
print(f"NAME: {db_settings['NAME']}")
print(f"USER: {db_settings.get('USER')}")
print(f"HOST: {db_settings.get('HOST')}")
print(f"PORT: {db_settings.get('PORT')}")

from django.db import connections
from django.db.utils import OperationalError

db_conn = connections['default']
try:
    db_conn.cursor()
    print('Connection Successful')
except OperationalError as e:
    print(f'Connection Failed: {e}')
except Exception as e:
    print(f'An error occurred: {e}')
