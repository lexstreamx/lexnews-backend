const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/categories — all categories with article counts
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        lc.id,
        lc.name,
        lc.slug,
        COUNT(ac.article_id) AS article_count
      FROM legal_categories lc
      LEFT JOIN article_categories ac ON ac.category_id = lc.id
      GROUP BY lc.id
      ORDER BY lc.name
    `);

    res.json({ categories: result.rows });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

module.exports = router;
