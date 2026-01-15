// Direct scraper - works on any search page without filters
// Don't reset if already initialized (prevents losing data on re-injection)
if (!window.articleChecker) {
  window.articleChecker = [];
}
if (!window.allArticle) {
  window.allArticle = [];
}

console.log('[DirectScraper] Script loaded. Current allArticle length:', window.allArticle.length);

if (!window.checkForTwitterError) {
  window.checkForTwitterError = function() {
    // Check for "Something went wrong" error
    var errorTexts = document.querySelectorAll('[dir="ltr"]');
    for (var elem of errorTexts) {
      if (elem.innerText && (elem.innerText.includes('Something went wrong') || elem.innerText.includes('Try reloading'))) {
        console.warn('[DirectScraper] Detected Twitter error state!');
        return true;
      }
    }
    return false;
  };
}

if (!window.attemptErrorRecovery) {
  window.attemptErrorRecovery = async function() {
    console.log('[DirectScraper] Attempting error recovery...');
    
    // Try clicking the retry button
    var retryButtons = document.querySelectorAll('button[role="button"]');
    for (var btn of retryButtons) {
      if (btn.innerText && btn.innerText.includes('Retry')) {
        console.log('[DirectScraper] Clicking retry button');
        btn.click();
        await window.waitTill(3000); // Wait for page to recover
        return true;
      }
    }
    
    // Fallback: try clicking on the search input to trigger reload
    var searchInput = document.querySelector('input[aria-label="Search query"]');
    if (searchInput) {
      console.log('[DirectScraper] Clicking search input for recovery');
      searchInput.click();
      await window.waitTill(2000);
      searchInput.blur();
      await window.waitTill(2000);
      return true;
    }
    
    return false;
  };
}

if (!window.waitTill) {
  window.waitTill = (ms) => new Promise((r) => setTimeout(r, ms));
}

