from django.core.management.base import BaseCommand
from django.utils import timezone
from attendance.models import TrainingLog
from attendance.intelligence_hub import train_forecast_model
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Train the attendance forecast model'

    def handle(self, *args, **options):
        self.stdout.write("Starting automated model training...")
        
        result = train_forecast_model()
        
        if result['success']:
            summary = result['summary']
            TrainingLog.objects.create(
                trained_by=None,  # System
                data_points=summary.get('data_points', 0),
                average_rate=summary.get('average_rate', 0.0),
                stability_factor=summary.get('stability_factor', 0.0),
                logs=result.get('logs', []),
                summary=summary
            )
            msg = "Model trained successfully via management command"
            self.stdout.write(self.style.SUCCESS(msg))
            logger.info(msg)
        else:
            msg = f"Model training failed: {result.get('message')}"
            self.stdout.write(self.style.ERROR(msg))
            logger.error(msg)


def run_train_forecast_model():
    """Standalone function called by the scheduler."""
    import django
    django.setup()

    logger.info("[Scheduler] Starting automated model training...")
    result = train_forecast_model()
    
    if result['success']:
        summary = result['summary']
        TrainingLog.objects.create(
            trained_by=None,  # System
            data_points=summary.get('data_points', 0),
            average_rate=summary.get('average_rate', 0.0),
            stability_factor=summary.get('stability_factor', 0.0),
            logs=result.get('logs', []),
            summary=summary
        )
        logger.info("[Scheduler] Model trained successfully")
    else:
        logger.error(f"[Scheduler] Model training failed: {result.get('message')}")
