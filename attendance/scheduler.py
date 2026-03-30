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
    from attendance.management.commands.train_forecast_model import run_train_forecast_model
    from attendance.management.commands.send_attendance_reminders import run_attendance_reminders

    scheduler = BackgroundScheduler()
    
    # Job 1: Auto-mark absent employees at 6:00 PM IST
    scheduler.add_job(
        run_auto_mark_absent,
        trigger=CronTrigger(hour=18, minute=0, timezone='Asia/Kolkata'),
        id='auto_mark_absent',
        name='Mark absent employees daily at 6 PM IST',
        replace_existing=True,
    )

    # Job 2: Train forecast model at 6:30 PM IST (DEPRECATED - Moved to System Cron)
    # scheduler.add_job(
    #     run_train_forecast_model,
    #     trigger=CronTrigger(hour=18, minute=30, timezone='Asia/Kolkata'),
    #     id='train_forecast_model',
    #     name='Train forecast model daily at 6:30 PM IST',
    #     replace_existing=True,
    # )

    # Job 3: Check-in reminder at 9:30 AM IST for employees who haven't checked in
    scheduler.add_job(
        lambda: run_attendance_reminders('check_in'),
        trigger=CronTrigger(hour=9, minute=30, timezone='Asia/Kolkata'),
        id='checkin_reminder',
        name='Remind employees to check in at 9:30 AM IST',
        replace_existing=True,
    )

    # Job 4: Check-out reminder at 5:30 PM IST for employees who haven't checked out
    scheduler.add_job(
        lambda: run_attendance_reminders('check_out'),
        trigger=CronTrigger(hour=17, minute=30, timezone='Asia/Kolkata'),
        id='checkout_reminder',
        name='Remind employees to check out at 5:30 PM IST',
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started: auto-absent (18:00), check-in reminder (09:30), check-out reminder (17:30). [Model Training moved to System Cron]")

