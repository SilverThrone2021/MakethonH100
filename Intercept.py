from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
from bs4 import BeautifulSoup
import json
from pyngrok import ngrok
import re
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ==================== GLOBAL MODEL LOADING ====================
qwen_model = None
qwen_tokenizer = None


def load_qwen_model():
    """Load Qwen3 4B model once at startup"""
    global qwen_model, qwen_tokenizer

    if qwen_model is None:
        logger.info("Loading Qwen3-4B model from Hugging Face...")
        model_name = "Qwen/Qwen3-4B-Instruct-2507"

        try:
            qwen_tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                trust_remote_code=True,
                padding_side='left'  # Important for batching
            )

            # Set pad token if not set
            if qwen_tokenizer.pad_token is None:
                qwen_tokenizer.pad_token = qwen_tokenizer.eos_token

            qwen_model = AutoModelForCausalLM.from_pretrained(
                model_name,
                trust_remote_code=True,
                torch_dtype=torch.float16,
                device_map="auto"
            )

            logger.info(f"✓ Qwen3-4B model loaded successfully on: {qwen_model.device}")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to load Qwen3-4B: {e}")
            return False
    return True


def fetch_article_text(url):
    """Scrape article content"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, timeout=10, headers=headers)
        soup = BeautifulSoup(response.content, 'html.parser')

        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()

        article = soup.find('article') or soup.find('main') or soup.body
        if article:
            text = article.get_text(separator=' ', strip=True)
            return text[:4000]
        return None
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return None


def create_prompt(text, url, platform):
    """Create analysis prompt"""
    return f"""Analyze this article for AI-generated content detection.

Platform: {platform}
URL: {url}
Article text (first 4000 chars):
{text[:4000]}

Analyze and respond with PROPER JSON FORMATTING only:

{{
  "ai_likelihood": "Low (0-40%)" or "Medium (40-70%)" or "High (70-90%)",
  "quality": "High" or "Medium" or "Low",
  "has_fluff": "Yes" or "No",
  "reasoning": "Brief 1-2 sentence explanation"
}}

Consider these AI indicators:
- Repetitive phrasing or generic statements
- Overly formal or unnatural language
- Lack of specific details or personal perspective
- Formulaic structure
- Excessive use of transition phrases
- Lists without depth
- Vague conclusory statements

