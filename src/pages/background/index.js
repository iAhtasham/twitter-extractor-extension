console.log("background loaded");

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.action);
    
    if (message.action === 'startDirectScrape') {
        const { tabId, waitTime } = message;
        
        // Execute the scraper script
        chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            files: ['assets/js/directScraper.js']
        }).then(() => {
            console.log('Direct scraper injected successfully');
        }).catch((err) => {
            console.error('Failed to inject scraper:', err);
        });
        
        sendResponse({ success: true });
        return true;
    }
    
    // Handle scraping complete - open analytics page
    if (message.action === 'getPost' && message.source) {
        console.log('[Background] Scraping complete, saving data and opening analytics...');
        
        // Store data in chrome.storage.local
        chrome.storage.local.set({ postData: message.source }, function() {
            console.log('[Background] Data saved to storage');
            
            // Open the NEW direct analytics page (not the old React one)
            chrome.tabs.create({ url: 'src/pages/analytic/direct.html' });
        });
    }
    
    if (message.action === 'getStatus') {
        console.log('[Background] Status:', message.source);
    }
});
