const API_URL = "https://facile-jaiden-jadishly.ngrok-free.dev/analyze";

function isYouTubeShort() {
    return window.location.pathname.startsWith('/shorts/');
}

function getVideoId() {
    const match = window.location.pathname.match(/\/shorts\/([^\/]+)/);
    return match ? match[1] : null;
}

function getShortUrl(videoId) {
    return `https://youtube.com/shorts/${videoId}`;
}

function overlayBadge(prediction = "FAKE", confidence = 0.5) {
    document.querySelectorAll('.deepfake-overlay').forEach(e => e.remove());
    
    const overlay = document.createElement('div');
    overlay.className = 'deepfake-overlay';
    overlay.innerHTML = `
        <div class="deepfake-badge ${prediction.toLowerCase()}">
            <span class="deepfake-status">
                ${prediction === "FAKE" ? "⚠️ Deepfake" : prediction === "REAL" ? "✅ Real" : "🔍 Analyzing..."}
            </span>
            <span class="deepfake-confidence">
                (${Math.round(confidence * 100)}% confidence)
            </span>
        </div>
    `;

    const container = document.querySelector('ytd-reel-video-renderer[is-active]') ||
                      document.querySelector('#shorts-container') ||
                      document.querySelector('#player');

    if (!container) {
        console.warn("Deepfake overlay container not found");
        return;
    }

    container.style.position = "relative";
    overlay.style.position = "absolute";
    overlay.style.top = "20px";
    overlay.style.right = "20px";
    container.appendChild(overlay);
}

function showLoading() {
    overlayBadge("ANALYZING...", 0);
}

async function analyzeShort(videoUrl) {
    showLoading();
    try {
        const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_url: videoUrl })
        });

        const data = await res.json();

        if (data.verdict && data.confidence !== undefined) {
            overlayBadge(data.verdict.toUpperCase(), data.confidence);
        } else {
            overlayBadge("ERROR", 0);
            console.error("Invalid API response:", data);
        }
    } catch (e) {
        overlayBadge("ERROR", 0);
        console.error("Error analyzing video:", e);
    }
}

let lastVideoId = null;

function checkAndAnalyze() {
    if (!isYouTubeShort()) return;
    const videoId = getVideoId();
    if (!videoId || videoId === lastVideoId) return;

    lastVideoId = videoId;
    const videoUrl = getShortUrl(videoId);
    analyzeShort(videoUrl);
}

let lastHref = location.href;
new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        checkAndAnalyze();
    }
}).observe(document.body, { childList: true, subtree: true });

checkAndAnalyze();
