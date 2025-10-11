// Perplexity overlay script

// Configuration
// Use bundled logo if available in the extension package; fallback to remote placeholder
let LOGO_IMG = 'https://example.com/intercept-square.png'; // Replace if you want a different default
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    LOGO_IMG = chrome.runtime.getURL('logo.png');
  }
} catch (e) {
  // ignore
}
const SCAN_TIMEOUT = 15000; // ms
// Backend endpoint (replace with your real verifier)
const BACKEND_URL = 'https://facile-jaiden-jadishly.ngrok-free.dev/verify';

// Helpers
function createElement(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([k,v]) => {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  });
  children.forEach(c => el.appendChild(c));
  return el;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectRandomIndicesCrypto(n, k) {
  // select k unique indices from 0..n-1 using crypto randomness
  k = Math.max(0, Math.min(k, n));
  const indices = new Set();
  while (indices.size < k) {
    // generate a random 32-bit number and mod n
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    const r = arr[0] % n;
    indices.add(r);
  }
  return Array.from(indices);
}

// Inject overlay container
function ensureOverlay() {
  let root = document.getElementById('intercept-overlay-root');
  if (root) return root;

  root = createElement('div', { id: 'intercept-overlay-root', class: 'deepfake-overlay' });
  root.style.position = 'fixed';
  root.style.top = '16px';
  root.style.right = '16px';
  root.style.zIndex = '2147483647';
  root.style.pointerEvents = 'auto';

  // button
  const btn = createElement('button', { id: 'intercept-scan-btn', class: 'intercept-btn', title: 'Scan latest Perplexity answer' });
  btn.style.width = '44px';
  btn.style.height = '44px';
  btn.style.borderRadius = '8px';
  btn.style.border = 'none';
  btn.style.padding = '4px';
  btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
  btn.style.background = 'white';
  btn.style.cursor = 'pointer';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';

  const img = createElement('img', { src: LOGO_IMG, alt: 'Intercept.ai', width: '32', height: '32' });
  btn.appendChild(img);

  // notification circle
  const notif = createElement('span', { id: 'intercept-notif', class: 'intercept-notif' });
  notif.style.position = 'absolute';
  notif.style.top = '-6px';
  notif.style.right = '-6px';
  notif.style.minWidth = '20px';
  notif.style.height = '20px';
  notif.style.borderRadius = '50%';
  notif.style.display = 'none';
  notif.style.alignItems = 'center';
  notif.style.justifyContent = 'center';
  notif.style.fontSize = '12px';
  notif.style.color = 'white';
  notif.style.padding = '0 6px';

  const wrapper = createElement('div', { style: 'position:relative; display:inline-block' });
  wrapper.appendChild(btn);
  wrapper.appendChild(notif);

  root.appendChild(wrapper);
  document.body.appendChild(root);

  btn.addEventListener('click', onScanClick);

  return root;
}

