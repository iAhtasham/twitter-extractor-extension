# Twitter Search Extractor

A Chrome extension to extract tweets from X/Twitter search and profile pages, with support for bulk keyword scraping, date range filtering, and CSV export.

## Features

- **Single-keyword scraping** — Scrape tweets from any X/Twitter search query with adjustable load rate
- **Bulk keyword scraping** — Scrape up to 50 keywords concurrently (up to 3 tabs at a time)
- **Profile scraping** — Extract profile metadata and post history for any user
- **Date range filtering** — Filter tweets by from/to year and month
- **Analytics view** — Visualise scraped profile data and post lists
- **CSV export** — Download scraped tweet data as a CSV file
- **Adjustable load rate** — Control how long the extension waits for tweets to load (0–10 seconds)

## Screenshots

> _Add screenshots here_

## Installation

### From source

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository.
5. The extension icon should appear in your toolbar.

### From the Chrome Web Store

> _Link to be added if published_

## Usage

### Scraping a single user's tweets

1. Click the extension icon.
2. Enter a Twitter/X username (without `@`).
3. Set the desired date range and load rate.
4. Click **Scrape Now** — the extension will open the search page and collect tweets automatically.

### Bulk keyword scraping

1. Click the extension icon and navigate to the **Bulk** popup (`bulk.html`).
2. Enter up to 50 keywords, one per line.
3. Configure settings and click **Start Scraping**.
4. Progress is shown in real time; results are merged across all keywords.

### Exporting data

From the analytics page, click **Export CSV** to download the collected tweets. Each row contains:

| Column | Description |
|--------|-------------|
| Date | Tweet timestamp |
| Post Type | Type of post (tweet, retweet, etc.) |
| Content | Tweet text |
| Video Thumbnail | Video URL(s) |
| Image | Image URL(s) |
| Like | Like count |
| Retweet | Retweet count |
| Reply | Reply count |

## Project Structure

```
├── manifest.json               # Chrome Manifest V3 config
├── src/
│   └── pages/
│       ├── background/         # Service worker (scraping state & messaging)
│       ├── content/            # Content script injected into X/Twitter pages
│       ├── popup/              # Main popup UI (single & bulk scraper)
│       ├── analytic/           # Analytics / results viewer
│       ├── panel/              # DevTools panel
│       ├── options/            # Extension options page
│       └── newtab/             # New-tab override page
├── assets/
│   ├── js/                     # Bundled JavaScript chunks
│   └── css/                    # Bundled CSS chunks
└── examples/                   # Example HTML snapshots for development
```

## Permissions

| Permission | Reason |
|-----------|--------|
| `activeTab` | Access the currently open X/Twitter tab |
| `scripting` | Inject scraper scripts into the page |
| `tabs` | Open and navigate tabs during scraping |
| `storage` | Persist scraping state across sessions |
| `*://x.com/*`, `*://twitter.com/*` | Access X/Twitter pages |

## Tech Stack

- **Manifest V3** Chrome extension API
- **React** — popup and analytics UI
- **Tailwind CSS** — styling
- **Recharts** — data visualisation in the analytics view
- **react-csv** — CSV export

## Version

Current version: **0.0.18**

## Author

Built by **iahtasham**

## License

> _Add your license here_
