console.log("background loaded");

// Store for reply scraping queue
let replyQueue = [];
let mainTweets = [];
let allReplies = [];
let currentReplyIndex = 0;
let scrapeWaitTime = 2;
let currentScrapingTabId = null;

// Scraping state for popup
let scrapingState = {
    isRunning: false,
    phase: '', // 'main', 'replies', 'complete'
    tweetsScraped: 0,
    repliesScraped: 0,
    totalReplyPosts: 0,
    currentReplyPost: 0,
    statusMessage: '',
    statusColor: '#8899a6'
};

// Load state from storage on startup (in case service worker was restarted)
chrome.storage.local.get(['scrapingState'], function(result) {
    if (result.scrapingState) {
        scrapingState = result.scrapingState;
        console.log('[Background] Restored state from storage:', scrapingState);
    }
});

// Update and persist scraping state
function updateScrapingState(updates) {
    Object.assign(scrapingState, updates);
    console.log('[Background] Saving state:', JSON.stringify(scrapingState));
    chrome.storage.local.set({ scrapingState: scrapingState }, function() {
        if (chrome.runtime.lastError) {
            console.error('[Background] State save error:', chrome.runtime.lastError);
        }
    });
}

// Reset scraping state
function resetScrapingState() {
    scrapingState = {
        isRunning: false,
        phase: '',
        tweetsScraped: 0,
        repliesScraped: 0,
        totalReplyPosts: 0,
        currentReplyPost: 0,
        statusMessage: 'Idle',
        statusColor: '#8899a6'
    };
    chrome.storage.local.set({ scrapingState: scrapingState });
}

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
        
        updateScrapingState({
            isRunning: false,
            phase: 'complete',
            statusMessage: `Complete! ${mainTweets.length} tweets + ${allReplies.length} replies`,
            statusColor: '#5ABD4E'
        });
        
        // Save and open analytics
        chrome.storage.local.set({ postData: JSON.stringify(allData) }, function() {
            console.log('[Background] All data saved. Total:', allData.length);
            chrome.tabs.create({ url: 'src/pages/analytic/direct.html' });
        });
        
        // Reset state after a delay
        setTimeout(() => resetScrapingState(), 5000);
        
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
    
    updateScrapingState({
        isRunning: true,
        currentReplyPost: currentReplyIndex + 1,
        statusMessage: `Replies ${currentReplyIndex + 1}/${replyQueue.length}: @${current.tweetUrl.split('/')[3]}`,
        statusColor: '#1da1f2'
    });
    
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
        
        updateScrapingState({
            isRunning: true,
            phase: 'main',
            tweetsScraped: 0,
            repliesScraped: 0,
            totalReplyPosts: 0,
            currentReplyPost: 0,
            statusMessage: 'Starting scrape...',
            statusColor: '#1da1f2'
        });
        
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
        
        updateScrapingState({
            isRunning: true,
            phase: 'replies',
            tweetsScraped: mainTweets.length,
            totalReplyPosts: replyQueue.length,
            currentReplyPost: 0,
            statusMessage: `Phase 2: Fetching replies from ${replyQueue.length} posts...`,
            statusColor: '#1da1f2'
        });
        
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
            
            updateScrapingState({
                isRunning: true,
                repliesScraped: allReplies.length
            });
            
            // Continue to next reply URL
            if (sender.tab) {
                scrapeNextReply(sender.tab.id);
            }
            return true;
        }
        
        // Normal completion (no reply scraping) - save data and open analytics
        console.log('[Background] Scraping complete, saving data and opening analytics...');
        
        updateScrapingState({
            isRunning: false,
            phase: 'complete',
            tweetsScraped: scrapedData.length,
            statusMessage: `Complete! ${scrapedData.length} tweets scraped`,
            statusColor: '#5ABD4E'
        });
        
        // Reset after delay
        setTimeout(() => resetScrapingState(), 5000);
        
        // Store data in chrome.storage.local
        chrome.storage.local.set({ postData: message.source }, function() {
            console.log('[Background] Data saved to storage');
            
            // Open the NEW direct analytics page (not the old React one)
            chrome.tabs.create({ url: 'src/pages/analytic/direct.html' });
        });
    }
    
    if (message.action === 'getStatus') {
        console.log('[Background] Status:', message.source);
        try {
            const status = JSON.parse(message.source);
            // Parse tweet count from status message like "21 tweets scraped (last: ...)"
            const match = status.content.match(/(\d+) tweets? scraped/);
            if (match) {
                updateScrapingState({
                    tweetsScraped: parseInt(match[1]),
                    statusMessage: status.content,
                    statusColor: status.color
                });
            } else {
                updateScrapingState({
                    statusMessage: status.content,
                    statusColor: status.color
                });
            }
        } catch (e) {
            console.error('[Background] Failed to parse status:', e);
        }
    }
    
    // Handle popup requesting current state
    if (message.action === 'getScrapingState') {
        sendResponse(scrapingState);
        return true;
    }
});
