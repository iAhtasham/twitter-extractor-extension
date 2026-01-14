// Bulk Keyword Scraper - popup.js

const MAX_KEYWORDS = 20;

// Debug helper
function debug(msg) {
    console.log('[BulkPopup]', msg);
    var el = document.getElementById('debug');
    if (el) el.textContent = msg;
}

function setStatus(text, type) {
    var el = document.getElementById('status');
    el.textContent = text;
    el.className = 'status ' + (type || 'info');
}

// Show/hide sections
function showStats(show) {
    var statsEl = document.getElementById('stats-section');
    var settingsEl = document.getElementById('settings-section');
    if (statsEl) statsEl.style.display = show ? 'block' : 'none';
    if (settingsEl) settingsEl.style.display = show ? 'none' : 'block';
}

// Parse keywords from textarea
function parseKeywords(text) {
    return text
        .split('\n')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .slice(0, MAX_KEYWORDS);
}

// Update keyword count display
function updateKeywordCount() {
    var textarea = document.getElementById('keywords-input');
    var countEl = document.getElementById('keyword-count');
    var btn = document.getElementById('scrape-btn');
    
    var keywords = parseKeywords(textarea.value);
    var count = keywords.length;
    
    countEl.textContent = count + ' / ' + MAX_KEYWORDS + ' keywords';
    countEl.className = 'keyword-count';
    
    if (count > MAX_KEYWORDS) {
        countEl.className = 'keyword-count error';
        countEl.textContent = 'Too many keywords! Max ' + MAX_KEYWORDS;
    } else if (count > 15) {
        countEl.className = 'keyword-count warning';
    }
    
    btn.disabled = count === 0 || count > MAX_KEYWORDS;
}

// Update stats display
function updateStats(state) {
    if (!state) return;
    
    var progressEl = document.getElementById('stat-progress');
    var activeTabsEl = document.getElementById('stat-active-tabs');
    var totalTweetsEl = document.getElementById('stat-total-tweets');
    var progressFillEl = document.getElementById('progress-fill');
    var activeKeywordsEl = document.getElementById('active-keywords');
    
    if (progressEl) {
        progressEl.textContent = (state.completedKeywords || 0) + '/' + (state.totalKeywords || 0);
    }
    
    var activeTabs = state.activeTabs ? state.activeTabs.filter(t => t.status !== 'done').length : 0;
    if (activeTabsEl) {
        activeTabsEl.textContent = activeTabs;
    }
    
    var totalTweets = 0;
    if (state.allResults) {
        state.allResults.forEach(r => totalTweets += r.tweets.length);
    }
    if (totalTweetsEl) {
        totalTweetsEl.textContent = totalTweets;
    }
    
    // Progress bar
    if (progressFillEl && state.totalKeywords > 0) {
        var percent = (state.completedKeywords / state.totalKeywords) * 100;
        progressFillEl.style.width = percent + '%';
    }
    
    // Active keywords
    if (activeKeywordsEl && state.activeTabs) {
        var activeList = state.activeTabs
            .filter(t => t.status !== 'done')
            .map(t => '<span>' + escapeHtml(t.keyword) + '</span>')
            .join('');
        activeKeywordsEl.innerHTML = activeList ? 'Currently scraping: ' + activeList : '';
    }
    
    // Update status
    if (state.statusMessage) {
        var statusEl = document.getElementById('status');
        statusEl.textContent = state.statusMessage;
        statusEl.style.color = state.statusColor || '#1da1f2';
    }
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Check bulk state from storage
function checkBulkState(callback) {
    chrome.storage.local.get(['bulkState'], function(result) {
        if (chrome.runtime.lastError) {
            debug('Storage error: ' + chrome.runtime.lastError.message);
            callback(null);
            return;
        }
        callback(result.bulkState || null);
    });
}

// Poll for state updates
var pollInterval = null;
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(function() {
        checkBulkState(function(state) {
            if (state && state.isRunning) {
                updateStats(state);
            } else if (state && !state.isRunning && state.completedKeywords > 0) {
                updateStats(state);
                stopPolling();
            } else {
                stopPolling();
                showStats(false);
            }
        });
    }, 1000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

debug('Script loaded');

// Setup textarea listener
document.getElementById('keywords-input').addEventListener('input', updateKeywordCount);

// Check if bulk scraping is already running
checkBulkState(function(state) {
    debug('Bulk state check: ' + JSON.stringify(state));
    
    if (state && state.isRunning) {
        debug('Bulk scrape in progress - showing stats');
        showStats(true);
        updateStats(state);
        startPolling();
    } else if (state && state.completedKeywords > 0 && state.totalKeywords > 0) {
        debug('Bulk scrape complete - showing stats');
        showStats(true);
        updateStats(state);
    } else {
        debug('No active bulk scrape');
        setStatus('Enter keywords to start', 'info');
    }
});

// Start button handler
document.getElementById('scrape-btn').onclick = function() {
    var btn = this;
    btn.disabled = true;
    setStatus('Starting bulk scrape...', 'info');
    debug('Start clicked');
    
    var keywords = parseKeywords(document.getElementById('keywords-input').value);
    
    if (keywords.length === 0) {
        setStatus('Please enter at least one keyword', 'error');
        btn.disabled = false;
        return;
    }
    
    if (keywords.length > MAX_KEYWORDS) {
        setStatus('Maximum ' + MAX_KEYWORDS + ' keywords allowed', 'error');
        btn.disabled = false;
        return;
    }
    
    var settings = {
        waitTime: parseInt(document.getElementById('wait-time').value) || 2,
        maxTweets: parseInt(document.getElementById('max-tweets').value) || 50,
        scrapeReplies: false, // Replies not supported in bulk mode
        includeMedia: true,
        includeMetrics: true
    };
    
    var maxConcurrentTabs = parseInt(document.getElementById('concurrent-tabs').value) || 3;
    maxConcurrentTabs = Math.min(Math.max(maxConcurrentTabs, 1), 5);
    
    debug('Settings: ' + JSON.stringify(settings));
    debug('Keywords: ' + keywords.join(', '));
    
    chrome.runtime.sendMessage({
        action: 'startBulkScrape',
        keywords: keywords,
        settings: settings,
        maxConcurrentTabs: maxConcurrentTabs
    }, function(response) {
        if (chrome.runtime.lastError) {
            setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
            btn.disabled = false;
            return;
        }
        
        if (response && response.success) {
            setStatus('✅ Bulk scraping started!', 'success');
            showStats(true);
            startPolling();
        } else {
            setStatus('Failed to start: ' + (response ? response.message : 'Unknown error'), 'error');
            btn.disabled = false;
        }
    });
};

// Cancel button handler
document.getElementById('cancel-btn').onclick = function() {
    setStatus('Cancelling...', 'warning');
    
    chrome.runtime.sendMessage({
        action: 'cancelBulkScrape'
    }, function(response) {
        if (response && response.success) {
            setStatus('Cancelled', 'warning');
            stopPolling();
            showStats(false);
            document.getElementById('scrape-btn').disabled = false;
        }
    });
};

debug('Handlers registered');
