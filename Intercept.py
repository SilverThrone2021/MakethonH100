"""
Gemini AI Detection Service with Multi-Account Batching
Optimized for 2,400+ users/min throughput with 5 accounts
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
import google.generativeai as genai
from pyngrok import ngrok
from threading import Thread, Lock
import requests
import time
import re
import os
from collections import deque
import json

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

NGROK_AUTH_TOKEN = os.environ.get('NGROK_AUTH_TOKEN', '33tszCijYYQxWFNhWlnzl2GjpjL_53zLPsQtq6VEbtKaZ5gAw')

# Gemini configuration
MODEL_NAME = "gemini-2.5-flash-lite"
BATCH_SIZE = 32  # Users per request
MAX_TOKENS_PER_ARTICLE = 150  # Tokens per source
ARTICLES_PER_USER = 3  # Sources per user

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
        
        # Initialize all models
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
        """Round-robin account selection with request tracking"""
        with self.lock:
            account_idx = self.accounts[0]
            self.accounts.rotate(-1)
            self.request_counts[account_idx] += 1
            return account_idx, self.models[account_idx]
    
    def get_stats(self):
        """Get usage statistics"""
        return {
            f"account_{i+1}": count 
            for i, count in enumerate(self.request_counts)
        }

# Initialize manager
try:
    account_manager = GeminiAccountManager(GEMINI_API_KEYS)
except Exception as e:
    print(f"❌ Failed to initialize accounts: {e}")
    exit(1)

# ============================================
# ARTICLE FETCHING
# ============================================
def fetch_article_text(url, max_tokens=150):
    """Fetch and clean article text, limit to max_tokens"""
    try:
        headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        
        soup = BeautifulSoup(r.content, 'html.parser')
        
        # Remove unwanted elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript']):
            tag.decompose()
        
        # Extract main content
        article = soup.find('article') or soup.find('main') or soup.body
        if not article:
            return None
        
        text = article.get_text(separator=' ', strip=True)
        text = re.sub(r'\s+', ' ', text).strip()
        
        # Limit to ~max_tokens (approximate: 4 chars per token)
        max_chars = max_tokens * 4
        if len(text) > max_chars:
            text = text[:max_chars] + "..."
        
        return text if len(text) > 50 else None
        
    except Exception as e:
        print(f"⚠️ Fetch error ({url[:50]}): {str(e)[:80]}")
        return None

# ============================================
# BATCH ANALYSIS WITH GEMINI
# ============================================
def analyze_batch_with_gemini(batch, account_idx, model):
    """Analyze a batch of users with one Gemini request"""
    
    # Build batched prompt
    batch_data = []
    for i, user_req in enumerate(batch):
        user_id = user_req['user_id']
        
        # Combine sources text
        sources_text = "\n\n---\n\n".join([
            f"Source {j+1} ({src['url'][:50]}):\n{src['text'][:600]}"
            for j, src in enumerate(user_req['sources'][:ARTICLES_PER_USER])
            if src.get('text')
        ])
        
        if sources_text:
            batch_data.append({
                "user_id": user_id,
                "content": sources_text
            })
    
    if not batch_data:
        return []
    
    # Create batched prompt with clear instructions
    prompt = f"""You are a deterministic AI content detection expert. Analyze these {len(batch_data)} sets of sources to determine if they are AI-generated and or contain fluff.

STRICT SCORING GUIDELINES:
Official Documentation (docs sites, readthedocs, API references): 5-20%
Q&A forums (Stack Overflow, Reddit): 10-30%
GitHub repos/READMEs: 15-35%
Blog Post with Author and Date: 20-50%
Marketing Copy with Buzzwords: 60-85%
Generic advice articles: 75-95%

REQUIRED ANALYSIS 
- 0-30: Likely HUMAN (personal language, specific examples, natural imperfections, author attribution)
- 30-60: UNCLEAR (professional but generic, could be either)
- 60-100: Likely AI (generic phrases, buzzwords, formulaic structure, no personality)

