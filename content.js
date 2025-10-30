// Function to extract sources from Perplexity.ai
function extractPerplexityData() {
    const sources = [];
    const seenUrls = new Set();

    // Strategy 1: Target the specific source containers
    // Perplexity often uses a wrapper for each source with a title and a link.
    const sourceWrappers = document.querySelectorAll('div.mt-lg a.block, div[data-source] a');

    sourceWrappers.forEach(link => {
        const url = link.href;
        if (url && !seenUrls.has(url) && !url.includes('perplexity.ai')) {
            seenUrls.add(url);

            // Try to find a more descriptive title
            const titleElement = link.querySelector('div.text-sm, span.truncate');
            const title = titleElement ? titleElement.textContent.trim() : (link.textContent.trim() || new URL(url).hostname);

            sources.push({ url, title });
        }
    });

    // Strategy 2: Fallback to finding citation links if the first method fails
    // These are often numbered links like [1], [2], etc.
    if (sources.length === 0) {
        const citationLinks = document.querySelectorAll('a[href*="perplexity.ai/s/"]');
        citationLinks.forEach(link => {
            const url = link.href;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                const title = link.textContent.trim() || new URL(url).hostname;
                sources.push({ url, title });
            }
        });
    }

    // Strategy 3: A more generic fallback for any external link in the main content area
    if (sources.length === 0) {
        const contentArea = document.querySelector('div.prose, main');
        if (contentArea) {
            const links = contentArea.querySelectorAll('a[href^="http"]');
            links.forEach(link => {
                const url = link.href;
                // Exclude social media and other non-article links
                const excludedDomains = ['perplexity.ai', 'twitter.com', 'facebook.com', 'youtube.com'];
                if (url && !seenUrls.has(url) && !excludedDomains.some(domain => url.includes(domain))) {
                    seenUrls.add(url);
                    const title = link.textContent.trim() || new URL(url).hostname;
                    sources.push({ url, title });
                }
            });
        }
    }

    return { sources };
}

// Listen for messages from the popup/side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractData") {
        const data = extractPerplexityData();
        sendResponse(data);
    }
    return true; // Keep the message channel open for the asynchronous response
});
