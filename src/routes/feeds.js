const express = require('express');
const { fetchAllFeeds } = require('../services/rssFetcher');
const { classifyUnclassifiedArticles } = require('../services/classifier');
const { updateRelevanceScores } = require('../services/relevance');
const { scrapeRecentJudgments } = require('../services/cjeuScraper');
const { summarizeUnsummarizedJudgments } = require('../services/judgmentSummarizer');

const router = express.Router();

// POST /api/feeds/refresh — manually trigger a feed refresh (RSS + classify)
router.post('/refresh', async (req, res) => {
  try {
    const fetchResults = await fetchAllFeeds();
    const classified = await classifyUnclassifiedArticles(20);
    const updated = await updateRelevanceScores();

    res.json({
      message: 'Feed refresh complete',
      feeds: fetchResults,
      classified,
      relevanceUpdated: updated,
    });
  } catch (err) {
    console.error('Error refreshing feeds:', err);
    res.status(500).json({ error: 'Failed to refresh feeds' });
  }
});

// POST /api/feeds/scrape-judgments — manually trigger CJEU judgment scrape
router.post('/scrape-judgments', async (req, res) => {
  try {
    const { days_back = 30 } = req.query;
    const scrapeResult = await scrapeRecentJudgments(parseInt(days_back));
    const summarized = await summarizeUnsummarizedJudgments(10);
    const updated = await updateRelevanceScores();

    res.json({
      message: 'Judgment scrape complete',
      scrape: scrapeResult,
      summarized,
      relevanceUpdated: updated,
    });
  } catch (err) {
    console.error('Error scraping judgments:', err);
    res.status(500).json({ error: 'Failed to scrape judgments' });
  }
});

module.exports = router;
