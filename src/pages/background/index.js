console.log("background loaded");

// Store for reply scraping queue
let replyQueue = [];
let mainTweets = [];
let allReplies = [];
let currentReplyIndex = 0;
let scrapeWaitTime = 2;
let currentScrapingTabId = null;
let scraperSettings = {}; // Store settings for reply phase

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

// ============================================
// BULK KEYWORD SCRAPING STATE
// ============================================
let bulkState = {
    isRunning: false,
    keywords: [],
    currentKeywordIndex: 0,
    completedKeywords: 0,
    totalKeywords: 0,
    activeTabs: [], // { tabId, keyword, status: 'loading'|'scraping'|'done', startTime: timestamp }
    allResults: [], // { keyword, tweets: [] }
    settings: {},
    maxConcurrentTabs: 3,
    statusMessage: 'Idle',
    statusColor: '#8899a6',
    timeoutCheckInterval: null
};

// Persist bulk state
function updateBulkState(updates) {
    Object.assign(bulkState, updates);
    console.log('[Background] Bulk state updated:', JSON.stringify(bulkState));
    chrome.storage.local.set({ bulkState: bulkState });
}

// Reset bulk state
function resetBulkState() {
    // Clear timeout check interval if it exists
    if (bulkState.timeoutCheckInterval) {
        clearInterval(bulkState.timeoutCheckInterval);
    }
    
    bulkState = {
        isRunning: false,
        keywords: [],
        currentKeywordIndex: 0,
        completedKeywords: 0,
        totalKeywords: 0,
        activeTabs: [],
        allResults: [],
        settings: {},
        maxConcurrentTabs: 3,
        statusMessage: 'Idle',
        statusColor: '#8899a6',
        timeoutCheckInterval: null
    };
    chrome.storage.local.set({ bulkState: bulkState });
}

// Load bulk state on startup
chrome.storage.local.get(['bulkState'], function(result) {
    if (result.bulkState) {
        bulkState = result.bulkState;
        console.log('[Background] Restored bulk state:', bulkState);
    }
});

// Open next batch of tabs for keywords
async function openNextKeywordTabs() {
    if (!bulkState.isRunning) return;
    
    console.log('[Background] openNextKeywordTabs - keywords array:', JSON.stringify(bulkState.keywords));
    console.log('[Background] openNextKeywordTabs - currentKeywordIndex:', bulkState.currentKeywordIndex);
    
    const availableSlots = bulkState.maxConcurrentTabs - bulkState.activeTabs.filter(t => t.status !== 'done').length;
    
    for (let i = 0; i < availableSlots; i++) {
        if (bulkState.currentKeywordIndex >= bulkState.keywords.length) break;
        
        const keyword = bulkState.keywords[bulkState.currentKeywordIndex];
        console.log('[Background] Processing keyword at index', bulkState.currentKeywordIndex, ':', keyword, '- type:', typeof keyword);
        bulkState.currentKeywordIndex++;
        
        // Build Twitter search URL
        const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
        
        console.log('[Background] Opening tab for keyword:', keyword, '- URL:', searchUrl);
        
        try {
            const tab = await chrome.tabs.create({ url: searchUrl, active: false });
            bulkState.activeTabs.push({
                tabId: tab.id,
                keyword: keyword,
                status: 'loading',
                startTime: Date.now()
            });
            
            updateBulkState({
                statusMessage: `Opening tabs... (${bulkState.currentKeywordIndex}/${bulkState.totalKeywords})`,
                statusColor: '#1da1f2'
            });
        } catch (err) {
            console.error('[Background] Failed to open tab for keyword:', keyword, err);
        }
    }
}

// Handle bulk tab loaded - inject scraper
async function handleBulkTabLoaded(tabId) {
    const tabInfo = bulkState.activeTabs.find(t => t.tabId === tabId);
    if (!tabInfo || tabInfo.status !== 'loading') return;
    
    console.log('[Background] Bulk tab loaded, injecting scraper for:', tabInfo.keyword);
    tabInfo.status = 'scraping';
    tabInfo.startTime = Date.now(); // Reset timer when scraping starts
    
    updateBulkState({
        statusMessage: `Scraping: "${tabInfo.keyword}"...`,
        statusColor: '#1da1f2'
    });
    
    // Small delay to ensure page is ready
    await new Promise(r => setTimeout(r, 1500));
    
    try {
        // Check if tab still exists
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log('[Background] Tab no longer exists for:', tabInfo.keyword);
            tabInfo.status = 'done';
            bulkState.completedKeywords++;
            checkBulkComplete();
            return;
        }
        
        // Inject settings
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (settings) => {
                window.scraperSettings = settings;
                window.scraperWaitTime = settings.waitTime;
                window.scraperScrapeReplies = settings.scrapeReplies;
                window.allArticle = [];
                window.articleChecker = [];
                window.isBulkScrape = true;
                window.bulkKeyword = settings.currentKeyword;
            },
            args: [{ ...bulkState.settings, currentKeyword: tabInfo.keyword }]
        });
        
        // Inject scraper
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['assets/js/directScraper.js']
        });
        
        console.log('[Background] Bulk scraper injected for:', tabInfo.keyword);
    } catch (err) {
        console.error('[Background] Failed to inject bulk scraper:', err);
        tabInfo.status = 'done';
        bulkState.completedKeywords++;
        
        // Try to close the problematic tab
        chrome.tabs.remove(tabId).catch(e => console.log('[Background] Could not close tab:', e));
        
        checkBulkComplete();
    }
}

