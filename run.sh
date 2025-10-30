#!/bin/bash
# Production startup script

# Install dependencies
pip install -r requirements.txt

# Start the Gunicorn server
gunicorn -c gunicorn.conf.py Intercept:app
