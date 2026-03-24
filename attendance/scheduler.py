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

    scheduler = BackgroundScheduler()
    
    # Job 1: Auto-mark absent employees at 6:00 PM IST
    scheduler.add_job(
        run_auto_mark_absent,
        trigger=CronTrigger(hour=18, minute=0, timezone='Asia/Kolkata'),
        id='auto_mark_absent',
        name='Mark absent employees daily at 6 PM IST',
        replace_existing=True,
    )

    # Job 2: Train forecast model at 6:30 PM IST (after data is finalized)
    scheduler.add_job(
        run_train_forecast_model,
        trigger=CronTrigger(hour=18, minute=30, timezone='Asia/Kolkata'),
        id='train_forecast_model',
        name='Train forecast model daily at 6:30 PM IST',
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started with auto-absent (18:00) and model training (18:30) jobs.")