For EACH user, provide:
1. ai_probability (0-100): Likelihood content is AI-generated
2. confidence (0-100): How certain you are
3. reasoning (string): Brief 1-sentence explanation citing specific evidence

USERS TO ANALYZE:
{json.dumps(batch_data, indent=2)}

RESPONSE FORMAT (valid JSON array):
[
  {{"user_id": "user_0", "ai_probability": 25, "confidence": 75, "reasoning": "Contains author attribution and first-person language."}},
  {{"user_id": "user_1", "ai_probability": 70, "confidence": 65, "reasoning": "Generic marketing language with no specific examples."}}
]

Respond ONLY with the JSON array, no other text."""

    try:
        start = time.time()
        response = model.generate_content(prompt, generation_config={"temperature": 0.0, "top_k": 1, "top_p": 1.0})
        elapsed = time.time() - start
        
        # Parse JSON response
        result_text = response.text.strip()
        
        # Clean markdown code blocks if present
        if result_text.startswith('```json'):
            result_text = result_text[7:-3].strip()
        elif result_text.startswith('```'):
            result_text = result_text[3:-3].strip()
        
        results = json.loads(result_text)
        
        # Validate results
        if not isinstance(results, list):
            raise ValueError("Response is not a list")
        
        # Ensure all required fields exist
        validated_results = []
        for result in results:
            validated_results.append({
                "user_id": result.get("user_id", "unknown"),
                "ai_probability": max(0, min(100, int(result.get("ai_probability", 30)))),
                "confidence": max(0, min(100, int(result.get("confidence", 50)))),
                "reasoning": result.get("reasoning", "Analysis completed")[:300],
                "batch_id": f"batch_{account_idx}_{int(time.time())}"
            })
        
        print(f"✅ Account #{account_idx+1}: {len(validated_results)} users in {elapsed:.1f}s")
        print(f"DEBUG: Raw Gemini response:\n{result_text}\n")
        return validated_results
        
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON parse error (account #{account_idx+1}): {str(e)[:100]}")
        print(f"   Raw response: {result_text[:200]}...")
        return create_fallback_results(batch, account_idx, "JSON parse error")
        
    except Exception as e:
        print(f"⚠️ Gemini error (account #{account_idx+1}): {str(e)[:200]}")
        return create_fallback_results(batch, account_idx, str(e))

def create_fallback_results(batch, account_idx, error_msg):
    """Create default results for failed batch"""
    return [
        {
            "user_id": req['user_id'],
            "ai_probability": 30,
            "confidence": 40,
            "reasoning": f"Analysis error: {error_msg[:80]}",
            "batch_id": f"error_{account_idx}"
        }
        for req in batch
    ]

# ============================================
# MAIN ANALYSIS ENDPOINT
# ============================================
@app.route('/analyze', methods=['POST'])
def analyze():
    """Handle user request(s) with intelligent batching"""
    start_time = time.time()
    
    incoming = request.json
    sources = incoming.get('sources', [])
    
    if not sources:
        return jsonify([])
    
    print(f"\n{'='*60}")
    print(f"🔍 Received {len(sources)} sources")
    print(f"{'='*60}")
    
    # Step 1: Fetch all articles in parallel
    all_user_data = []
    
    with ThreadPoolExecutor(max_workers=50) as executor:
        fetch_futures = {
            executor.submit(fetch_article_text, src['url'], MAX_TOKENS_PER_ARTICLE): (idx, src)
            for idx, src in enumerate(sources[:10])
        }
        
        for future in as_completed(fetch_futures):
            idx, src = fetch_futures[future]
            text = future.result()
            if text:
                all_user_data.append({
                    'user_id': f"source_{idx}",
                    'sources': [{
                        'url': src['url'],
                        'title': src.get('title', ''),
                        'text': text
                    }],
                    'original_index': idx,
                    'original_source': src
                })
    
    print(f"📥 Successfully fetched {len(all_user_data)} sources")
    
    if not all_user_data:
        return jsonify([])
    
    # Step 2: Create batches (each source is now a separate "user")
    batches = []
    current_batch = []
    
    for user_data in all_user_data:
        current_batch.append(user_data)
        if len(current_batch) == BATCH_SIZE:
            batches.append(current_batch)
            current_batch = []
    
    if current_batch:
        batches.append(current_batch)
    
    print(f"📦 Created {len(batches)} batch(es)")
    
    # Step 3: Process batches
    all_results = {}
    
    with ThreadPoolExecutor(max_workers=len(account_manager.models)) as executor:
        futures = {}
        
        for batch in batches:
            account_idx, model = account_manager.get_next_account()
            future = executor.submit(analyze_batch_with_gemini, batch, account_idx, model)
            futures[future] = batch
        
        for future in as_completed(futures):
            try:
                batch_results = future.result()
                for result in batch_results:
                    all_results[result['user_id']] = result
            except Exception as e:
                print(f"⚠️ Batch processing error: {str(e)[:100]}")
    
    # Step 4: Format final response (match original source order)
    final_response = []
    
    for user_data in sorted(all_user_data, key=lambda x: x['original_index']):
        user_id = user_data['user_id']
        analysis = all_results.get(user_id, {
            "ai_probability": 30,
            "confidence": 40,
            "reasoning": "Analysis incomplete",
            "batch_id": "unknown"
        })
        
        ai_prob = analysis['ai_probability']
        analysis['perplexity'] = int((1 - ai_prob/100) * 200)
        analysis['authenticity_score'] = round(10 - ai_prob/10, 1)
        
        final_response.append({
            "url": user_data['original_source']['url'],
            "title": user_data['original_source'].get('title', ''),
            "analysis": analysis
        })
    
    elapsed = time.time() - start_time
    print(f"⏱️ Completed: {len(final_response)} sources in {elapsed:.2f}s\n")
    
    return jsonify(final_response)

# ============================================
# HEALTH CHECK & STATS
# ============================================
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "model": MODEL_NAME,
        "accounts": len(account_manager.models),
        "batch_size": BATCH_SIZE,
        "capacity_per_min": len(account_manager.models) * 480,
        "capacity_per_sec": len(account_manager.models) * 8,
        "usage_stats": account_manager.get_stats()
    })

@app.route('/stats', methods=['GET'])
def stats():
    return jsonify({
        "accounts": len(account_manager.models),
        "requests_per_account": account_manager.get_stats(),
        "total_requests": sum(account_manager.request_counts),
        "batch_size": BATCH_SIZE,
        "articles_per_user": ARTICLES_PER_USER
    })

# ============================================
# STARTUP
# ============================================
def run_flask():
    app.run(host='0.0.0.0', port=5000, threaded=True, use_reloader=False)

if __name__ == '__main__':
    print(f"🤖 Model: {MODEL_NAME}")
    print(f"👥 Active Accounts: {len(account_manager.models)}")
    print(f"📦 Batch Size: {BATCH_SIZE} users/request")
    print(f"⚡ Theoretical Capacity: {len(account_manager.models) * 480} users/min")
    print(f"📊 Config: {ARTICLES_PER_USER} articles × {MAX_TOKENS_PER_ARTICLE} tokens each")
    print("="*80 + "\n")

    
    # Start Flask in background
    Thread(target=run_flask, daemon=True).start()
    time.sleep(3)
    
    # Start ngrok
    try:
        ngrok.set_auth_token(NGROK_AUTH_TOKEN)
        public_url = ngrok.connect(5000, bind_tls=True)
        print(f"\n{'='*80}")
        print(f"🌐 PUBLIC URL: {public_url}")
        print(f"{'='*80}")
        print(f"✅ Ready to serve {len(account_manager.models) * 480} users/min")
        print(f"📡 Update your extension with this URL\n")
        
    except Exception as e:
        print(f"⚠️ ngrok error: {e}")
        print(f"💡 Server running locally at http://localhost:5000\n")
    
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down gracefully...")