Respond ONLY with valid JSON. No explanations, no markdown, just the JSON object."""


def parse_model_response(text_response, prompt):
    """Parse and clean model response to extract JSON"""
    try:
        # Remove the prompt from response
        text_response = text_response[len(prompt):].strip()

        # Remove thinking tags
        if '</think>' in text_response:
            text_response = text_response.split('</think>')[-1].strip()

        # Remove markdown
        text_response = text_response.replace('``````', '').strip()

        # Extract JSON
        start_idx = text_response.find('{')
        end_idx = text_response.rfind('}')

        if start_idx != -1 and end_idx != -1:
            text_response = text_response[start_idx:end_idx + 1]

        result = json.loads(text_response)

        # Extract numeric likelihood
        likelihood_str = result.get('ai_likelihood', 'Unknown')
        match = re.search(r'(\d+)', likelihood_str)
        if match:
            result['ai_likelihood_numeric'] = int(match.group(1))
        else:
            result['ai_likelihood_numeric'] = 0

        return result

    except Exception as e:
        logger.error(f"Error parsing response: {e}")
        return {
            "ai_likelihood": "Unknown",
            "quality": "Unknown",
            "has_fluff": "Unknown",
            "reasoning": "Could not parse AI response",
            "ai_likelihood_numeric": 0
        }


def classify_batch(articles_data, batch_size=5):
    """
    Classify multiple articles using batched inference
    Processes in batches to avoid OOM while still being much faster than sequential
    """
    if not qwen_model:
        return [{"error": "Model not loaded", "ai_likelihood_numeric": 0} for _ in articles_data]

    # Create prompts for all valid articles
    prompts = []
    valid_indices = []

    for i, data in enumerate(articles_data):
        text = data.get('text')
        if text and len(text) >= 50:
            prompt = create_prompt(text, data.get('url', ''), data.get('platform', 'unknown'))
            prompts.append(prompt)
            valid_indices.append(i)

    if not prompts:
        return [{
            "error": "No valid text",
            "ai_likelihood": "Unknown",
            "quality": "Unknown",
            "has_fluff": "Unknown",
            "reasoning": "Text too short",
            "ai_likelihood_numeric": 0
        } for _ in articles_data]

    logger.info(f"🚀 Processing {len(prompts)} articles in batches of {batch_size}...")

    # Initialize results
    all_results = [None] * len(articles_data)

    # Process in batches
    for batch_start in range(0, len(prompts), batch_size):
        batch_end = min(batch_start + batch_size, len(prompts))
        batch_prompts = prompts[batch_start:batch_end]
        batch_indices = valid_indices[batch_start:batch_end]

        logger.info(f"  Batch {batch_start // batch_size + 1}: Processing {len(batch_prompts)} articles...")

        # Tokenize batch
        inputs = qwen_tokenizer(
            batch_prompts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=2048
        ).to(qwen_model.device)

        # Generate responses for entire batch AT ONCE
        with torch.no_grad():
            outputs = qwen_model.generate(
                **inputs,
                max_new_tokens=512,
                temperature=0.3,
                top_p=0.8,
                do_sample=True,
                pad_token_id=qwen_tokenizer.pad_token_id
            )

        # Decode all responses
        for i, (output, original_prompt) in enumerate(zip(outputs, batch_prompts)):
            text_response = qwen_tokenizer.decode(output, skip_special_tokens=True)
            result = parse_model_response(text_response, original_prompt)
            all_results[batch_indices[i]] = result

        logger.info(f"  ✓ Batch {batch_start // batch_size + 1} complete")

    # Fill in errors for invalid articles
    for i, result in enumerate(all_results):
        if result is None:
            all_results[i] = {
                "error": "Text too short",
                "ai_likelihood": "Unknown",
                "quality": "Unknown",
                "has_fluff": "Unknown",
                "reasoning": "Content too short (needs 50+ chars)",
                "ai_likelihood_numeric": 0
            }

    logger.info(f"✓ All batches complete: Analyzed {len(prompts)} articles")
    return all_results


@app.route('/analyze', methods=['POST'])
def analyze():
    print("\n" + "=" * 70)
    print("NEW ANALYSIS REQUEST")
    print("=" * 70)

    data = request.json
    sources = data.get('sources', [])
    platform = data.get('platform', 'unknown')

    logger.info(f"📥 Received {len(sources)} sources")

    # STEP 1: Fetch ALL articles in PARALLEL
    logger.info("📡 Step 1: Fetching articles in parallel...")
    articles_data = []

    def fetch_with_metadata(source):
        text = fetch_article_text(source['url'])
        return {
            'url': source['url'],
            'title': source['title'],
            'text': text,
            'platform': platform
        }

    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_source = {executor.submit(fetch_with_metadata, source): source
                            for source in sources[:100]}

        for future in as_completed(future_to_source):
            try:
                articles_data.append(future.result())
            except Exception as e:
                source = future_to_source[future]
                articles_data.append({
                    'url': source['url'],
                    'title': source['title'],
                    'text': None,
                    'platform': platform
                })

    logger.info(f"✓ Step 1 complete: Fetched {len(articles_data)} articles")

    # STEP 2: Process in batches (5 at a time for GPU memory safety)
    logger.info("\n🤖 Step 2: Analyzing in batches...")
    classifications = classify_batch(articles_data, batch_size=3)

    # STEP 3: Format results
    results = []
    for article_data, classification in zip(articles_data, classifications):
        results.append({
            'url': article_data['url'],
            'title': article_data['title'],
            'analysis': classification,
            'text_length': len(article_data['text']) if article_data['text'] else 0
        })

    print("=" * 70)
    print(f"✅ COMPLETE: Returning {len(results)} results")
    print("=" * 70 + "\n")
    return jsonify(results)


@app.route('/test', methods=['GET'])
def test():
    """Test endpoint"""
    model_loaded = qwen_model is not None
    device = str(qwen_model.device) if model_loaded else "not loaded"

    return jsonify({
        "status": "ok",
        "message": "Flask server with batch processing!",
        "model": "Qwen3-4B-Instruct",
        "model_loaded": model_loaded,
        "device": device,
        "batching": "enabled (transformers)"
    })


if __name__ == '__main__':
    print("=" * 70)
    print("AI SOURCE CHECKER - Qwen3 4B with BATCH PROCESSING")
    print("=" * 70)

    print("\n🤖 Loading Qwen3-4B model...")
    if not load_qwen_model():
        print("\n❌ Failed to load model")
        exit(1)

    ngrok.set_auth_token("33tszCijYYQxWFNhWlnzl2GjpjL_53zLPsQtq6VEbtKaZ5gAw")

    port = 5000
    try:
        ngrok.kill()
        public_url = ngrok.connect(port)

        print(f"\n✅ Server ready!")
        print("=" * 70)
        print(f"📡 PUBLIC URL: {public_url}")
        print("=" * 70)
        print("\n⚡ BATCH PROCESSING ENABLED (Windows compatible)")
        print("   • Processes 3 articles at once per batch")
        print("   • 3-5x faster than sequential")
        print("=" * 70 + "\n")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        exit(1)

    app.run(host='0.0.0.0', port=port, debug=False)
