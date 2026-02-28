require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const articlesRouter = require('./routes/articles');
const categoriesRouter = require('./routes/categories');
const feedsRouter = require('./routes/feeds');
const { fetchAllFeeds } = require('./services/rssFetcher');
const { classifyUnclassifiedArticles } = require('./services/classifier');
const { updateRelevanceScores } = require('./services/relevance');
const { scrapeRecentJudgments } = require('./services/cjeuScraper');
const { summarizeUnsummarizedJudgments } = require('./services/judgmentSummarizer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/articles', articlesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/feeds', feedsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Scheduled jobs: fetch feeds every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('[Cron] Starting scheduled feed fetch...');
  try {
    await fetchAllFeeds();
    await classifyUnclassifiedArticles(20);
    await updateRelevanceScores();
  } catch (err) {
    console.error('[Cron] Scheduled fetch failed:', err.message);
  }
});

// Scrape CJEU judgments every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Starting CJEU judgment scrape...');
  try {
    await scrapeRecentJudgments(7); // last 7 days
    await summarizeUnsummarizedJudgments(10);
    await updateRelevanceScores();
  } catch (err) {
    console.error('[Cron] Judgment scrape failed:', err.message);
  }
});

// Update relevance scores every hour
cron.schedule('0 * * * *', async () => {
  console.log('[Cron] Updating relevance scores...');
  try {
    await updateRelevanceScores();
  } catch (err) {
    console.error('[Cron] Relevance update failed:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Legal News API running on port ${PORT}`);
});