if (!window.retrievePostData) {
  window.retrievePostData = async function () {
    var trial = 1;
    var article = document.querySelectorAll("article");
    console.log('[DirectScraper] retrievePostData called. Found', article.length, 'article elements');
    
    while (trial < 5 && article.length === 0) {
      trial++;
      article = document.querySelectorAll("article");
      await window.waitTill(1000);
    }
    
    if (article.length === 0) {
      console.warn('[DirectScraper] No articles found after', trial, 'attempts');
      return;
    }
    
    var articleData = [];
    var newTweetsAdded = 0;
    var skippedArticles = 0;
    
    for (const element of article) {
      var timeDom = element.querySelector("time");
      var textsDom = element.querySelectorAll("[data-testid=tweetText] > *");
      var likeDom = element.querySelector("[data-testid=like]");
      var retweetDom = element.querySelector("[data-testid=retweet]");
      var replyDom = element.querySelector("[data-testid=reply]");
      var spreadDom = element.querySelector("div:has(>[data-testid=like])+div");
      var imagesDom = element.querySelectorAll("[data-testid=tweetPhoto] img");
      var videosDom = element.querySelectorAll("[data-testid=tweetPhoto] video");
      
      // Get tweet ID and URL from status link
      var statusLink = element.querySelector("a[href*='/status/']");
      var tweetId = "";
      var tweetUrl = "";
      var username = "";
      if (statusLink) {
        var href = statusLink.getAttribute("href");
        // Extract from href like /username/status/123456
        var match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          username = match[1];
          tweetId = match[2];
          tweetUrl = "https://x.com" + href;
        }
      }
      
      // Skip articles without essential data
      if (!tweetId || !username) {
        skippedArticles++;
        continue;
      }
      
      // Try to get display name
      var displayNameDom = element.querySelector("[data-testid='User-Name']");
      var displayName = displayNameDom ? displayNameDom.innerText.split("\n")[0] : "";
      
      // Check if this is a reply
      var isReply = false;
      var replyingTo = "";
      
      // Method 1: Look for "Replying to" text in the tweet (works on search pages)
      var replyingToElement = element.querySelector("div[id^='id__'] a[href^='/'][role='link']");
      var allDivs = element.querySelectorAll("div");
      for (var div of allDivs) {
        if (div.innerText && div.innerText.startsWith("Replying to ")) {
          isReply = true;
          replyingTo = div.innerText.replace("Replying to ", "");
          break;
        }
      }
      
      // Method 2: Look for social context that indicates reply
      var socialContext = element.querySelector("[data-testid='socialContext']");
      if (socialContext && socialContext.innerText.includes("replied")) {
        isReply = true;
      }
      
      // Method 3: On status pages, tweets after first one are replies
      if (window.location.pathname.includes("/status/")) {
        var allArticles = document.querySelectorAll("article");
        if (allArticles.length > 0 && element !== allArticles[0]) {
          isReply = true;
        }
      }
      
      var postType = "text";
      var image = [];
      var video = [];
      var content = "";
      
      if (textsDom) {
        for (var textDom of textsDom) {
          if (textDom.tagName.toLowerCase() === "span") {
            content = `${content}${textDom.innerText}`;
          }
          if (textDom.tagName.toLowerCase() === "img") {
            content = `${content}${textDom.getAttribute("alt")}`;
          }
        }
      }
      if (imagesDom) {
        if (imagesDom.length > 0) {
          postType = "image";
        }
        for (var imageDom of imagesDom) {
          image.push(imageDom.getAttribute("src"));
        }
      }
      if (videosDom) {
        if (videosDom.length > 0) {
          postType = "video";
        }
        for (var videoDom of videosDom) {
          video.push(videoDom.getAttribute("src"));
        }
      }
      
      var data = {
        tweetId: tweetId,
        tweetUrl: tweetUrl,
        username: username,
        displayName: displayName,
        time: timeDom ? timeDom.getAttribute("datetime") : "",
        content: content,
        like: likeDom ? likeDom.innerText : "",
        retweet: retweetDom ? retweetDom.innerText : "",
        reply: replyDom ? replyDom.innerText : "",
        spread: spreadDom ? spreadDom.innerText : "",
        image: image,
        video: video,
        postType,
        isReply: isReply,
        replyingTo: replyingTo,
      };
      articleData.push(data);
      
      // Use tweetId as unique key if available, otherwise fall back to time+content
      var uniqueKey = tweetId || (data.time + data.content.substring(0, 50));
      var index = window.allArticle.findIndex(
        (item) => (item.tweetId || (item.time + item.content.substring(0, 50))) === uniqueKey
      );
      if (index <= -1) {
        window.allArticle.push(data);
        newTweetsAdded++;
      }
    }
    
    console.log('[DirectScraper] Processed', article.length, 'articles.', newTweetsAdded, 'new tweets added,', skippedArticles, 'skipped. Total:', window.allArticle.length);
    
    var lastTime = articleData.length > 0 ? articleData[articleData.length - 1].time : "N/A";
    chrome.runtime.sendMessage({
      action: "getStatus",
      source: JSON.stringify({
        content: `${window.allArticle.length} tweets scraped (last: ${lastTime})`,
        color: "#5ABD4E",
      }),
    });
    window.articleChecker = articleData;
  };
}

