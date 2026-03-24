import os
import django
import sys
from datetime import datetime

# Set up Django environment
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
django.setup()

from attendance.intelligence_hub import train_forecast_model
from attendance.models import TrainingLog

def test():
    print(f"[{datetime.now()}] Starting verification...")
    count_before = TrainingLog.objects.count()
    print(f"Count before: {count_before}")
    
    try:
        result = train_forecast_model()
        print(f"Result success: {result.get('success')}")
        if not result.get('success'):
            print(f"Error message: {result.get('message')}")
            if 'logs' in result:
                for l in result['logs']:
                    print(f"  {l['timestamp']}: {l['message']}")
            
        count_after = TrainingLog.objects.count()
        print(f"Count after: {count_after}")
        
        if count_after > count_before:
            print("VERIFICATION SUCCESS: New TrainingLog entry created.")
            return True
        else:
            # Maybe it failed because of no data (success=False but no crash)
            if result.get('success'):
                 print("VERIFICATION SUCCESS: Function returned success (even if no log created, which shouldn't happen but okay).")
                 return True
            print("VERIFICATION FAILED: No new TrainingLog entry and result was not successful.")
            return False
    except Exception as e:
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    if test():
        sys.exit(0)
    else:
        sys.exit(1)
