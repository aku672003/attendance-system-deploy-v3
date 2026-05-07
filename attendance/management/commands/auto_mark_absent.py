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

        # Also mark those who checked in but didn't check out as 'absent'
        # If it's today, we only mark as absent if it's past 11 PM (to allow late workers/surveyors)
        # Otherwise, we mark all unclosed records from past days.
        missed_checkout_qs = AttendanceRecord.objects.filter(
            check_in_time__isnull=False,
            check_out_time__isnull=True
        ).exclude(status__in=['absent', 'leave'])

        if target_date < now.date():
            # For past dates, mark all unclosed records
            missed_checkout_count = missed_checkout_qs.filter(date=target_date).update(
                status='absent',
                notes="Absent marked: Forgot to check out"
            )
        else:
            # For today, only mark if it's very late (e.g., past 22:00 / 10 PM)
            if now.hour >= 22:
                missed_checkout_count = missed_checkout_qs.filter(date=target_date).update(
                    status='absent',
                    notes="Absent marked: Forgot to check out (Late night cutoff)"
                )
            else:
                # Still catch any missed checkouts from YESTERDAY that were missed by previous runs
                missed_checkout_count = missed_checkout_qs.filter(date__lt=target_date).update(
                    status='absent',
                    notes="Absent marked: Forgot to check out (Catch-up run)"
                )

        msg = f"Marked {absent_count} employee(s) as Absent (no check-in) and {missed_checkout_count} as Absent (missed check-out) for {target_date}"
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
    
    # Also mark those who checked in but didn't check out as 'absent'
    # Catch-up for any unclosed records from past days
    missed_checkout_count = AttendanceRecord.objects.filter(
        date__lt=target_date,
        check_in_time__isnull=False,
        check_out_time__isnull=True
    ).exclude(status__in=['absent', 'leave']).update(
        status='absent',
        notes="Absent marked: Forgot to check out (Previous day)"
    )

    # For today, only mark if it's very late (Scheduler currently runs at 6 PM, so this will skip today's)
    if now.hour >= 22:
        today_missed = AttendanceRecord.objects.filter(
            date=target_date,
            check_in_time__isnull=False,
            check_out_time__isnull=True
        ).exclude(status__in=['absent', 'leave']).update(
            status='absent',
            notes="Absent marked: Forgot to check out (Today, late night)"
        )
        missed_checkout_count += today_missed

    logger.info(f"[Scheduler] Marked {absent_count} employee(s) as Absent (no check-in) and {missed_checkout_count} as Absent (missed check-out) for {target_date}")
