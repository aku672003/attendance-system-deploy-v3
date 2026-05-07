from django.core.management.base import BaseCommand
from attendance.models import AttendanceRecord
from django.db.models import Q

class Command(BaseCommand):
    help = 'Fix attendance records with impossible working hours (capping at 14h)'

    def handle(self, *args, **options):
        # Find all records with total_hours > 14
        buggy_records = AttendanceRecord.objects.filter(total_hours__gt=14.0)
        
        count = buggy_records.count()
        self.stdout.write(f"Found {count} records with more than 14 working hours.")

        if count > 0:
            for record in buggy_records:
                self.stdout.write(f"Fixing Record ID {record.id} for {record.employee.name} on {record.date}: {record.total_hours}h -> 14.0h")
                record.total_hours = 14.0
                record.notes = (record.notes or "") + " [System Fix: Capped excessive hours]"
                record.save()
            
            self.stdout.write(self.style.SUCCESS(f"Successfully fixed {count} records."))
        else:
            self.stdout.write(self.style.SUCCESS("No buggy records found."))