if (!window.scrollToBottom) {
  window.scrollToBottom = async (document, waitTime, maxTweets) => {
    var numberOfRepeat = 0;
    var preScrollHeight = 0;
    var preTweetCount = 0;
    var maxRepeatsWithoutChange = 5; // Increased from 2 to 5 for more thorough scrolling
    var errorRecoveryAttempts = 0;
    var maxErrorRecoveryAttempts = 3;
    
    console.log('[DirectScraper] Starting scroll with waitTime:', waitTime, 'maxTweets:', maxTweets);
    
    while (numberOfRepeat < maxRepeatsWithoutChange) {
      // Check for Twitter error state
      if (window.checkForTwitterError()) {
        console.warn('[DirectScraper] Twitter error detected during scrolling');
        if (errorRecoveryAttempts < maxErrorRecoveryAttempts) {
          errorRecoveryAttempts++;
          var recovered = await window.attemptErrorRecovery();
          if (recovered) {
            console.log('[DirectScraper] Recovery successful, continuing scroll');
            numberOfRepeat = 0; // Reset counter after recovery
            await window.waitTill(waitTime * 1000);
            continue;
          } else {
            console.error('[DirectScraper] Recovery failed, stopping scroll');
            break;
          }
        } else {
          console.error('[DirectScraper] Max recovery attempts reached, stopping scroll');
          break;
        }
      }
      
      // Check if we've hit the max tweets limit
      if (maxTweets > 0 && window.allArticle.length >= maxTweets) {
        console.log('[DirectScraper] Reached max tweets limit:', maxTweets);
        break;
      }
      
      var currentTweetCount = window.allArticle.length;
      
      // Scroll and retrieve data
      await window.retrievePostData();
      window.scrollTo(0, document.body.scrollHeight);
      
      // Check if we found new tweets OR if scroll height changed
      var scrollChanged = preScrollHeight !== document.body.scrollHeight;
      var tweetsChanged = preTweetCount !== currentTweetCount;
      
      if (scrollChanged || tweetsChanged) {
        console.log('[DirectScraper] Progress: tweets=' + window.allArticle.length + 
                    ', scrollHeight=' + document.body.scrollHeight);
        numberOfRepeat = 0; // Reset counter when we find new content
        preScrollHeight = document.body.scrollHeight;
        preTweetCount = currentTweetCount;
      } else {
        numberOfRepeat++;
        console.log('[DirectScraper] No new content. Attempt ' + numberOfRepeat + '/' + maxRepeatsWithoutChange);
      }
      
      await window.waitTill(waitTime * 1000);
    }
    
    console.log('[DirectScraper] Scrolling complete. Total tweets:', window.allArticle.length);
    return true;
  };
}

