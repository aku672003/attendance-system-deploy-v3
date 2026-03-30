#!/bin/bash
# train_model.sh - Run attendance forecast model training
# Recommended Cron: 30 18 * * * /home/ubuntu/attendance-system/scripts/train_model.sh >> /home/ubuntu/attendance-system/logs/training_cron.log 2>&1

# Get the script's directory and navigate to the project root (assuming script is in /scripts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Path to virtualenv python
# Note: Adjust 'venv' if your environment name is different
VENV_PYTHON="./venv/bin/python"

# Use absolute path for reliability in cron
echo "[$(date)] --- Starting Model Training Sequence ---"

if [ -f "$VENV_PYTHON" ]; then
    "$VENV_PYTHON" manage.py train_forecast_model
else
    echo "Error: Virtual environment not found at $VENV_PYTHON"
    # Fallback to system python if appropriate, but usually better to fail and log
    exit 1
fi

echo "[$(date)] --- Sequence Completed ---"
