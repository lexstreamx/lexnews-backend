const pool = require('../db/pool');

// Velocity profiles: half-life in hours per feed type
// After one half-life, relevance drops to 0.5; after two, to 0.25, etc.
const HALF_LIFE_HOURS = {
  news: 10,        // ~10 hours prominence
  blogpost: 48,    // ~2 days
  judgment: 120,   // ~5 days
  regulatory: 168, // ~7 days
};

function computeRelevanceScore(feedType, publishedAt) {
  const halfLife = HALF_LIFE_HOURS[feedType] || 24;
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  // Exponential decay: score = 2^(-age/halfLife)
  return Math.pow(2, -ageHours / halfLife);
}

async function updateRelevanceScores() {
  const { rows: articles } = await pool.query(
    'SELECT id, feed_type, published_at FROM articles'
  );

  let updated = 0;
  for (const article of articles) {
    const score = computeRelevanceScore(article.feed_type, article.published_at);
    await pool.query(
      'UPDATE articles SET relevance_score = $1, updated_at = NOW() WHERE id = $2',
      [Math.round(score * 10000) / 10000, article.id]
    );
    updated++;
  }

  console.log(`Updated relevance scores for ${updated} articles.`);
  return updated;
}

module.exports = { computeRelevanceScore, updateRelevanceScores };
