let isAnalyzing = false;

// Update this to your ngrok URL
const BACKEND_URL = 'https://facile-jaiden-jadishly.ngrok-free.dev/analyze';

document.getElementById('analyze').addEventListener('click', async () => {
    if (isAnalyzing) return;
    
    isAnalyzing = true;
    const resultsDiv = document.getElementById('results');
    const btn = document.getElementById('analyze');
    
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    resultsDiv.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <div class="loading-text">Analyzing sources with Gemini...</div>
            <div class="loading-subtext">Multi-account batching in progress</div>
        </div>
    `;
    
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractPerplexityData
        });
        
        if (!result || !result[0].result) {
            resultsDiv.innerHTML = `
                <div class="error-message">
                    <div class="error-title">No Data Found</div>
                    Make sure you're on perplexity.ai with search results visible.
                </div>
            `;
            return;
        }
        
        const sources = result[0].result;
        
        if (!sources || sources.length === 0) {
            resultsDiv.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔭</div>
                    <div class="empty-text">No sources found on this page</div>
                </div>
            `;
            return;
        }
        
        // Send request to Gemini backend (batching handled server-side)
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sources: sources.slice(0, 10)  // Limit to 10 sources
            })
        });
        
        if (!response.ok) {
            throw new Error(`Backend error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Handle both single user and batch response formats
        const results = Array.isArray(data) ? data : [data];
        
        displayResults(results);
        
    } catch (error) {
        console.error('Analysis error:', error);
        resultsDiv.innerHTML = `
            <div class="error-message">
                <div class="error-title">⚠️ Analysis Failed</div>
                <div class="error-details">${error.message}</div>
                <div class="error-hint">Check your backend URL and API keys</div>
            </div>
        `;
    } finally {
        isAnalyzing = false;
        btn.disabled = false;
        btn.textContent = 'Analyze Results';
    }
});

function extractPerplexityData() {
    const sources = [];
    
    // Try Perplexity citation elements
    document.querySelectorAll('[class*="Citation"], [class*="Source"]').forEach(el => {
        const link = el.querySelector('a') || el;
        if (link && link.href) {
            sources.push({
                url: link.href,
                title: link.textContent || new URL(link.href).hostname
            });
        }
    });
    
    // Fallback to all external links
    if (sources.length === 0) {
        document.querySelectorAll('a[href^="http"]').forEach(link => {
            if (!link.href.includes('perplexity.ai')) {
                sources.push({
                    url: link.href,
                    title: link.textContent || new URL(link.href).hostname
                });
            }
        });
    }
    
    return sources.slice(0, 10);
}

function displayResults(results) {
    const container = document.getElementById('results');
    container.innerHTML = '';
    
    // Handle batch response format
    const sources = results[0]?.sources || [];
    const analysis = results[0]?.analysis || {};
    
    // If we have sources array, process each source
    if (sources.length > 0) {
        sources.forEach((source, idx) => {
            createResultCard(container, {
                url: source.url,
                title: source.title,
                analysis: analysis,
                text_length: source.text?.length || 0
            });
        });
    } else {
        // Fallback to old format
        results.forEach(result => {
            createResultCard(container, result);
        });
    }
}

function createResultCard(container, result) {
    const analysis = result.analysis || {};
    const aiProb = analysis.ai_probability || 0;
    
    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        border-left: 4px solid ${getRiskColor(aiProb)};
        transition: all 0.3s;
        cursor: pointer;
    `;
    
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
    });
    
    card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    });
    
    const riskBadge = document.createElement('div');
    riskBadge.textContent = getRiskLabel(aiProb);
    riskBadge.style.cssText = `
        display: inline-block;
        padding: 4px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 8px;
        background: ${getRiskBgColor(aiProb)};
        color: ${getRiskTextColor(aiProb)};
    `;
    
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3;';
    title.textContent = result.title || new URL(result.url).hostname;
    
    const url = document.createElement('a');
    url.href = result.url;
    url.textContent = new URL(result.url).hostname;
    url.target = '_blank';
    url.style.cssText = 'font-size: 12px; color: #666; text-decoration: none; display: block; margin-bottom: 12px;';
    
    const probDiv = document.createElement('div');
    probDiv.style.cssText = 'font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px;';
    probDiv.textContent = `${aiProb}%`;
    
    const confidence = document.createElement('div');
    confidence.style.cssText = 'font-size: 12px; color: #666; margin-bottom: 12px;';
    const confValue = analysis.confidence || 50;
    confidence.textContent = `Confidence: ${getConfidenceLabel(confValue)} (${confValue}%)`;
    
    const metrics = document.createElement('div');
    metrics.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 12px; color: #444;';
    metrics.innerHTML = `
        <div><strong>Authenticity:</strong> ${(10 - aiProb/10).toFixed(1)}/10</div>
        <div><strong>Model:</strong> Gemini 2.0</div>
        <div><strong>Perplexity:</strong> ${analysis.perplexity || Math.floor((1 - aiProb/100) * 200)}</div>
        <div><strong>Account:</strong> Multi-batch</div>
    `;
    
    const signals = document.createElement('div');
    signals.style.cssText = 'margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 11px; color: #666;';
    signals.innerHTML = `
        <strong>🤖 Powered by Gemini 2.0 Flash</strong><br>
        AI Probability: ${aiProb}%<br>
        Confidence: ${confValue}%<br>
        Batch Processing: ${analysis.batch_id || 'N/A'}
    `;
    
    // ⭐ REASONING DISPLAY
    const reasoning = document.createElement('div');
    reasoning.className = 'reasoning';
    const riskLevel = getRiskLevel(aiProb);
    reasoning.setAttribute('data-risk', riskLevel);
    
    reasoning.style.cssText = `
        margin-top: 12px;
        padding: 10px 12px;
        background: linear-gradient(135deg, ${getReasoningBgColor(aiProb)} 0%, ${getReasoningBgColorDark(aiProb)} 100%);
        border-left: 3px solid ${getRiskColor(aiProb)};
        border-radius: 6px;
        font-size: 13px;
        color: #2d3748;
        line-height: 1.6;
        font-style: italic;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    `;
    
    const reasoningHeader = document.createElement('div');
    reasoningHeader.style.cssText = 'font-weight: 700; font-style: normal; margin-bottom: 6px; color: #1a202c;';
    reasoningHeader.textContent = '🔍 Analysis:';
    
    const reasoningText = document.createElement('div');
    reasoningText.textContent = analysis.reasoning || 'Analysis completed using Gemini multi-account batching system.';
    
    reasoning.appendChild(reasoningHeader);
    reasoning.appendChild(reasoningText);
    
    card.appendChild(riskBadge);
    card.appendChild(title);
    card.appendChild(url);
    card.appendChild(probDiv);
    card.appendChild(confidence);
    card.appendChild(metrics);
    card.appendChild(signals);
    card.appendChild(reasoning);
    
    container.appendChild(card);
}

