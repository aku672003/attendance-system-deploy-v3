import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

# Module-level flag to prevent double-start
_scheduler_started = False


def start():
    """Start the APScheduler background scheduler for auto-absent marking."""
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    from attendance.management.commands.auto_mark_absent import run_auto_mark_absent

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_auto_mark_absent,
        trigger=CronTrigger(hour=18, minute=0, timezone='Asia/Kolkata'),
        id='auto_mark_absent',
        name='Mark absent employees daily at 6 PM IST',
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Auto-absent scheduler started (runs daily at 18:00 IST)")
