import logging
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import datetime, timedelta
from attendance.models import Employee, AttendanceRecord, Holiday
from attendance.views import _trigger_push_notification

def run_attendance_reminders(reminder_type=None):
    """
    Core logic for reminders, callable by both Management Command and Scheduler.
    """
    now_ist = timezone.localtime(timezone.now())
    today = now_ist.date()
    
    # 1. 9 AM Check-in Reminder
    if reminder_type == 'check_in' or (now_ist.hour == 9 and now_ist.minute == 0):
        if Holiday.is_date_working(today):
            employees = Employee.objects.filter(is_active=True).exclude(role='admin')
            for emp in employees:
                checked_in = AttendanceRecord.objects.filter(
                    employee=emp, 
                    date=today,
                    check_in_time__isnull=False
                ).exclude(status__in=['absent', 'leave']).exists()
                
                if not checked_in:
                    _trigger_push_notification(
                        emp, 
                        "9 AM Reminder 📍", 
                        "Good morning! Don't forget to mark your attendance for today.",
                        link="/"
                    )

    # 2. 8.95 Hours Check-out Reminder
    if reminder_type == 'check_out' or reminder_type is None:
        active_records = AttendanceRecord.objects.filter(
            date=today,
            check_in_time__isnull=False,
            check_out_time__isnull=True
        ).exclude(status__in=['absent', 'leave'])

        for record in active_records:
            try:
                check_in_t = datetime.strptime(str(record.check_in_time), '%H:%M:%S').time()
                check_in_dt = timezone.make_aware(datetime.combine(record.date, check_in_t))
                elapsed_hours = (now_ist - check_in_dt).total_seconds() / 3600
                
                # If specific 'check_out' type requested (from scheduler), or natural 8.95 mark
                if reminder_type == 'check_out' or (8.95 <= elapsed_hours < 8.98):
                    _trigger_push_notification(
                        record.employee,
                        "Shift Completion Reminder 🏃",
                        f"You have completed {round(elapsed_hours, 2)} hours. Please wrap up your tasks and check out.",
                        link="/"
                    )
            except Exception:
                pass

class Command(BaseCommand):
    help = 'Send 9 AM check-in reminders and 8.95 hours check-out reminders'

    def handle(self, *args, **options):
        self.stdout.write("Processing reminders...")
        run_attendance_reminders()
        self.stdout.write(self.style.SUCCESS('Reminders processed.'))
