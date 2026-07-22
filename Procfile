web: gunicorn --bind 0.0.0.0:$PORT --chdir backend --worker-class gthread --threads 8 --timeout 300 --keep-alive 15 app:app
