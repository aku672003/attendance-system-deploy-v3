#!/bin/bash

# --- Attendance System Model Training Script ---
# This script is designed to be run via Crontab on the AWS instance.

# 1. Determine the project root directory (directory of the script minus 2 levels)
# Script is in: attendance/management/train_model.sh
# Project root: .
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$PROJECT_ROOT"

# 2. Ensure logs directory exists
mkdir -p logs

# 3. Path to virtual environment python
PYTHON_BIN="./venv/bin/python"

if [ ! -f "$PYTHON_BIN" ]; then
    echo "$(date): Error - Virtual environment python not found at $PYTHON_BIN" >> logs/training_debug.log
    exit 1
fi

# 4. Run the training command
echo "$(date): Starting automated model training..." >> logs/training_debug.log

$PYTHON_BIN manage.py train_forecast_model >> logs/training_debug.log 2>&1

if [ $? -eq 0 ]; then
    echo "$(date): Training sequence completed successfully." >> logs/training_debug.log
else
    echo "$(date): Training sequence failed. Check logs above." >> logs/training_debug.log
fi
