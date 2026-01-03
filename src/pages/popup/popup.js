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

debug('Script loaded');

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

// Initialize
debug('Calling getTab...');
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

// Button click handler
document.getElementById('scrape-btn').onclick = function() {
    var btn = this;
    btn.disabled = true;
    setStatus('Starting...', 'info');
    debug('Button clicked');
    
    var waitTime = parseInt(document.getElementById('wait-time').value) || 2;
    
    getTab(function(tab, error) {
        if (error || !tab) {
            setStatus('Error: ' + (error || 'No tab'), 'error');
            btn.disabled = false;
            return;
        }
        
        debug('Injecting into tab ' + tab.id);
        
        // Inject wait time first
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function(wt) { window.scraperWaitTime = wt; },
            args: [waitTime]
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
                setTimeout(function() { window.close(); }, 1500);
            });
        });
    });
};

debug('Handlers registered');
