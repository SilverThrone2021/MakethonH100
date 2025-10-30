# gunicorn.conf.py
# Recommended settings for a production environment

bind = "0.0.0.0:5000"
workers = (2 * 1) + 1  # Standard formula: (2 * num_cores) + 1
threads = 4
timeout = 120
loglevel = "info"
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stderr
