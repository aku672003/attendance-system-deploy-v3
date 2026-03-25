import os
import django
import sys
import traceback

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

try:
    from attendance.intelligence_hub import train_forecast_model
    result = train_forecast_model()
    with open('tmp/error_log.txt', 'w') as f:
        f.write(str(result))
except Exception as e:
    with open('tmp/error_log.txt', 'w') as f:
        f.write(traceback.format_exc())
