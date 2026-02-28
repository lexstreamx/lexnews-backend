const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/articles — paginated, filterable
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      feed_type,
      category,
      jurisdiction,
      search,
      saved_only,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (feed_type) {
      conditions.push(`a.feed_type = $${paramIndex++}`);
      params.push(feed_type);
    }

    if (jurisdiction) {
      const jurisdictions = jurisdiction.split(',').map(j => j.trim()).filter(Boolean);
      if (jurisdictions.length === 1) {
        conditions.push(`a.jurisdiction = $${paramIndex++}`);
        params.push(jurisdictions[0]);
      } else if (jurisdictions.length > 1) {
        conditions.push(`a.jurisdiction = ANY($${paramIndex++}::text[])`);
        params.push(jurisdictions);
      }
    }

    if (search) {
      conditions.push(`(a.title ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      const categories = category.split(',').map(c => c.trim()).filter(Boolean);
      if (categories.length === 1) {
        conditions.push(`EXISTS (
          SELECT 1 FROM article_categories ac
          JOIN legal_categories lc ON lc.id = ac.category_id
          WHERE ac.article_id = a.id AND lc.slug = $${paramIndex++}
        )`);
        params.push(categories[0]);
      } else if (categories.length > 1) {
        conditions.push(`EXISTS (
          SELECT 1 FROM article_categories ac
          JOIN legal_categories lc ON lc.id = ac.category_id
          WHERE ac.article_id = a.id AND lc.slug = ANY($${paramIndex++}::text[])
        )`);
        params.push(categories);
      }
    }

    if (saved_only === 'true') {
      conditions.push(`EXISTS (
        SELECT 1 FROM saved_articles sa WHERE sa.article_id = a.id
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM articles a ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch articles with categories and judgment metadata
    const articlesResult = await pool.query(
      `SELECT
        a.*,
        COALESCE(
          json_agg(DISTINCT
            jsonb_build_object('id', lc.id, 'name', lc.name, 'slug', lc.slug)
          ) FILTER (WHERE lc.id IS NOT NULL),
          '[]'
        ) AS categories,
        EXISTS(SELECT 1 FROM saved_articles sa WHERE sa.article_id = a.id) AS is_saved,
        EXISTS(SELECT 1 FROM read_articles ra WHERE ra.article_id = a.id) AS is_read,
        CASE WHEN jm.id IS NOT NULL THEN
          json_build_object(
            'ecli', jm.ecli,
            'court', jm.court,
            'chamber', jm.chamber,
            'judge_rapporteur', jm.judge_rapporteur,
            'procedure_type', jm.procedure_type,
            'subject_matter', jm.subject_matter,
            'document_type', jm.document_type,
            'case_name', jm.case_name,
            'decision_date', jm.decision_date,
            'ai_summary', jm.ai_summary
          )
        ELSE NULL END AS judgment
      FROM articles a
      LEFT JOIN article_categories ac ON ac.article_id = a.id
      LEFT JOIN legal_categories lc ON lc.id = ac.category_id
      LEFT JOIN judgment_metadata jm ON jm.article_id = a.id
      ${whereClause}
      GROUP BY a.id, jm.id
      ORDER BY a.relevance_score DESC, a.published_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      articles: articlesResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /api/articles/jurisdictions — distinct jurisdiction values
router.get('/jurisdictions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT jurisdiction FROM articles WHERE jurisdiction IS NOT NULL AND jurisdiction != '' ORDER BY jurisdiction`
    );
    res.json({ jurisdictions: result.rows.map(r => r.jurisdiction) });
  } catch (err) {
    console.error('Error fetching jurisdictions:', err);
    res.status(500).json({ error: 'Failed to fetch jurisdictions' });
  }
});

// POST /api/articles/:id/save
router.post('/:id/save', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `INSERT INTO saved_articles (article_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [id]
    );
    res.json({ saved: true });
  } catch (err) {
    console.error('Error saving article:', err);
    res.status(500).json({ error: 'Failed to save article' });
  }
});

// DELETE /api/articles/:id/save
router.delete('/:id/save', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `DELETE FROM saved_articles WHERE article_id = $1`,
      [id]
    );
    res.json({ saved: false });
  } catch (err) {
    console.error('Error unsaving article:', err);
    res.status(500).json({ error: 'Failed to unsave article' });
  }
});

// POST /api/articles/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `INSERT INTO read_articles (article_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [id]
    );
    res.json({ read: true });
  } catch (err) {
    console.error('Error marking article as read:', err);
    res.status(500).json({ error: 'Failed to mark article as read' });
  }
});

// DELETE /api/articles/:id/read
router.delete('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `DELETE FROM read_articles WHERE article_id = $1`,
      [id]
    );
    res.json({ read: false });
  } catch (err) {
    console.error('Error marking article as unread:', err);
    res.status(500).json({ error: 'Failed to mark article as unread' });
  }
});

module.exports = router;