// Handle bulk scrape result from a tab
function handleBulkResult(tabId, tweets) {
    const tabInfo = bulkState.activeTabs.find(t => t.tabId === tabId);
    if (!tabInfo) return;
    
    console.log('[Background] Received bulk result for:', tabInfo.keyword, '- Tweets:', tweets.length);
    
    // Tag tweets with keyword
    tweets.forEach(t => t.searchKeyword = tabInfo.keyword);
    
    bulkState.allResults.push({
        keyword: tabInfo.keyword,
        tweets: tweets
    });
    
    // Mark as done BEFORE closing tab to prevent onRemoved from double-processing
    tabInfo.status = 'done';
    bulkState.completedKeywords++;
    
    updateBulkState({
        completedKeywords: bulkState.completedKeywords,
        statusMessage: `Completed ${bulkState.completedKeywords}/${bulkState.totalKeywords} keywords`,
        statusColor: '#5ABD4E'
    });
    
    // Close the tab (onRemoved will be triggered but tab is already marked 'done')
    chrome.tabs.remove(tabId).catch(e => {
        console.log('[Background] Tab already closed:', e);
    });
    
    checkBulkComplete();
}

// Check for stuck tabs and force-complete them
function checkForStuckTabs() {
    if (!bulkState.isRunning) return;
    
    const now = Date.now();
    const TIMEOUT_MS = 120000; // 2 minutes timeout per tab
    
    const stuckTabs = bulkState.activeTabs.filter(t => 
        t.status !== 'done' && (now - t.startTime) > TIMEOUT_MS
    );
    
    if (stuckTabs.length > 0) {
        console.warn('[Background] Found', stuckTabs.length, 'stuck tabs. Force-completing them.');
        
        for (const tabInfo of stuckTabs) {
            console.log('[Background] Force-completing stuck tab for keyword:', tabInfo.keyword);
            tabInfo.status = 'done';
            bulkState.completedKeywords++;
            
            // Close the stuck tab
            chrome.tabs.remove(tabInfo.tabId).catch(e => {
                console.log('[Background] Could not close stuck tab:', e);
            });
        }
        
        updateBulkState({
            completedKeywords: bulkState.completedKeywords,
            statusMessage: `Recovered from stuck tabs - ${bulkState.completedKeywords}/${bulkState.totalKeywords} complete`,
            statusColor: '#ffad1f'
        });
        
        checkBulkComplete();
    }
}

// Check if bulk scraping is complete
function checkBulkComplete() {
    // Remove done tabs from active list
    bulkState.activeTabs = bulkState.activeTabs.filter(t => t.status !== 'done');

    // Update state
    updateBulkState({
        activeTabs: bulkState.activeTabs
    });

    // If more keywords to process, open more tabs
    if (bulkState.currentKeywordIndex < bulkState.keywords.length) {
        openNextKeywordTabs();
        return;
    }

    // Fallback: If all tabs are done but not all keywords are marked complete, force-complete
    if (bulkState.activeTabs.length === 0 && bulkState.completedKeywords < bulkState.totalKeywords) {
        console.warn('[Background] Fallback: All tabs closed but not all keywords completed. Forcing completion.');
        bulkState.completedKeywords = bulkState.totalKeywords;
    }

    // Check if all tabs are done and all keywords are marked complete
    if (bulkState.activeTabs.length === 0 && bulkState.completedKeywords >= bulkState.totalKeywords) {
        console.log('[Background] Bulk scraping complete!');

        // Combine all results
        const allTweets = bulkState.allResults.flatMap(r => r.tweets);

        updateBulkState({
            isRunning: false,
            statusMessage: `Complete! ${allTweets.length} total tweets from ${bulkState.totalKeywords} keywords`,
            statusColor: '#5ABD4E'
        });

        // Save results and open analytics
        chrome.storage.local.set({ 
            postData: JSON.stringify(allTweets),
            bulkResults: JSON.stringify(bulkState.allResults)
        }, function() {
            console.log('[Background] Bulk results saved');
            chrome.tabs.create({ url: 'src/pages/analytic/direct.html' });
        });

        // Reset after delay
        setTimeout(() => resetBulkState(), 5000);
    }
}

