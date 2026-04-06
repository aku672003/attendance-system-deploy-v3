import os
import logging
from django.apps import AppConfig

logger = logging.getLogger(__name__)


class AttendanceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'attendance'

    def ready(self):
        # Only start the scheduler in the main process (avoid double-start
        # caused by Django's auto-reloader spawning a child process).
        if os.environ.get('RUN_MAIN') == 'true' or not os.environ.get('RUN_MAIN'):
            from attendance import scheduler
            scheduler.start()

            # Auto-generate VAPID keys on first run if not yet configured
            try:
                from attendance.vapid_setup import ensure_vapid_keys
                ensure_vapid_keys()
            except Exception as e:
                logger.warning("VAPID key setup failed: %s", e)

            # ── Auto-retrain if model is stale (> 24 hours old) ──────────────
            # This ensures production self-heals after deployment or long downtime.
            try:
                _trigger_retrain_if_stale()
            except Exception as e:
                logger.warning("Startup auto-retrain check failed: %s", e)


def _trigger_retrain_if_stale():
    """Retrain the ML model in the background if it hasn't been trained in > 24 hours."""
    import json
    import threading
    from datetime import datetime, timedelta
    from django.conf import settings

    state_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'model_state.json')
    stale = True

    if os.path.exists(state_path):
        try:
            with open(state_path, 'r') as f:
                state = json.load(f)
            last_trained_str = state.get('last_trained')
            if last_trained_str:
                last_trained = datetime.strptime(last_trained_str, '%Y-%m-%d %H:%M:%S')
                if datetime.now() - last_trained < timedelta(hours=24):
                    stale = False
        except Exception:
            pass  # Treat unreadable state as stale

    if stale:
        logger.info("[Startup] ML model is stale or missing — scheduling background retrain...")

        def _do_retrain():
            try:
                from attendance.intelligence_hub import train_forecast_model
                from attendance.models import TrainingLog
                result = train_forecast_model()
                if result.get('success'):
                    summary = result['summary']
                    TrainingLog.objects.create(
                        trained_by=None,
                        data_points=summary.get('data_points', 0),
                        average_rate=summary.get('average_rate', 0.0),
                        stability_factor=summary.get('stability_factor', 0.0),
                        logs=result.get('logs', []),
                        summary=summary
                    )
                    logger.info("[Startup] Auto-retrain completed successfully.")
                else:
                    logger.warning("[Startup] Auto-retrain failed: %s", result.get('message'))
            except Exception as exc:
                logger.error("[Startup] Background retrain error: %s", exc)

        # Run in a background thread so it doesn't block server startup
        t = threading.Thread(target=_do_retrain, name='startup-ml-retrain', daemon=True)
        t.start()
    else:
        logger.info("[Startup] ML model is fresh — no retrain needed.")
