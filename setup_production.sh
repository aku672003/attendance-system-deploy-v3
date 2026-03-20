#!/bin/bash
# Production Setup Script for Ubuntu

echo "Starting Production Setup..."

# Update and install dependencies
sudo apt update
sudo apt install -y python3-pip python3-venv nginx libpq-dev

# Setup Virtual Environment
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# Install requirements
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

# Collect Static files
python manage.py collectstatic --noinput

# Run Migrations
python manage.py migrate

echo "Setup complete. Next steps:"
echo "1. Configure Gunicorn service"
echo "2. Configure Nginx"
echo "3. Update .env with DEBUG=False"
