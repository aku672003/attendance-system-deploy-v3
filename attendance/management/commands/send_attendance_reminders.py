import logging
from django.core.management.base import BaseCommand
from django.utils import timezone
from attendance.models import Employee, AttendanceRecord, PushSubscription

logger = logging.getLogger(__name__)


def send_push_to_subscription(sub, title, body, icon='/static/assets/icon-192.png'):
    """Send a single Web Push notification using pywebpush."""
    try:
        from pywebpush import webpush, WebPushException
        from django.conf import settings

        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth,
            }
        }

        webpush(
            subscription_info=subscription_info,
            data=f'{{"title":"{title}","body":"{body}","icon":"{icon}"}}',
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_CLAIMS_SUB},
        )
    except Exception as e:
        logger.warning(f"Push failed for endpoint {sub.endpoint[:60]}: {e}")
        # If endpoint is gone (410 Gone), remove stale subscription
        if hasattr(e, 'response') and e.response is not None and e.response.status_code in (404, 410):
            sub.delete()
            logger.info("Removed stale push subscription.")


def run_attendance_reminders(phase='check_in'):
    """
    Send push notifications to employees who:
      - phase='check_in'  → haven't checked in yet today
      - phase='check_out' → checked in but haven't checked out
    Called by the scheduler.
    """
    now = timezone.localtime(timezone.now())
    today = now.date()

    if phase == 'check_in':
        # Employees with NO attendance record at all for today
        checked_in_ids = AttendanceRecord.objects.filter(date=today).values_list('employee_id', flat=True)
        employees = Employee.objects.filter(is_active=True).exclude(id__in=checked_in_ids)
        title = "⏰ Don't Forget to Check In!"
        body = "You haven't checked in yet today. Open the attendance portal to mark your attendance."
    else:  # check_out
        # Employees who checked in but have no check_out_time
        checked_in_no_out = AttendanceRecord.objects.filter(
            date=today,
            check_in_time__isnull=False,
            check_out_time__isnull=True,
        ).values_list('employee_id', flat=True)
        employees = Employee.objects.filter(is_active=True, id__in=checked_in_no_out)
        title = "⏰ Don't Forget to Check Out!"
        body = "You're checked in but haven't checked out yet. Please mark your check-out before you leave."

    sent_count = 0
    for employee in employees:
        subs = PushSubscription.objects.filter(employee=employee)
        for sub in subs:
            send_push_to_subscription(sub, title, body)
            sent_count += 1

    logger.info(f"[{phase}] Push notifications sent to {sent_count} subscription(s) for {len(employees)} employee(s).")
    return sent_count


class Command(BaseCommand):
    help = 'Send attendance check-in or check-out push reminders'

    def add_arguments(self, parser):
        parser.add_argument(
            '--phase',
            type=str,
            default='check_in',
            choices=['check_in', 'check_out'],
            help='Which reminder to send: check_in or check_out',
        )

    def handle(self, *args, **options):
        phase = options['phase']
        count = run_attendance_reminders(phase)
        self.stdout.write(self.style.SUCCESS(f"Sent {count} push notification(s) for phase={phase}"))
