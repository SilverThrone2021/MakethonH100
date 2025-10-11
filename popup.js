let isAnalyzing = false;

document.getElementById('analyze').addEventListener('click', async () => {
  if (isAnalyzing) {
    console.log("Already analyzing, please wait...");
    return;
  }
  
  isAnalyzing = true;
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '<p>Loading...</p>';
  
  try {
    // Get data from content script
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Use Promise wrapper to avoid multiple callbacks
    const data = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {action: "extractData"}, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log("Received data from content script:", data);
    
    if (!data || !data.sources) {
      resultsDiv.innerHTML = '<p style="color: red;">No sources found on this page. Make sure you\'re on a Perplexity.ai results page.</p>';
      isAnalyzing = false;
      return;
    }
    
    resultsDiv.innerHTML = '<p>Analyzing ' + data.sources.length + ' sources... (this may take 20-30 seconds)</p>';
    
    // Send to backend for analysis
    console.log("Sending to backend:", data.sources);
    
    // Your ngrok URL
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
    isAnalyzing = false;
    
  } catch (error) {
    console.error("Error:", error);
    resultsDiv.innerHTML = `<p style="color: red;">Error: ${error.message}</p>
      <p style="font-size: 12px;">Make sure:<br>
      1. Flask server is running (python app.py)<br>
      2. You're on perplexity.ai<br>
      3. Check browser console (F12) for details</p>`;
    isAnalyzing = false;
  }
});

function displayResults(results) {
  const container = document.getElementById('results');
  
  if (!results || results.length === 0) {
    container.innerHTML = '<p>No results to display</p>';
    return;
  }
  
  container.innerHTML = results.map(r => {
    const analysis = r.analysis || {};
    const likelihood = analysis.ai_likelihood || 0;
    const riskClass = likelihood > 70 ? 'high-risk' : likelihood > 40 ? 'medium-risk' : '';
    
    return `
      <div class="source ${riskClass}">
        <strong>${escapeHtml(r.title || 'Unknown')}</strong><br>
        <a href="${escapeHtml(r.url)}" target="_blank" style="font-size: 11px; color: #666;">${escapeHtml(r.url.substring(0, 50))}...</a><br>
        <br>
        ${analysis.error ? 
          `<span style="color: red;">Error: ${escapeHtml(analysis.error)}</span>` :
          `
          <strong>AI Likelihood:</strong> ${likelihood}%<br>
          <strong>Quality:</strong> ${escapeHtml(analysis.quality || 'N/A')}<br>
          <strong>Has Fluff:</strong> ${escapeHtml(analysis.has_fluff || 'N/A')}<br>
          <em style="font-size: 12px;">${escapeHtml(analysis.reasoning || 'No reasoning provided')}</em>
          `
        }
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}