// Helper functions
function getRiskLevel(aiProb) {
    if (aiProb < 30) return 'low';
    if (aiProb < 60) return 'medium';
    return 'high';
}

function getReasoningBgColor(aiProb) {
    if (aiProb < 30) return '#d1fae5';
    if (aiProb < 60) return '#fef3c7';
    return '#fee2e2';
}

function getReasoningBgColorDark(aiProb) {
    if (aiProb < 30) return '#a7f3d0';
    if (aiProb < 60) return '#fde68a';
    return '#fecaca';
}

function getRiskLabel(aiProb) {
    if (aiProb < 30) return 'Low Risk';
    if (aiProb < 60) return 'Medium Risk';
    return 'High Risk';
}

function getRiskColor(aiProb) {
    if (aiProb < 30) return '#10b981';
    if (aiProb < 60) return '#f59e0b';
    return '#ef4444';
}

function getRiskBgColor(aiProb) {
    if (aiProb < 30) return '#d1fae5';
    if (aiProb < 60) return '#fef3c7';
    return '#fee2e2';
}

function getRiskTextColor(aiProb) {
    if (aiProb < 30) return '#065f46';
    if (aiProb < 60) return '#92400e';
    return '#991b1b';
}

function getConfidenceLabel(confidence) {
    if (confidence >= 70) return 'High';
    if (confidence >= 50) return 'Medium';
    return 'Low';
}