import os
import django
import sys

# Set up Django environment
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings') # Assuming the project name is attendance_system
django.setup()

from attendance.intelligence_hub import train_forecast_model

try:
    print("Starting model training verification...")
    result = train_forecast_model()
    if result.get('success'):
        print("Success! Model trained successfully.")
        print("Summary:", result.get('summary'))
    else:
        print("Training failed with message:", result.get('message'))
        if 'logs' in result:
             for log in result['logs']:
                 print(f"[{log['timestamp']}] {log['message']}")
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"An error occurred during verification: {e}")
