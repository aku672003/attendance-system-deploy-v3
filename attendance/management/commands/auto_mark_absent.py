from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import datetime
from attendance.models import Employee, AttendanceRecord

class Command(BaseCommand):
    help = 'Automatically mark employees absent if they haven\'t checked in for the current day'

    def add_arguments(self, parser):
        parser.add_argument('--date', type=str, help='Target date in YYYY-MM-DD format')

    def handle(self, *args, **options):
        now = timezone.localtime(timezone.now())
        
        if options['date']:
            target_date = datetime.strptime(options['date'], '%Y-%m-%d').date()
        else:
            # By default, mark for the current day. 
            # If run at 12:01 AM on the 23rd, it marks for the 23rd.
            target_date = now.date()
        
        self.stdout.write(f"Running auto-absent for date: {target_date}")
        
        # Get all active employees
        active_employees = Employee.objects.filter(is_active=True)
        
        absent_count = 0
        for employee in active_employees:
            # Check if record already exists for this date
            exists = AttendanceRecord.objects.filter(
                employee=employee,
                date=target_date
            ).exists()
            
            if not exists:
                AttendanceRecord.objects.create(
                    employee=employee,
                    date=target_date,
                    status='absent',
                    type='office' # default type for absent
                )
                absent_count += 1
        
        self.stdout.write(self.style.SUCCESS(f"Successfully marked {absent_count} employees as absent for {target_date}"))
