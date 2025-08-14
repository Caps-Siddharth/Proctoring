# config.py (recommended)
import os

MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_USE_TLS = True
MAIL_USERNAME = os.getenv("MAIL_USERNAME")  # your email address
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")  # app password (not your login)
MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER", MAIL_USERNAME)
