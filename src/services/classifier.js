const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');

const anthropic = new Anthropic();

const LEGAL_CATEGORIES = [
  'AI, Platforms and Data Protection Law',
  'Administrative Law',
  'Banking & Finance Law',
  'Capital Markets / Securities Law',
  'Competition / Antitrust Law',
  'Construction & Real Estate Law',
  'Consumer Protection Law',
  'Corporate / Company Law',
  'Criminal Law',
  'Employment & Labour Law',
  'Energy Law',
  'Environmental Law',
  'Family Law',
  'Life Sciences Law',
  'Immigration Law',
  'Infrastructure & Public Procurement Law',
  'Media & Telecommunications Law',
  'Insolvency & Restructuring Law',
  'Insurance Law',
  'Intellectual Property (Patents, Trademarks, Copyright)',
  'International Law, Trade & Customs Law',
  'Litigation & Dispute Resolution',
  'Mergers & Acquisitions (M&A)',
  'Private Equity & Venture Capital',
  'Constitutional Law',
  'Sports & Entertainment Law',
  'Tax Law',
  'Transport & Logistics Law',
];

const CLASSIFICATION_PROMPT = `You are a legal content classifier. Analyze the following article and return a JSON object with:

1. "legal_areas": an array of 1-3 most relevant legal categories from this exact list:
${LEGAL_CATEGORIES.map((c) => `- ${c}`).join('\n')}

2. "jurisdiction": the primary jurisdiction this article relates to (e.g., "EU", "US", "UK", "Portugal", "Brazil", "International", etc.). Use the country name or common abbreviation.

3. "language": the ISO 639-1 language code of the article (e.g., "en", "pt", "fr", "de", "es").

Return ONLY valid JSON, no other text. Example:
{"legal_areas": ["Tax Law", "Corporate / Company Law"], "jurisdiction": "EU", "language": "en"}`;

async function classifyArticle(article) {
  const inputText = `Title: ${article.title}\n\nContent: ${(article.description || article.content || '').substring(0, 1500)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `${CLASSIFICATION_PROMPT}\n\n---\n\n${inputText}`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);
    return result;
  } catch (err) {
    console.error(`Classification failed for article ${article.id}:`, err.message);
    return null;
  }
}

async function classifyUnclassifiedArticles(batchSize = 10) {
  const { rows: articles } = await pool.query(
    `SELECT id, title, description, content FROM articles
     WHERE ai_classified = FALSE
     ORDER BY published_at DESC
     LIMIT $1`,
    [batchSize]
  );

  if (articles.length === 0) {
    console.log('No unclassified articles found.');
    return 0;
  }

  console.log(`Classifying ${articles.length} articles...`);

  // Load category name-to-id mapping
  const { rows: categories } = await pool.query(
    'SELECT id, name FROM legal_categories'
  );
  const categoryMap = {};
  for (const cat of categories) {
    categoryMap[cat.name] = cat.id;
  }

  let classified = 0;

  for (const article of articles) {
    const result = await classifyArticle(article);
    if (!result) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update article with jurisdiction and language
      await client.query(
        `UPDATE articles SET jurisdiction = $1, language = $2, ai_classified = TRUE, updated_at = NOW()
         WHERE id = $3`,
        [result.jurisdiction || null, result.language || 'en', article.id]
      );

      // Insert category associations
      if (result.legal_areas && Array.isArray(result.legal_areas)) {
        for (const area of result.legal_areas) {
          const catId = categoryMap[area];
          if (catId) {
            await client.query(
              `INSERT INTO article_categories (article_id, category_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [article.id, catId]
            );
          }
        }
      }

      await client.query('COMMIT');
      classified++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to save classification for article ${article.id}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`Classified ${classified}/${articles.length} articles.`);
  return classified;
}

module.exports = { classifyArticle, classifyUnclassifiedArticles };
