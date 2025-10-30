let isAnalyzing = false;
const BACKEND_URL = 'https://facile-jaiden-jadishly.ngrok-free.dev';

async function checkServerStatus() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        if (response.ok) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Online';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Offline';
        }
    } catch (error) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Offline';
    }
}

async function runAnalysis() {
    if (isAnalyzing) return;

    isAnalyzing = true;
    const resultsDiv = document.getElementById('results');
    const btn = document.getElementById('analyze');

    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    function updateProgress(text) {
        resultsDiv.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <div class="loading-text">${text}</div>
            </div>
        `;
    }

    updateProgress('Getting sources from page...');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url || !tab.url.includes('perplexity.ai')) {
            resultsDiv.innerHTML = `<div class="empty-state">Not on a Perplexity page.</div>`;
            return;
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => new Promise(resolve => {
                chrome.runtime.sendMessage({ action: "extractData" }, response => {
                    resolve(response);
                });
            })
        });

        const extractedData = result[0].result;

        if (!extractedData || !extractedData.sources || extractedData.sources.length === 0) {
            resultsDiv.innerHTML = `<div class="error-message">No sources found on this page.</div>`;
            return;
        }

        const sources = extractedData.sources;
        updateProgress(`Found ${sources.length} sources. Analyzing with Gemini...`);

        const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources: sources.slice(0, 10) })
        });

        if (!response.ok) throw new Error(`Backend error: ${response.status}`);

        const data = await response.json();
        displayResults(data);

    } catch (error) {
        console.error('Analysis error:', error);
        resultsDiv.innerHTML = `<div class="error-message">Analysis Failed: ${error.message}</div>`;
    } finally {
        isAnalyzing = false;
        btn.disabled = false;
        btn.textContent = 'Analyze Sources';
    }
}

function displayResults(results) {
    const container = document.getElementById('results');
    container.innerHTML = '';

    if (!results || results.length === 0) {
        container.innerHTML = `<div class="empty-state">No high-risk sources found.</div>`;
        return;
    }

    results.forEach(result => createResultCard(container, result));
}

function createResultCard(container, result) {
    const analysis = result.analysis || {};
    const aiProb = analysis.ai_probability || 0;

    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.borderLeftColor = getRiskColor(aiProb);

    card.innerHTML = `
        <div class="risk-badge" style="background:${getRiskBgColor(aiProb)}; color:${getRiskTextColor(aiProb)}">${getRiskLabel(aiProb)}</div>
        <div class="title">${result.title || new URL(result.url).hostname}</div>
        <a href="${result.url}" target="_blank" class="url">${new URL(result.url).hostname}</a>
        <div class="prob-div">${aiProb}%</div>
        <div class="confidence">Confidence: ${getConfidenceLabel(analysis.confidence || 50)} (${analysis.confidence || 50}%)</div>
        <div class="metrics">
            <div><strong>Authenticity:</strong> ${(10 - aiProb/10).toFixed(1)}/10</div>
            <div><strong>Model:</strong> Gemini 2.0</div>
            <div><strong>Perplexity:</strong> ${analysis.perplexity || Math.floor((1 - aiProb/100) * 200)}</div>
            <div><strong>Account:</strong> Multi-batch</div>
        </div>
        <div class="reasoning" style="background:linear-gradient(135deg, ${getReasoningBgColor(aiProb)} 0%, ${getReasoningBgColorDark(aiProb)} 100%); border-left-color:${getRiskColor(aiProb)}">
            <div class="reasoning-header">🔍 Analysis:</div>
            <div>${analysis.reasoning || 'Analysis completed.'}</div>
        </div>
    `;

    container.appendChild(card);
}

// Helper functions for styling (condensed for brevity)
function getRiskColor(p) { return p < 30 ? '#10b981' : p < 60 ? '#f59e0b' : '#ef4444'; }
function getRiskBgColor(p) { return p < 30 ? '#d1fae5' : p < 60 ? '#fef3c7' : '#fee2e2'; }
function getRiskTextColor(p) { return p < 30 ? '#065f46' : p < 60 ? '#92400e' : '#991b1b'; }
function getRiskLabel(p) { return p < 30 ? 'Low Risk' : p < 60 ? 'Medium Risk' : 'High Risk'; }
function getReasoningBgColor(p) { return p < 30 ? '#d1fae5' : p < 60 ? '#fef3c7' : '#fee2e2'; }
function getReasoningBgColorDark(p) { return p < 30 ? '#a7f3d0' : p < 60 ? '#fde68a' : '#fecaca'; }
function getConfidenceLabel(c) { return c >= 70 ? 'High' : c >= 50 ? 'Medium' : 'Low'; }

// Event Listeners
document.getElementById('analyze').addEventListener('click', runAnalysis);
document.getElementById('refresh').addEventListener('click', runAnalysis);
chrome.tabs.onActivated.addListener(runAnalysis);

// Initial setup
checkServerStatus();
setInterval(checkServerStatus, 30000); // Check every 30 seconds
runAnalysis();
