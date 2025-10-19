let isAnalyzing = false;

document.getElementById('analyze').addEventListener('click', async () => {
  if (isAnalyzing) {
    console.log("Already analyzing, please wait...");
    return;
  }
  
  isAnalyzing = true;
  const resultsDiv = document.getElementById('results');
  const btn = document.getElementById('analyze');
  
  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  
  resultsDiv.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">Initializing...</div>
    </div>
  `;
  
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    if (!tab.url.includes('perplexity.ai')) {
      resultsDiv.innerHTML = `
        <div class="error-message">
          <div class="error-title">⚠️ Wrong Page</div>
          Please navigate to a Perplexity.ai search results page first.
        </div>
      `;
      btn.disabled = false;
      btn.textContent = 'Analyze Sources';
      isAnalyzing = false;
      return;
    }
    
    let data;
    try {
      data = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, {action: "extractData"}, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    } catch (msgError) {
      console.log("Content script not responding, trying to reinject...");
      resultsDiv.querySelector('.loading-text').textContent = 'Reconnecting...';
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        data = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, {action: "extractData"}, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
      } catch (reinjectError) {
        throw new Error("Could not communicate with page. Please refresh the Perplexity page and try again.");
      }
    }
    
    console.log("Received data from content script:", data);
    
    if (!data || !data.sources) {
      resultsDiv.innerHTML = `
        <div class="error-message">
          <div class="error-title">⚠️ No Sources Found</div>
          No sources found on this page. Make sure you're on a Perplexity.ai results page with search results.
        </div>
      `;
      btn.disabled = false;
      btn.textContent = 'Analyze Sources';
      isAnalyzing = false;
      return;
    }
    
    resultsDiv.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <div class="loading-text">Analyzing ${data.sources.length} source${data.sources.length !== 1 ? 's' : ''}...</div>
      </div>
    `;
    
    console.log("Sending to backend:", data.sources);
    
    const BACKEND_URL = 'https://facile-jaiden-jadishly.ngrok-free.dev';
    
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sources: data.sources})
    });
    
    console.log("Response status:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend error (${response.status}): ${errorText}`);
    }
    
    const results = await response.json();
    console.log("Results:", results);
    
    displayResults(results);
    btn.disabled = false;
    btn.textContent = 'Analyze Sources';
    isAnalyzing = false;
    
  } catch (error) {
    console.error("Error:", error);
    resultsDiv.innerHTML = `
      <div class="error-message">
        <div class="error-title">⚠️ Analysis Failed</div>
        ${escapeHtml(error.message)}
        <div style="margin-top: 10px; font-size: 11px; opacity: 0.8;">
          <strong>Troubleshooting:</strong><br>
          • Ensure Flask server is running<br>
          • Verify you're on perplexity.ai<br>
          • Check browser console (F12)
        </div>
      </div>
    `;
    btn.disabled = false;
    btn.textContent = 'Analyze Sources';
    isAnalyzing = false;
  }
});

function displayResults(results) {
  const container = document.getElementById('results');
  
  if (!results || results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-text">No results to display</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = results.map(r => {
    const analysis = r.analysis || {};
    const likelihood = analysis.ai_likelihood || 0;
    const riskClass = likelihood > 70 ? 'high-risk' : likelihood > 40 ? 'medium-risk' : '';
    const riskBadgeClass = likelihood > 70 ? 'high' : likelihood > 40 ? 'medium' : 'low';
    const riskLabel = likelihood > 70 ? 'High' : likelihood > 40 ? 'Med' : 'Low';
    const fillClass = likelihood > 70 ? 'high' : likelihood > 40 ? 'medium' : 'low';
    
    if (analysis.error) {
      return `
        <div class="source-card">
          <div class="source-header">
            <div class="source-title">${escapeHtml(r.title || 'Unknown Source')}</div>
          </div>
          <a href="${escapeHtml(r.url)}" target="_blank" class="source-url">${escapeHtml(truncateUrl(r.url, 40))}</a>
          <div class="error-message" style="margin: 0;">
            <div class="error-title">⚠️ Error</div>
            ${escapeHtml(analysis.error)}
          </div>
        </div>
      `;
    }
    
    return `
      <div class="source-card ${riskClass}">
        <div class="source-header">
          <div class="source-title">${escapeHtml(r.title || 'Unknown Source')}</div>
          <span class="risk-badge ${riskBadgeClass}">${riskLabel}</span>
        </div>
        <a href="${escapeHtml(r.url)}" target="_blank" class="source-url">${escapeHtml(truncateUrl(r.url, 40))}</a>
        
        <div class="metrics-grid">
          <div class="metric-box">
            <div class="metric-label">AI Detection</div>
            <div class="metric-value">
              <span class="ai-percentage">${likelihood}%</span>
            </div>
            <div class="percentage-bar">
              <div class="percentage-fill ${fillClass}" style="width: 0%"></div>
            </div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Quality</div>
            <div class="metric-value">${escapeHtml(analysis.quality || 'N/A')}</div>
          </div>
        </div>
        
        <div class="metrics-grid">
          <div class="metric-box">
            <div class="metric-label">Fluff Content</div>
            <div class="metric-value">${escapeHtml(analysis.has_fluff || 'N/A')}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Risk Level</div>
            <div class="metric-value">${riskLabel} Risk</div>
          </div>
        </div>
        
        ${analysis.reasoning ? `
          <div class="reasoning">${escapeHtml(analysis.reasoning)}</div>
        ` : ''}
      </div>
    `;
  }).join('');
  
  // Animate the percentage bars after render
  setTimeout(() => {
    results.forEach((r, idx) => {
      const analysis = r.analysis || {};
      const likelihood = analysis.ai_likelihood || 0;
      const bars = document.querySelectorAll('.percentage-fill');
      if (bars[idx]) {
        bars[idx].style.width = likelihood + '%';
      }
    });
  }, 100);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;
  const start = url.substring(0, maxLength - 3);
  return start + '...';
}