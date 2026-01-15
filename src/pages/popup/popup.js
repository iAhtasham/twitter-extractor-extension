// Check if bulk scraping is running - redirect to bulk.html if so
chrome.storage.local.get(['bulkState'], function(result) {
    if (result.bulkState && result.bulkState.isRunning) {
        console.log('[Popup] Bulk scraping in progress - redirecting to bulk.html');
        window.location.href = 'bulk.html';
    }
});

// Debug helper
function debug(msg) {
    console.log('[Popup]', msg);
    var el = document.getElementById('debug');
    if (el) el.textContent = msg;
}

function setStatus(text, type) {
    var el = document.getElementById('status');
    el.textContent = text;
    el.className = 'status ' + (type || 'info');
}

// Show/hide stats section
function showStats(show) {
    var statsEl = document.getElementById('stats-section');
    var settingsEl = document.getElementById('settings-section');
    if (statsEl) statsEl.style.display = show ? 'block' : 'none';
    if (settingsEl) settingsEl.style.display = show ? 'none' : 'block';
}

// Update stats display
function updateStats(state) {
    if (!state) return;
    
    var phaseEl = document.getElementById('stat-phase');
    var tweetsEl = document.getElementById('stat-tweets');
    var repliesEl = document.getElementById('stat-replies');
    var progressEl = document.getElementById('stat-reply-progress');
    
    if (phaseEl) {
        var phaseText = state.phase === 'main' ? 'Main Page' : 
                        state.phase === 'replies' ? 'Reply Scraping' : 
                        state.phase === 'complete' ? 'Complete' : state.phase;
        phaseEl.textContent = phaseText;
    }
    if (tweetsEl) tweetsEl.textContent = state.tweetsScraped || 0;
    if (repliesEl) repliesEl.textContent = state.repliesScraped || 0;
    if (progressEl && state.totalReplyPosts > 0) {
        progressEl.textContent = state.currentReplyPost + '/' + state.totalReplyPosts;
    } else if (progressEl) {
        progressEl.textContent = '-';
    }
    
    // Update status with state message
    if (state.statusMessage) {
        var statusEl = document.getElementById('status');
        statusEl.textContent = state.statusMessage;
        statusEl.style.color = state.statusColor || '#1da1f2';
    }
}

// Check scraping state from storage directly (more reliable than messaging)
function checkScrapingState(callback) {
    chrome.storage.local.get(['scrapingState'], function(result) {
        if (chrome.runtime.lastError) {
            debug('Storage error: ' + chrome.runtime.lastError.message);
            callback(null);
            return;
        }
        callback(result.scrapingState || null);
    });
}

// Poll for state updates
var pollInterval = null;
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(function() {
        checkScrapingState(function(state) {
            if (state && state.isRunning) {
                updateStats(state);
            } else if (state && !state.isRunning && state.phase === 'complete') {
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

// Get current tab
function getTab(callback) {
    debug('Querying tabs...');
    try {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            debug('Got tabs: ' + (tabs ? tabs.length : 'null'));
            if (chrome.runtime.lastError) {
                debug('Error: ' + chrome.runtime.lastError.message);
                callback(null, chrome.runtime.lastError.message);
                return;
            }
            if (tabs && tabs.length > 0) {
                callback(tabs[0], null);
            } else {
                callback(null, 'No tabs found');
            }
        });
    } catch (e) {
        debug('Exception: ' + e.message);
        callback(null, e.message);
    }
}

// Check if URL is a search page
function isSearchPage(url) {
    if (!url) return false;
    return url.indexOf('x.com/search') !== -1 || url.indexOf('twitter.com/search') !== -1;
}

debug('Script loaded');

// Check if scraping is already running
checkScrapingState(function(state) {
    debug('State check: ' + JSON.stringify(state));
    
    if (state && state.isRunning) {
        debug('Scrape in progress - showing stats');
        showStats(true);
        updateStats(state);
        startPolling();
    } else if (state && state.phase === 'complete') {
        debug('Scrape complete - showing stats');
        showStats(true);
        updateStats(state);
    } else {
        debug('No active scrape - showing normal UI');
        initNormalUI();
    }
});

function initNormalUI() {
    // Get current tab
    getTab(function(tab, error) {
        if (error) {
            setStatus('Error: ' + error, 'error');
            debug('Tab error: ' + error);
            return;
        }
        
        var url = tab.url || '';
        debug('URL: ' + url.substring(0, 50));
        
        if (isSearchPage(url)) {
            setStatus('✅ Ready to scrape!', 'success');
            document.getElementById('scrape-btn').disabled = false;
        } else if (url.indexOf('chrome://') === 0) {
            setStatus('Cannot run on chrome:// pages', 'warning');
        } else {
            setStatus('Go to x.com/search?q=... first', 'warning');
        }
    });
}

// Button click handler
document.getElementById('scrape-btn').onclick = function() {
    var btn = this;
    btn.disabled = true;
    setStatus('Starting...', 'info');
    debug('Button clicked');
    
    // Gather all settings
    var waitTime = parseInt(document.getElementById('wait-time').value) || 2;
    var maxTweets = parseInt(document.getElementById('max-tweets').value) || 0;
    var scrapeReplies = document.getElementById('scrape-replies').checked;
    var includeMedia = document.getElementById('include-media').checked;
    var includeMetrics = document.getElementById('include-metrics').checked;
    
    var settings = {
        waitTime: waitTime,
        maxTweets: maxTweets,
        scrapeReplies: scrapeReplies,
        includeMedia: includeMedia,
        includeMetrics: includeMetrics
    };
    
    debug('Settings: ' + JSON.stringify(settings));
    
    getTab(function(tab, error) {
        if (error || !tab) {
            setStatus('Error: ' + (error || 'No tab'), 'error');
            btn.disabled = false;
            return;
        }
        
        debug('Injecting into tab ' + tab.id);
        
        // Inject settings first
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function(s) { 
                window.scraperSettings = s;
                window.scraperWaitTime = s.waitTime;
            },
            args: [settings]
        }, function() {
            if (chrome.runtime.lastError) {
                setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
                debug('Inject error: ' + chrome.runtime.lastError.message);
                btn.disabled = false;
                return;
            }
            
            // Inject scraper
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['assets/js/directScraper.js']
            }, function() {
                if (chrome.runtime.lastError) {
                    setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
                    debug('Script error: ' + chrome.runtime.lastError.message);
                    btn.disabled = false;
                    return;
                }
                
                setStatus('✅ Scraper running!', 'success');
                debug('Script injected successfully');
                
                // Show stats and start polling instead of closing
                showStats(true);
                startPolling();
            });
        });
    });
};

debug('Handlers registered');
