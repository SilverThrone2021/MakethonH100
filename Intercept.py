"""
Gemini AI Detection Service with Multi-Account Batching
Optimized for 2,400+ users/min throughput with 5 accounts
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
import google.generativeai as genai
from threading import Lock
import requests
import time
import re
import os
from collections import deque
import json
import random

# ============================================
# CONFIGURATION
# ============================================
GEMINI_API_KEYS = [
    os.environ.get('GEMINI_KEY_1', 'AIzaSyCDg8L7hCXGKZPxJUXjHDD14g5ldnX48KY'),
    os.environ.get('GEMINI_KEY_2', 'AIzaSyDzVS6qRKXqJniAzQJYNzSWt7lvmiF-y38'),
    os.environ.get('GEMINI_KEY_3', 'AIzaSyATdvD4h93M6iOcLryOgzflNBYcWqGRrOs'),
    os.environ.get('GEMINI_KEY_4', 'YOUR_KEY_4'),
    os.environ.get('GEMINI_KEY_5', 'YOUR_KEY_5')
]
NGROK_AUTH_TOKEN = os.environ.get('NGROK_AUTH_TOKEN')
DEV_MODE = os.environ.get('FLASK_ENV') == 'development'

MODEL_NAME = "gemini-2.5-flash-lite"
BATCH_SIZE = 32
MAX_TOKENS_PER_ARTICLE = 150
ARTICLES_PER_USER = 3

app = Flask(__name__)
CORS(app)

print("="*80)
print("🚀 GEMINI MULTI-ACCOUNT AI DETECTOR")
print("="*80)

# ============================================
# MULTI-ACCOUNT MANAGER
# ============================================
class GeminiAccountManager:
    def __init__(self, api_keys):
        self.api_keys = [key for key in api_keys if key and not key.startswith('YOUR_')]
        if not self.api_keys:
            raise ValueError("No valid API keys provided!")

        self.accounts = deque(range(len(self.api_keys)))
        self.lock = Lock()
        self.models = []
        self.request_counts = [0] * len(self.api_keys)

        for idx, key in enumerate(self.api_keys):
            try:
                genai.configure(api_key=key)
                model = genai.GenerativeModel(
                    MODEL_NAME,
                    generation_config={
                        "temperature": 0.25,
                        "max_output_tokens": 1200,
                        "response_mime_type": "application/json"
                    }
                )
                self.models.append(model)
                print(f"✅ Account #{idx+1} initialized")
            except Exception as e:
                print(f"⚠️ Account #{idx+1} failed: {str(e)[:100]}")

        if not self.models:
            raise ValueError("No models could be initialized!")

        print(f"✅ {len(self.models)} Gemini accounts ready")

    def get_next_account(self):
        with self.lock:
            account_idx = self.accounts[0]
            self.accounts.rotate(-1)
            self.request_counts[account_idx] += 1
            return account_idx, self.models[account_idx]

    def get_stats(self):
        return {f"account_{i+1}": count for i, count in enumerate(self.request_counts)}

try:
    account_manager = GeminiAccountManager(GEMINI_API_KEYS)
except Exception as e:
    print(f"❌ Failed to initialize accounts: {e}")
    exit(1)

# ... (rest of the file is the same until the startup section)

# ============================================
# STARTUP
# ============================================
if __name__ == '__main__':
    print(f"🤖 Model: {MODEL_NAME}\n👥 Active Accounts: {len(account_manager.models)}\n📦 Batch Size: {BATCH_SIZE}\n"
          f"⚡ Theoretical Capacity: {len(account_manager.models) * 480} users/min\n"
          f"📊 Config: {ARTICLES_PER_USER} articles × {MAX_TOKENS_PER_ARTICLE} tokens each\n{'='*80}\n")

    if DEV_MODE:
        # Development mode: Use Flask's built-in server and ngrok
        print("Running in development mode...")
        from pyngrok import ngrok
        from threading import Thread

        def run_flask():
            app.run(host='0.0.0.0', port=5000, threaded=True, use_reloader=False)

        Thread(target=run_flask, daemon=True).start()
        time.sleep(3)

        try:
            if NGROK_AUTH_TOKEN:
                ngrok.set_auth_token(NGROK_AUTH_TOKEN)
            public_url = ngrok.connect(5000, bind_tls=True)
            print(f"\n{'='*80}\n🌐 PUBLIC URL: {public_url}\n{'='*80}\n"
                  f"✅ Ready to serve {len(account_manager.models) * 480} users/min\n"
                  f"📡 Update your extension with this URL\n")
        except Exception as e:
            print(f"⚠️ ngrok error: {e}\n💡 Server running locally at http://localhost:5000\n")

        try:
            while True: time.sleep(3600)
        except KeyboardInterrupt:
            print("\n\n👋 Shutting down gracefully...")
    else:
        # Production mode: The app object is exposed for a WSGI server like Gunicorn
        print("Running in production mode. Use a WSGI server to run the 'app' object.")