// Handle tab removal (user closed tab or error - NOT our intentional closes)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!bulkState.isRunning) return;
    
    const tabIndex = bulkState.activeTabs.findIndex(t => t.tabId === tabId);
    if (tabIndex === -1) return; // Not our tab
    
    const tabInfo = bulkState.activeTabs[tabIndex];
    
    // Only handle if tab wasn't already marked as done (i.e., user closed it)
    if (tabInfo.status !== 'done') {
        console.log('[Background] Tab unexpectedly removed for keyword:', tabInfo.keyword, '- status was:', tabInfo.status);
        tabInfo.status = 'done';
        bulkState.completedKeywords++;
        
        updateBulkState({
            completedKeywords: bulkState.completedKeywords,
            statusMessage: `Tab closed for "${tabInfo.keyword}" - continuing...`,
            statusColor: '#ffad1f'
        });
        
        checkBulkComplete();
    }
});

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
    // Handle bulk scraping tab loads
    if (bulkState.isRunning && changeInfo.status === 'complete') {
        const bulkTab = bulkState.activeTabs.find(t => t.tabId === tabId && t.status === 'loading');
        if (bulkTab) {
            handleBulkTabLoaded(tabId);
            return;
        }
    }
    
    // Only care about our scraping tab and when it's done loading
    if (tabId === currentScrapingTabId && changeInfo.status === 'complete' && replyQueue.length > 0) {
        console.log('[Background] Page loaded, injecting scraper...');
        
        // Small delay to ensure page is ready
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (settings) => {
                    window.scraperSettings = settings;
                    window.scraperWaitTime = settings.waitTime;
                    window.scraperScrapeReplies = false; // Don't recurse
                    window.allArticle = []; // Reset for new page
                    window.articleChecker = [];
                },
                args: [scraperSettings]
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
        scraperSettings = message.settings || { waitTime: scrapeWaitTime, scrapeReplies: false };
        scraperSettings.scrapeReplies = false; // Don't recurse
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
            if (match && scrapingState.phase !== 'replies') {
                // Only update tweetsScraped during main phase, not during reply phase
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
    
    // ============================================
    // BULK KEYWORD SCRAPING HANDLERS
    // ============================================
    
    // Start bulk keyword scraping
    if (message.action === 'startBulkScrape') {
        console.log('[Background] Starting bulk scrape with', message.keywords.length, 'keywords');
        console.log('[Background] Keywords:', JSON.stringify(message.keywords));
        
        resetBulkState();
        
        bulkState.isRunning = true;
        bulkState.keywords = message.keywords;
        bulkState.totalKeywords = message.keywords.length;
        bulkState.settings = message.settings || { waitTime: 2, scrapeReplies: true };
        bulkState.maxConcurrentTabs = message.maxConcurrentTabs || 3;
        bulkState.statusMessage = `Starting bulk scrape of ${message.keywords.length} keywords...`;
        bulkState.statusColor = '#1da1f2';
        
        // Start timeout checking interval (check every 30 seconds)
        if (bulkState.timeoutCheckInterval) {
            clearInterval(bulkState.timeoutCheckInterval);
        }
        bulkState.timeoutCheckInterval = setInterval(checkForStuckTabs, 30000);
        
        // Save full state including keywords
        chrome.storage.local.set({ bulkState: bulkState });
        
        // Start opening tabs
        openNextKeywordTabs();
        
        sendResponse({ success: true, message: 'Bulk scraping started' });
        return true;
    }
    
    // Handle bulk scrape result from a tab
    if (message.action === 'bulkScrapeResult') {
        if (sender.tab) {
            const tweets = JSON.parse(message.source);
            handleBulkResult(sender.tab.id, tweets);
        }
        sendResponse({ success: true });
        return true;
    }
    
    // Handle popup requesting bulk state
    if (message.action === 'getBulkState') {
        sendResponse(bulkState);
        return true;
    }
    
    // Cancel bulk scraping
    if (message.action === 'cancelBulkScrape') {
        console.log('[Background] Cancelling bulk scrape');
        
        // Clear timeout check interval
        if (bulkState.timeoutCheckInterval) {
            clearInterval(bulkState.timeoutCheckInterval);
        }
        
        // Close all active tabs
        for (const tab of bulkState.activeTabs) {
            try {
                chrome.tabs.remove(tab.tabId);
            } catch (e) {}
        }
        
        resetBulkState();
        sendResponse({ success: true, message: 'Bulk scraping cancelled' });
        return true;
    }
});
