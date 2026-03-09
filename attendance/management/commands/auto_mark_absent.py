from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import datetime
from attendance.models import Employee, AttendanceRecord

import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Mark employees as Absent if they have not checked in for a given day'

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            type=str,
            help='Target date in YYYY-MM-DD format (defaults to today in Asia/Kolkata)',
        )

    def handle(self, *args, **options):
        now = timezone.localtime(timezone.now())

        if options.get('date'):
            target_date = datetime.strptime(options['date'], '%Y-%m-%d').date()
        else:
            target_date = now.date()

        self.stdout.write(f"Running auto-absent for date: {target_date}")

        # All active employees
        active_employees = Employee.objects.filter(is_active=True)

        absent_count = 0
        for employee in active_employees:
            # Skip if any attendance record already exists (present, leave, wfh, etc.)
            already_has_record = AttendanceRecord.objects.filter(
                employee=employee,
                date=target_date,
            ).exists()

            if not already_has_record:
                AttendanceRecord.objects.create(
                    employee=employee,
                    date=target_date,
                    status='absent',
                    type='office',
                    check_in_time=None,
                    check_out_time=None,
                )
                absent_count += 1

        msg = f"Marked {absent_count} employee(s) as Absent for {target_date}"
        self.stdout.write(self.style.SUCCESS(msg))
        logger.info(msg)


def run_auto_mark_absent():
    """Standalone function called by the scheduler (outside management command context)."""
    import django
    django.setup()

    now = timezone.localtime(timezone.now())
    target_date = now.date()

    active_employees = Employee.objects.filter(is_active=True)

    absent_count = 0
    for employee in active_employees:
        already_has_record = AttendanceRecord.objects.filter(
            employee=employee,
            date=target_date,
        ).exists()

        if not already_has_record:
            AttendanceRecord.objects.create(
                employee=employee,
                date=target_date,
                status='absent',
                type='office',
                check_in_time=None,
                check_out_time=None,
            )
            absent_count += 1

    logger.info(f"[Scheduler] Marked {absent_count} employee(s) as Absent for {target_date}")
