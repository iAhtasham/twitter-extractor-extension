// Direct scraper - works on any search page without filters
window.articleChecker = [];
window.allArticle = [];

if (!window.waitTill) {
  window.waitTill = (ms) => new Promise((r) => setTimeout(r, ms));
}

if (!window.retrievePostData) {
  window.retrievePostData = async function () {
    var trial = 1;
    var article = document.querySelectorAll("article");
    while (trial < 5 && article.length === 0) {
      trial++;
      article = document.querySelectorAll("article");
      await window.waitTill(1000);
    }
    var articleData = [];
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
      }
    }
    
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
  window.scrollToBottom = async (document, waitTime) => {
    var numberOfRepeat = 0;
    var preScrollHeight = 0;
    while (numberOfRepeat < 2) {
      if (preScrollHeight !== document.body.scrollHeight) {
        preScrollHeight = document.body.scrollHeight;
        await window.retrievePostData();
        window.scrollTo(0, preScrollHeight);
      } else {
        numberOfRepeat++;
      }
      await window.waitTill(waitTime * 1000);
    }
    return true;
  };
}

(async () => {
  // Get wait time from window variable (set by popup) or URL param, default 2 seconds
  var waitTime = window.scraperWaitTime || 2;
  
  // Check if we should also scrape replies
  var scrapeReplies = window.scraperScrapeReplies !== false; // default true
  
  // Also check URL param as fallback
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);
  var urlWait = urlParams.get("wait");
  if (urlWait) {
    waitTime = parseInt(urlWait) || 2;
  }
  
  console.log('[DirectScraper] Starting with wait time:', waitTime, 'seconds');
  
  chrome.runtime.sendMessage({
    action: "getStatus",
    source: JSON.stringify({
      content: `Starting direct scrape (${waitTime}s delay)...`,
      color: "#57C2CE",
    }),
  });
  
  await window.scrollToBottom(document, waitTime);
  
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
  
  if (tweetsWithReplies.length > 0) {
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
      waitTime: waitTime
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
    
    chrome.runtime.sendMessage({
      action: "getPost",
      source: JSON.stringify(window.allArticle),
    });
  }
})();
