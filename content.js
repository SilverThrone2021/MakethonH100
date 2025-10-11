// Extract answer and sources from Perplexity
function extractPerplexityData() {
  console.log("Extracting Perplexity data...");
  
  // Extract the main answer text from the prose container
  const answerElements = document.querySelectorAll('div.prose p, div.prose li');
  const answer = Array.from(answerElements)
    .map(el => el.innerText)
    .join('\n')
    .trim();
  
  console.log("Found answer:", answer.substring(0, 100) + "...");
  
  // Extract sources - look for citation links
  // Perplexity typically shows sources as numbered citations [1], [2], etc.
  // and has a sources section
  const sources = [];
  const seenUrls = new Set();
  
  // Method 1: Find citation links (usually superscript numbers)
  const citationLinks = document.querySelectorAll('a[href^="http"]');
  
  citationLinks.forEach(link => {
    const url = link.href;
    const title = link.innerText || link.getAttribute('aria-label') || 'Source';
    
    // Avoid duplicates and non-article links
    if (!seenUrls.has(url) && 
        !url.includes('perplexity.ai') &&
        !url.includes('twitter.com') &&
        !url.includes('facebook.com')) {
      seenUrls.add(url);
      sources.push({ url, title: title.trim() });
    }
  });
  
  // Method 2: Look for a dedicated sources section
  const sourcesSection = document.querySelector('[class*="source"]');
  if (sourcesSection) {
    const sourceLinks = sourcesSection.querySelectorAll('a[href^="http"]');
    sourceLinks.forEach(link => {
      const url = link.href;
      const title = link.innerText || link.textContent || 'Source';
      
      if (!seenUrls.has(url) && !url.includes('perplexity.ai')) {
        seenUrls.add(url);
        sources.push({ url, title: title.trim() });
      }
    });
  }
  
  console.log("Found sources:", sources);
  
  return { 
    answer: answer || "No answer found", 
    sources: sources.length > 0 ? sources : [{url: "https://example.com", title: "No sources found"}]
  };
}

// Test extraction immediately when script loads (for debugging)
console.log("Content script loaded on:", window.location.href);

// Listen for requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received:", request);
  
  if (request.action === "extractData") {
    const data = extractPerplexityData();
    sendResponse(data);
  }
  
  return true; // Keep message channel open for async response
});

// Also add a way to manually trigger from console for testing
window.testExtraction = extractPerplexityData;