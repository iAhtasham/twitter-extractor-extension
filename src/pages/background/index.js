console.log("background loaded");

// Store for reply scraping queue
let replyQueue = [];
let mainTweets = [];
let allReplies = [];
let currentReplyIndex = 0;
let scrapeWaitTime = 2;
let currentScrapingTabId = null;

// Listen for tab updates to know when page is loaded
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only care about our scraping tab and when it's done loading
    if (tabId === currentScrapingTabId && changeInfo.status === 'complete' && replyQueue.length > 0) {
        console.log('[Background] Page loaded, injecting scraper...');
        
        // Small delay to ensure page is ready
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (waitTime) => {
                    window.scraperWaitTime = waitTime;
                    window.scraperScrapeReplies = false; // Don't recurse
                    window.allArticle = []; // Reset for new page
                    window.articleChecker = [];
                },
                args: [scrapeWaitTime]
            }).then(() => {
                return chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['assets/js/directScraper.js']
                });
            }).then(() => {
                console.log('[Background] Reply scraper injected');
            }).catch(err => {
                console.error('[Background] Failed to inject reply scraper:', err);
                currentReplyIndex++;
                scrapeNextReply(tabId);
            });
        }, 1500);
    }
});

// Function to scrape next reply URL
async function scrapeNextReply(tabId) {
    if (currentReplyIndex >= replyQueue.length) {
        // All done! Combine main tweets with replies
        console.log('[Background] All replies scraped. Total replies:', allReplies.length);
        currentScrapingTabId = null;
        
        // Combine main tweets + all replies
        const allData = [...mainTweets, ...allReplies];
        
        // Save and open analytics
        chrome.storage.local.set({ postData: JSON.stringify(allData) }, function() {
            console.log('[Background] All data saved. Total:', allData.length);
            chrome.tabs.create({ url: 'src/pages/analytic/direct.html' });
        });
        
        // Reset state
        replyQueue = [];
        mainTweets = [];
        allReplies = [];
        currentReplyIndex = 0;
        return;
    }
    
    const current = replyQueue[currentReplyIndex];
    console.log('[Background] Scraping replies from:', current.tweetUrl, `(${currentReplyIndex + 1}/${replyQueue.length})`);
    
    currentScrapingTabId = tabId;
    
    // Navigate to the status page - onUpdated listener will handle injection when page loads
    chrome.tabs.update(tabId, { url: current.tweetUrl });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.action);
    
    if (message.action === 'startDirectScrape') {
        const { tabId, waitTime } = message;
        
        // Reset state for new scrape
        replyQueue = [];
        mainTweets = [];
        allReplies = [];
        currentReplyIndex = 0;
        scrapeWaitTime = waitTime || 2;
        
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
    
    // Handle request to scrape replies from multiple URLs
    if (message.action === 'scrapeReplies') {
        console.log('[Background] Starting reply scraping for', message.replyUrls.length, 'posts');
        
        mainTweets = JSON.parse(message.mainTweets);
        replyQueue = message.replyUrls;
        currentReplyIndex = 0;
        scrapeWaitTime = message.waitTime || 2;
        allReplies = [];
        
        // Start scraping replies from the same tab
        if (sender.tab) {
            console.log('[Background] Starting scrape from tab:', sender.tab.id);
            scrapeNextReply(sender.tab.id);
            sendResponse({ success: true, message: 'Reply scraping started' });
        } else {
            console.error('[Background] No sender tab found!');
            sendResponse({ success: false, message: 'No tab found' });
        }
        return true;
    }
    
    // Handle scraping complete - check if we're in reply mode
    if (message.action === 'getPost' && message.source) {
        const scrapedData = JSON.parse(message.source);
        
        // If we're scraping replies, add to allReplies and continue
        if (replyQueue.length > 0 && currentReplyIndex < replyQueue.length) {
            // Skip the first tweet (it's the original), add only replies
            const replies = scrapedData.filter(t => t.isReply);
            console.log('[Background] Got', replies.length, 'replies from post', currentReplyIndex + 1);
            
            // Tag replies with parent tweet info
            const parentTweet = replyQueue[currentReplyIndex];
            const parentTweetId = parentTweet.tweetId;
            const parentTweetUrl = parentTweet.tweetUrl;
            // Find the parent tweet's username from the URL (x.com/username/status/id)
            const parentUsername = parentTweetUrl ? parentTweetUrl.split('/')[3] : '';
            
            replies.forEach(r => {
                r.parentTweetId = parentTweetId;
                r.parentTweetUrl = parentTweetUrl;
                r.parentUsername = parentUsername;
            });
            
            allReplies.push(...replies);
            currentReplyIndex++;
            
            // Continue to next reply URL
            if (sender.tab) {
                scrapeNextReply(sender.tab.id);
            }
            return true;
        }
        
        // Normal completion - save data and open analytics
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
