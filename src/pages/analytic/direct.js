let allTweets = [];

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        return d.toLocaleString();
    } catch {
        return dateStr;
    }
}

function formatNumber(num) {
    if (!num || num === '') return '0';
    const n = parseFloat(num.toString().replace(/[KMk]/gi, (m) => {
        return { 'K': '000', 'k': '000', 'M': '000000' }[m] || '';
    }));
    return isNaN(n) ? num : n.toLocaleString();
}

function renderTweets(tweets) {
    const content = document.getElementById('content');
    const stats = document.getElementById('stats');
    
    if (!tweets || tweets.length === 0) {
        content.innerHTML = '<div class="empty">No tweets found. Go scrape some!</div>';
        stats.innerHTML = '';
        return;
    }
    
    // Calculate stats
    const uniqueUsers = [...new Set(tweets.map(t => t.username).filter(Boolean))].length;
    const totalLikes = tweets.reduce((sum, t) => sum + (parseInt(formatNumber(t.like)) || 0), 0);
    const totalRetweets = tweets.reduce((sum, t) => sum + (parseInt(formatNumber(t.retweet)) || 0), 0);
    const repliesCount = tweets.filter(t => t.isReply).length;
    
    stats.innerHTML = `
        <span>Total: <span class="stat-value">${tweets.length}</span> tweets</span>
        <span>Replies: <span class="stat-value">${repliesCount}</span></span>
        <span>Users: <span class="stat-value">${uniqueUsers}</span></span>
        <span>Likes: <span class="stat-value">${totalLikes.toLocaleString()}</span></span>
        <span>Retweets: <span class="stat-value">${totalRetweets.toLocaleString()}</span></span>
    `;
    
    content.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>User</th>
                    <th>Content</th>
                    <th>Type</th>
                    <th>Reply To</th>
                    <th>Likes</th>
                    <th>Retweets</th>
                    <th>Replies</th>
                    <th>Date</th>
                    <th>Link</th>
                </tr>
            </thead>
            <tbody>
                ${tweets.map((t, i) => `
                    <tr class="${t.isReply ? 'reply-row' : ''}">
                        <td>${i + 1}</td>
                        <td><span class="username">@${t.username || 'unknown'}</span></td>
                        <td><div class="tweet-content" title="${(t.content || '').replace(/"/g, '&quot;')}">${t.content || '(no text)'}</div></td>
                        <td><span class="type-badge type-${t.postType || 'text'}">${t.postType || 'text'}</span></td>
                        <td>${t.parentTweetUrl ? `<a href="${t.parentTweetUrl}" target="_blank" class="parent-link">@${t.parentUsername || '?'}</a>` : (t.isReply ? '<span class="reply-badge">Reply</span>' : '')}</td>
                        <td class="number">${formatNumber(t.like)}</td>
                        <td class="number">${formatNumber(t.retweet)}</td>
                        <td class="number">${formatNumber(t.reply)}</td>
                        <td class="time">${formatDate(t.time)}</td>
                        <td>${t.tweetUrl ? `<a href="${t.tweetUrl}" target="_blank" class="tweet-link">🔗</a>` : ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function downloadCSV() {
    if (!allTweets.length) return;
    
    const headers = ['tweetId', 'tweetUrl', 'username', 'content', 'postType', 'like', 'retweet', 'reply', 'time', 'isReply', 'parentTweetId', 'parentTweetUrl', 'parentUsername', 'replyingTo', 'image', 'video'];
    const rows = allTweets.map(t => headers.map(h => {
        let val = t[h];
        if (Array.isArray(val)) val = val.join('; ');
        if (typeof val === 'string') val = val.replace(/"/g, '""');
        return `"${val || ''}"`;
    }));
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tweets_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function clearData() {
    if (confirm('Are you sure you want to clear all scraped data?')) {
        chrome.storage.local.remove(['postData'], function() {
            localStorage.removeItem('postData');
            allTweets = [];
            renderTweets([]);
        });
    }
}

function filterTweets(query) {
    if (!query) {
        renderTweets(allTweets);
        return;
    }
    const q = query.toLowerCase();
    const filtered = allTweets.filter(t => 
        (t.content && t.content.toLowerCase().includes(q)) ||
        (t.username && t.username.toLowerCase().includes(q))
    );
    renderTweets(filtered);
}

// Load data
function loadData() {
    console.log('[Analytics] Loading data from chrome.storage.local...');
    chrome.storage.local.get(['postData'], function(result) {
        console.log('[Analytics] Got result:', result.postData ? 'has data' : 'no data');
        if (result.postData) {
            try {
                allTweets = JSON.parse(result.postData);
                console.log('[Analytics] Loaded', allTweets.length, 'tweets');
                renderTweets(allTweets);
            } catch (e) {
                console.error('Error parsing data:', e);
                document.getElementById('content').innerHTML = '<div class="empty">Error loading data</div>';
            }
        } else {
            // Try localStorage as fallback
            try {
                const localData = localStorage.getItem('postData');
                if (localData) {
                    allTweets = JSON.parse(localData);
                    renderTweets(allTweets);
                } else {
                    document.getElementById('content').innerHTML = '<div class="empty">No data found. Go scrape some tweets!</div>';
                }
            } catch (e) {
                document.getElementById('content').innerHTML = '<div class="empty">No data found</div>';
            }
        }
    });
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('download-btn').addEventListener('click', downloadCSV);
    document.getElementById('clear-btn').addEventListener('click', clearData);
    document.getElementById('search').addEventListener('input', (e) => filterTweets(e.target.value));
    
    // Load on page load
    loadData();
});
