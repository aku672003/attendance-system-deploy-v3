import os
from django.apps import AppConfig


class AttendanceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'attendance'

    def ready(self):
        # Only start the scheduler in the main process (avoid double-start
        # caused by Django's auto-reloader spawning a child process).
        if os.environ.get('RUN_MAIN') == 'true' or not os.environ.get('RUN_MAIN'):
            from attendance import scheduler
            scheduler.start()
