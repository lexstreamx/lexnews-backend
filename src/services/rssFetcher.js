const RSSParser = require('rss-parser');
const pool = require('../db/pool');

const parser = new RSSParser();

const FEEDS = [
  { url: 'https://rss.app/feeds/_wFzzGEbWrnRHQnox.xml', type: 'news' },
  { url: 'https://rss.app/feeds/_1zigjyGFzmQ40NLk.xml', type: 'blogpost' },
];

async function fetchFeed(feedConfig) {
  const { url, type } = feedConfig;
  console.log(`Fetching ${type} feed: ${url}`);

  let feed;
  try {
    feed = await parser.parseURL(url);
  } catch (err) {
    console.error(`Failed to fetch feed ${url}:`, err.message);
    return { fetched: 0, new: 0 };
  }

  let newCount = 0;

  for (const item of feed.items) {
    const link = item.link;
    if (!link) continue;

    try {
      const result = await pool.query(
        `INSERT INTO articles (title, link, description, content, source_name, source_url, published_at, feed_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [
          item.title || 'Untitled',
          link,
          item.contentSnippet || item.content || '',
          item.content || item.contentSnippet || '',
          item.creator || feed.title || '',
          feed.link || url,
          item.isoDate || item.pubDate || new Date().toISOString(),
          type,
        ]
      );

      if (result.rows.length > 0) {
        newCount++;
      }
    } catch (err) {
      console.error(`Failed to insert article "${item.title}":`, err.message);
    }
  }

  console.log(`${type}: fetched ${feed.items.length} items, ${newCount} new`);
  return { fetched: feed.items.length, new: newCount };
}

async function fetchAllFeeds() {
  console.log(`[${new Date().toISOString()}] Starting feed fetch cycle...`);
  const results = [];

  for (const feedConfig of FEEDS) {
    const result = await fetchFeed(feedConfig);
    results.push({ ...feedConfig, ...result });
  }

  console.log(`Feed fetch cycle complete.`);
  return results;
}

module.exports = { fetchAllFeeds, fetchFeed, FEEDS };
