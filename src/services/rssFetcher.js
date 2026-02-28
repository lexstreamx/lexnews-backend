const RSSParser = require('rss-parser');
const cheerio = require('cheerio');
const pool = require('../db/pool');

const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
      ['content:encoded', 'content:encoded'],
    ],
  },
});

const FEEDS = [
  { url: 'https://rss.app/feeds/_wFzzGEbWrnRHQnox.xml', type: 'news' },
  { url: 'https://rss.app/feeds/_1zigjyGFzmQ40NLk.xml', type: 'blogpost' },
  { url: 'https://rss.app/feeds/_UuzpzghFv55Ljedv.xml', type: 'regulatory' },
];

function extractImageUrl(item) {
  // Strategy 1: RSS enclosure (image type)
  if (item.enclosure && item.enclosure.url &&
      item.enclosure.type && item.enclosure.type.startsWith('image/')) {
    return item.enclosure.url;
  }

  // Strategy 2: media:content
  if (item['media:content']) {
    const media = item['media:content'];
    const url = media.$ ? media.$.url : media.url;
    if (url) return url;
  }

  // Strategy 3: media:thumbnail
  if (item['media:thumbnail']) {
    const thumb = item['media:thumbnail'];
    const url = thumb.$ ? thumb.$.url : thumb.url;
    if (url) return url;
  }

  // Strategy 4: Parse first <img> from content HTML
  const htmlContent = item['content:encoded'] || item.content || '';
  if (htmlContent && htmlContent.includes('<img')) {
    try {
      const $ = cheerio.load(htmlContent);
      const firstImg = $('img').first().attr('src');
      if (firstImg && firstImg.startsWith('http')) {
        return firstImg;
      }
    } catch {
      // Malformed HTML, skip
    }
  }

  // Strategy 5: Direct image field
  if (item.image && typeof item.image === 'string') {
    return item.image;
  }
  if (item.image && item.image.url) {
    return item.image.url;
  }

  return null;
}

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

    const imageUrl = extractImageUrl(item);

    try {
      const result = await pool.query(
        `INSERT INTO articles (title, link, description, content, image_url, source_name, source_url, published_at, feed_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (link) DO UPDATE SET image_url = COALESCE(articles.image_url, EXCLUDED.image_url)
         RETURNING id`,
        [
          item.title || 'Untitled',
          link,
          item.contentSnippet || item.content || '',
          item.content || item.contentSnippet || '',
          imageUrl,
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
