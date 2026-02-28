require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const articlesRouter = require('./routes/articles');
const categoriesRouter = require('./routes/categories');
const feedsRouter = require('./routes/feeds');
const authRouter = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const { fetchAllFeeds } = require('./services/rssFetcher');
const { classifyUnclassifiedArticles } = require('./services/classifier');
const { updateRelevanceScores } = require('./services/relevance');
const { scrapeRecentJudgments } = require('./services/cjeuScraper');
const { summarizeUnsummarizedJudgments } = require('./services/judgmentSummarizer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')
      .map(s => s.trim());
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes — auth and categories are public, articles and feeds require auth
app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/articles', requireAuth, articlesRouter);
app.use('/api/feeds', requireAuth, feedsRouter);

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
