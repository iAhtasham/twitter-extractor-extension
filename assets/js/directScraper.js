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
      
      // Get username/handle
      var userLinkDom = element.querySelector("a[href^='/'][role='link'] time")?.closest("a");
      var username = "";
      if (userLinkDom) {
        var href = userLinkDom.getAttribute("href");
        // Extract username from href like /username/status/123456
        var parts = href.split("/");
        if (parts.length > 1) {
          username = parts[1];
        }
      }
      
      // Try to get display name
      var displayNameDom = element.querySelector("[data-testid='User-Name']");
      var displayName = displayNameDom ? displayNameDom.innerText.split("\n")[0] : "";
      
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
      };
      articleData.push(data);
      
      // Use time + content combo to avoid duplicates
      var uniqueKey = data.time + data.content.substring(0, 50);
      var index = window.allArticle.findIndex(
        (item) => (item.time + item.content.substring(0, 50)) === uniqueKey
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
})();