(async () => {
  // Prevent double execution
  if (window.scraperExecuting) {
    console.log('[DirectScraper] Already executing, skipping');
    return;
  }
  window.scraperExecuting = true;
  
  // Get settings from window variable (set by popup)
  var settings = window.scraperSettings || {};
  var waitTime = settings.waitTime || window.scraperWaitTime || 2;
  var maxTweets = settings.maxTweets || 0;
  var scrapeReplies = settings.scrapeReplies !== undefined ? settings.scrapeReplies : (window.scraperScrapeReplies !== false);
  var includeMedia = settings.includeMedia !== undefined ? settings.includeMedia : true;
  var includeMetrics = settings.includeMetrics !== undefined ? settings.includeMetrics : true;
  
  // Also check URL param as fallback
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);
  var urlWait = urlParams.get("wait");
  if (urlWait) {
    waitTime = parseInt(urlWait) || 2;
  }
  
  console.log('[DirectScraper] Starting with settings:', { waitTime, maxTweets, scrapeReplies, includeMedia, includeMetrics, isBulkScrape: window.isBulkScrape });
  console.log('[DirectScraper] Current URL:', window.location.href);
  
  chrome.runtime.sendMessage({
    action: "getStatus",
    source: JSON.stringify({
      content: `Starting direct scrape (${waitTime}s delay${maxTweets > 0 ? ', max ' + maxTweets : ''})...`,
      color: "#57C2CE",
    }),
  });
  
  await window.scrollToBottom(document, waitTime, maxTweets);
  
  // Apply max tweets limit if set
  if (maxTweets > 0 && window.allArticle.length > maxTweets) {
    window.allArticle = window.allArticle.slice(0, maxTweets);
  }
  
  // Apply media/metrics filters if needed
  if (!includeMedia || !includeMetrics) {
    window.allArticle = window.allArticle.map(tweet => {
      var filtered = { ...tweet };
      if (!includeMedia) {
        filtered.image = [];
        filtered.video = [];
      }
      if (!includeMetrics) {
        filtered.like = '';
        filtered.retweet = '';
        filtered.reply = '';
        filtered.spread = '';
      }
      return filtered;
    });
  }
  
  // Collect URLs of tweets that have replies
  var tweetsWithReplies = [];
  if (scrapeReplies && !window.location.pathname.includes("/status/")) {
    for (var tweet of window.allArticle) {
      // Parse reply count - handle "1", "1.5K", etc.
      var replyCount = tweet.reply || "0";
      var numReplies = 0;
      if (replyCount.includes("K")) {
        numReplies = parseFloat(replyCount) * 1000;
      } else if (replyCount.includes("M")) {
        numReplies = parseFloat(replyCount) * 1000000;
      } else {
        numReplies = parseInt(replyCount) || 0;
      }
      
      if (numReplies > 0 && tweet.tweetUrl) {
        tweetsWithReplies.push({
          tweetId: tweet.tweetId,
          tweetUrl: tweet.tweetUrl,
          replyCount: numReplies
        });
      }
    }
    console.log('[DirectScraper] Found', tweetsWithReplies.length, 'tweets with replies');
  }
  
  if (tweetsWithReplies.length > 0 && !window.isBulkScrape) {
    // Only do reply scraping for non-bulk mode (bulk mode doesn't support replies yet)
    chrome.runtime.sendMessage({
      action: "getStatus",
      source: JSON.stringify({
        content: `Phase 1 done: ${window.allArticle.length} tweets. Now fetching replies from ${tweetsWithReplies.length} posts...`,
        color: "#57C2CE",
      }),
    });
    
    // Send data to background with list of URLs to scrape for replies
    console.log('[DirectScraper] Sending scrapeReplies message with', tweetsWithReplies.length, 'URLs');
    chrome.runtime.sendMessage({
      action: "scrapeReplies",
      mainTweets: JSON.stringify(window.allArticle),
      replyUrls: tweetsWithReplies,
      waitTime: waitTime,
      settings: settings
    }, (response) => {
      console.log('[DirectScraper] scrapeReplies response:', response);
    });
  } else {
    chrome.runtime.sendMessage({
      action: "getStatus",
      source: JSON.stringify({
        content: `Scraping complete! Total: ${window.allArticle.length} tweets`,
        color: "#5ABD4E",
      }),
    });
    
    console.log('[DirectScraper] Complete! Total tweets:', window.allArticle.length);
    console.log('[DirectScraper] Sample of first 3 tweets:', window.allArticle.slice(0, 3).map(t => ({ username: t.username, tweetId: t.tweetId, content: t.content.substring(0, 50) })));
    
    // Check if this is a bulk scrape
    if (window.isBulkScrape) {
      console.log('[DirectScraper] Sending bulk result for keyword:', window.bulkKeyword, '- Tweets:', window.allArticle.length);
      try {
        chrome.runtime.sendMessage({
          action: "bulkScrapeResult",
          source: JSON.stringify(window.allArticle),
          keyword: window.bulkKeyword
        }, (response) => {
          console.log('[DirectScraper] Bulk result sent. Response:', response);
          if (chrome.runtime.lastError) {
            console.error('[DirectScraper] Error sending bulk result:', chrome.runtime.lastError);
          }
        });
      } catch (err) {
        console.error('[DirectScraper] Exception sending bulk result:', err);
      }
    } else {
      console.log('[DirectScraper] Sending normal result - Tweets:', window.allArticle.length);
      try {
        chrome.runtime.sendMessage({
          action: "getPost",
          source: JSON.stringify(window.allArticle),
        }, (response) => {
          console.log('[DirectScraper] Normal result sent. Response:', response);
          if (chrome.runtime.lastError) {
            console.error('[DirectScraper] Error sending result:', chrome.runtime.lastError);
          }
        });
      } catch (err) {
        console.error('[DirectScraper] Exception sending result:', err);
      }
    }
  }
  
  window.scraperExecuting = false;
  console.log('[DirectScraper] Execution complete');
})();