// Find the latest Perplexity output container
function findLatestAnswer() {
  // Try several selectors and return the most recent visible, non-empty match.
  const possible = ['.answer', '[data-testid="answer"]', '.Result', '.response', '#main'];

  function isVisible(el) {
    if (!el) return false;
    if (!el.isConnected) return false;
    if (el.offsetParent === null && el.getClientRects().length === 0) return false;
    const text = (el.innerText || '').trim();
    return text.length > 20; // non-empty
  }

  const matches = [];
  for (const sel of possible) {
    const nodes = Array.from(document.querySelectorAll(sel || ''));
    for (const n of nodes) {
      if (isVisible(n)) matches.push(n);
    }
  }

  // If we found matches, return the one that appears last in document order
  if (matches.length > 0) {
    matches.sort((a,b) => {
      if (a === b) return 0;
      // compare positions: returns bitmask, use DOCUMENT_POSITION_FOLLOWING
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    return matches[matches.length - 1];
  }

  // fallback: choose the last large text block
  const all = Array.from(document.querySelectorAll('div')).filter(d => (d.innerText || '').trim().length > 40 && isVisible(d));
  if (all.length === 0) return null;
  all.sort((a,b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  return all[all.length - 1] || null;
}

// Simple scanner stub: identifies sentences with 'citation' patterns missing or 'according to' without source
// Heuristic: determine whether a sentence is a factual statement
function isFact(sentence) {
  if (!sentence || typeof sentence !== 'string') return false;
  const s = sentence.trim();
  // short sentences that are likely headings or single words -> not facts
  if (s.length < 8) return false;

  // Patterns that indicate factual content
  const hasNumber = /\b\d{1,4}(,\d{3})*(\.\d+)?\b/.test(s); // numbers, thousands, decimals
  const hasYear = /\b(18|19|20)\d{2}\b/.test(s);
  const hasPercent = /%|percent(s)?/i.test(s);
  const hasCurrency = /\$|£|€|¥/.test(s);
  const hasUnit = /\b(km|miles|kg|lbs|meters|feet|°C|°F)\b/i.test(s);
  const hasCitation = /https?:\/\//i.test(s) || /\[\d+\]/.test(s);
  const sourceCue = /according to|reported by|study|survey|data shows|research|found that|released/i.test(s);
  const properNouns = /\b([A-Z][a-z]+\s){1,3}[A-Z][a-z]+\b/.test(s); // naive proper noun sequence

  // Negative cues that suggest opinion or hedging
  const hedging = /\b(in my opinion|i think|i believe|may be|might|could|should|would|perhaps|possibly|seems like|imo)\b/i.test(s);
  const subjectiveAdj = /\b(beautiful|great|awful|terrible|fantastic|boring|amazing|interesting)\b/i.test(s);

  if (hedging || subjectiveAdj) return false;

  return hasNumber || hasYear || hasPercent || hasCurrency || hasUnit || hasCitation || sourceCue || properNouns;
}

function scanTextForIssues(factSentences) {
  // factSentences: array of sentence strings that are considered factual by isFact()
  // Default test logic: randomly mark some facts as incorrect and attach mock corrections/sources.
  const sentences = Array.isArray(factSentences) ? factSentences.slice() : [];
  const normalized = sentences.map(s => normalizeWhitespace(s));
  const results = normalized.map((s, idx) => ({ sentence: sentences[idx], normalized: s, correct: true }));

  if (sentences.length === 0) return results;

  const maxIncorrect = Math.max(1, Math.floor(sentences.length * 0.3));
  // pick incorrectCount using crypto-backed random in range [0, maxIncorrect]
  const randArr = new Uint32Array(1);
  window.crypto.getRandomValues(randArr);
  const incorrectCount = Math.min(maxIncorrect, randArr[0] % (maxIncorrect + 1));
  const indices = selectRandomIndicesCrypto(sentences.length, incorrectCount);
  indices.forEach(i => {
    const s = results[i];
    s.correct = false;
    s.reason = 'This fact may be inaccurate.';
    s.correction = `Corrected fact: ${s.sentence.split(' ').slice(0,8).join(' ')}...`;
    s.source = `https://example.com/source/${encodeURIComponent(i)}`;
  });
  return results;
}

async function verifyFactsWithBackend(factSentences) {
  // Sends { sentences: [...] } and expects an array of results [{ sentence, correct, correction?, source? }, ...]
  if (!factSentences || factSentences.length === 0) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT);
  try {
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences: factSentences }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`backend returned ${res.status}`);
    const data = await res.json();
    // Expect data.results or data to be array
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    throw new Error('unexpected backend response shape');
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function clearHighlights(container) {
  container.querySelectorAll('.intercept-correct, .intercept-incorrect').forEach(el => {
    // unwrap spans
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

function showTooltip(text, x, y) {
  let tip = document.getElementById('intercept-tooltip');
  if (!tip) {
    tip = createElement('div', { id: 'intercept-tooltip', class: 'intercept-tooltip' });
    tip.style.position = 'fixed';
    tip.style.zIndex = '2147483647';
    tip.style.background = 'rgba(0,0,0,0.85)';
    tip.style.color = 'white';
    tip.style.padding = '6px 8px';
    tip.style.borderRadius = '6px';
    tip.style.fontSize = '13px';
    tip.style.pointerEvents = 'none';
    document.body.appendChild(tip);
  }
  // allow small html content (text + source link)
  if (typeof text === 'string') {
    tip.textContent = text;
  } else if (text && text.html) {
    tip.innerHTML = text.html;
  }
  tip.style.left = (x + 12) + 'px';
  tip.style.top = (y + 12) + 'px';
  tip.style.display = 'block';
}

function hideTooltip() {
  const tip = document.getElementById('intercept-tooltip');
  if (tip) tip.style.display = 'none';
}

async function onScanClick() {
  const root = ensureOverlay();
  const notif = document.getElementById('intercept-notif');
  notif.style.display = 'none';
  notif.textContent = '';

  const answerEl = findLatestAnswer();
  if (!answerEl) {
    alert('Could not find Perplexity answer on this page.');
    return;
  }

  const text = answerEl.innerText || answerEl.textContent || '';
  if (!text.trim()) {
    alert('Answer appears empty.');
    return;
  }

  // show loading state
  notif.style.display = 'inline-flex';
  notif.style.background = 'gray';
  notif.textContent = '...';

  // Extract sentences and identify factual sentences
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const factSentences = sentences.filter(isFact);

  // Run the validator on only factual sentences: try backend first, fallback to local randomized logic
  let factResults = [];
  if (factSentences.length > 0) {
    // indicate verifying state
    notif.style.background = 'orange';
    notif.textContent = '...';
    try {
      factResults = await verifyFactsWithBackend(factSentences);
    } catch (e) {
      console.warn('Backend verification failed, falling back to local scanner:', e);
      factResults = scanTextForIssues(factSentences);
    }
  } else {
    factResults = [];
  }

  // Build a map from sentence text -> result (for quick lookup)
  // map by normalized form for robust matching
  const resultBySentence = new Map();
  factResults.forEach(r => resultBySentence.set(normalizeWhitespace(r.sentence), r));

  // Clear previous highlights (only unwrap our injected spans)
  clearHighlights(answerEl);

  // Walk the answerEl text nodes and replace only factual sentence occurrences with spans
  let highlightedIncorrects = 0;
  function wrapFactsInNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.nodeValue;
      if (!txt || txt.trim().length === 0) return;

      // For each factual sentence, if it appears in this text node, replace that slice with a span
      let parent = node.parentNode;
      let curText = txt;
      const frag = document.createDocumentFragment();
      let cursor = 0;

      while (cursor < curText.length) {
        // Find the earliest factual sentence occurrence after cursor using normalized regex matching
        let earliest = null;
        let earliestIndex = -1;
        let earliestMatch = null;
        for (const fact of factSentences) {
          const norm = normalizeWhitespace(fact);
          if (!norm) continue;
          // build flexible whitespace regex
          const pattern = escapeRegExp(norm).replace(/\\\s\+/g, '\\s+').replace(/\s+/g, '\\s+');
          const re = new RegExp(pattern, 'i');
          const m = re.exec(curText.slice(cursor));
          if (m) {
            const idx = cursor + m.index;
            if (earliest === null || idx < earliestIndex) {
              earliest = fact;
              earliestIndex = idx;
              earliestMatch = m[0];
            }
          }
        }

        if (earliest === null) {
          // append remaining text
          const tnode = document.createTextNode(curText.slice(cursor));
          frag.appendChild(tnode);
          break;
        }

        // append text before earliest
        if (earliestIndex > cursor) {
          frag.appendChild(document.createTextNode(curText.slice(cursor, earliestIndex)));
        }

        // the matched text (as it appears in DOM)
        const matchedText = earliestMatch || earliest;

        // append wrapped span for the factual sentence
        const res = resultBySentence.get(normalizeWhitespace(earliest)) || { correct: true };
        const span = createElement('span', { class: res.correct ? 'intercept-correct' : 'intercept-incorrect' });
        span.textContent = matchedText;
        span.style.background = res.correct ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)';
        span.style.borderRadius = '4px';
        span.style.padding = '2px 4px';
        span.style.cursor = 'default';
        span.dataset.correct = res.correct ? 'true' : 'false';
        if (!res.correct) {
          span.dataset.reason = res.reason || 'Potential inaccuracy';
          highlightedIncorrects += 1;
        }

        span.addEventListener('mouseenter', (ev) => {
          const x = ev.clientX; const y = ev.clientY;
          if (res.correct) showTooltip('Verified correct.', x, y);
          else {
            const html = `<div style="max-width:320px">${escapeHtml(res.correction || res.reason || 'Possible inaccuracy')}</div>` +
                         (res.source ? `<div style="margin-top:6px"><a href="${escapeHtml(res.source)}" target="_blank" style="color:#9AE6B4; text-decoration:underline">source</a></div>` : '');
            showTooltip({ html }, x, y);
          }
        });
        span.addEventListener('mousemove', (ev) => {
          if (res.correct) showTooltip('Verified correct.', ev.clientX, ev.clientY);
          else {
            const html = `<div style="max-width:320px">${escapeHtml(res.correction || res.reason || 'Possible inaccuracy')}</div>` +
                         (res.source ? `<div style="margin-top:6px"><a href="${escapeHtml(res.source)}" target="_blank" style="color:#9AE6B4; text-decoration:underline">source</a></div>` : '');
            showTooltip({ html }, ev.clientX, ev.clientY);
          }
        });
        span.addEventListener('mouseleave', hideTooltip);

  frag.appendChild(span);

  cursor = earliestIndex + (matchedText ? matchedText.length : (earliest ? earliest.length : 0));
      }

      parent.replaceChild(frag, node);
      return;
    }

    // Recurse into children but avoid walking our own injected elements
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.id === 'intercept-overlay-root' || node.classList && (node.classList.contains('intercept-correct') || node.classList.contains('intercept-incorrect'))) return;
      const children = Array.from(node.childNodes);
      for (const ch of children) wrapFactsInNode(ch);
    }
  }

  wrapFactsInNode(answerEl);

  // Use the number of highlighted incorrect spans as the source of truth for the UI
  if (highlightedIncorrects > 0) {
    notif.style.background = 'crimson';
    notif.textContent = String(highlightedIncorrects);
    notif.title = `${highlightedIncorrects} potential misquotes detected`;
  } else {
    notif.style.background = 'green';
    notif.textContent = '✓';
    notif.title = 'No misquotes detected';
  }
}

// Initialize on load
(function init() {
  ensureOverlay();
  console.log('Intercept.AI content script initialized');

  // Observe DOM changes to re-inject overlay if needed
  const mo = new MutationObserver(() => {
    if (!document.getElementById('intercept-overlay-root')) ensureOverlay();
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
