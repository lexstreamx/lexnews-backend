const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const pool = require('../db/pool');
const { mapTagsToSlugs } = require('../services/tagMapper');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const LW_SCHOOL_URL = process.env.LEARNWORLDS_SCHOOL_URL || 'https://academy.lexstream.io';
const LW_CLIENT_ID = process.env.LEARNWORLDS_CLIENT_ID;
const LW_CLIENT_SECRET = process.env.LEARNWORLDS_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

// Cache the LearnWorlds API access token (client credentials)
let lwApiToken = null;
let lwApiTokenExpiresAt = 0;

// Get a LearnWorlds API access token via client credentials (for server-to-server calls)
async function getLwApiToken() {
  if (lwApiToken && Date.now() < lwApiTokenExpiresAt - 300000) {
    return lwApiToken;
  }

  const res = await fetch(`${LW_SCHOOL_URL}/admin/api/oauth2/access_token`, {
    method: 'POST',
    headers: {
      'Lw-Client': LW_CLIENT_ID,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(JSON.stringify({
      client_id: LW_CLIENT_ID,
      client_secret: LW_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }))}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[Auth] Failed to get LW API token:', res.status, errText);
    throw new Error('Failed to get LearnWorlds API token');
  }

  const data = await res.json();
  if (!data.success) {
    console.error('[Auth] LW token request unsuccessful:', data.errors);
    throw new Error('LearnWorlds token request failed');
  }

  lwApiToken = data.tokenData.access_token;
  lwApiTokenExpiresAt = Date.now() + (data.tokenData.expires_in || 3600) * 1000;
  return lwApiToken;
}

// POST /api/auth/login — authenticate user via LearnWorlds password grant
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 1. Authenticate user via LearnWorlds resource owner credentials grant
    const tokenRes = await fetch(`${LW_SCHOOL_URL}/admin/api/oauth2/access_token`, {
      method: 'POST',
      headers: {
        'Lw-Client': LW_CLIENT_ID,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(JSON.stringify({
        client_id: LW_CLIENT_ID,
        client_secret: LW_CLIENT_SECRET,
        grant_type: 'password',
        email: normalizedEmail,
        password: password,
      }))}`,
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.success || !tokenData.tokenData) {
      const errorMsg = tokenData.errors?.[0]?.message || 'Invalid email or password';
      console.error('[Auth] LW password grant failed:', tokenData.errors);
      return res.status(401).json({ error: errorMsg });
    }

    const userAccessToken = tokenData.tokenData.access_token;
    const userRefreshToken = tokenData.tokenData.refresh_token || null;
    const expiresIn = tokenData.tokenData.expires_in || 8000;

    // 2. Get a server API token to fetch user profile
    const apiToken = await getLwApiToken();

    // 3. Fetch user profile from LearnWorlds by email
    const userRes = await fetch(`${LW_SCHOOL_URL}/admin/api/v2/users/${encodeURIComponent(normalizedEmail)}`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Lw-Client': LW_CLIENT_ID,
        'Accept': 'application/json',
      },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      console.error('[Auth] LW user profile fetch failed:', userRes.status, errText);
      return res.status(500).json({ error: 'Failed to fetch user profile' });
    }

    const lwUser = await userRes.json();
    const tags = lwUser.tags || [];
    const categorySlugs = mapTagsToSlugs(tags);
    const displayName = [lwUser.first_name, lwUser.last_name].filter(Boolean).join(' ') || lwUser.username || normalizedEmail;

    // 4. Upsert user in database
    const upsertResult = await pool.query(
      `INSERT INTO users (learnworlds_user_id, email, username, display_name, avatar_url, learnworlds_tags, category_slugs, lw_access_token, lw_refresh_token, lw_token_expires_at, last_login_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (learnworlds_user_id) DO UPDATE SET
         email = EXCLUDED.email,
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         learnworlds_tags = EXCLUDED.learnworlds_tags,
         category_slugs = EXCLUDED.category_slugs,
         lw_access_token = EXCLUDED.lw_access_token,
         lw_refresh_token = EXCLUDED.lw_refresh_token,
         lw_token_expires_at = EXCLUDED.lw_token_expires_at,
         last_login_at = NOW(),
         updated_at = NOW()
       RETURNING id, email, category_slugs`,
      [
        lwUser.id,
        normalizedEmail,
        lwUser.username || null,
        displayName,
        lwUser.avatar_url || null,
        tags,
        categorySlugs,
        userAccessToken,
        userRefreshToken,
        new Date(Date.now() + expiresIn * 1000),
      ]
    );

    const dbUser = upsertResult.rows[0];

    // 5. Mint JWT session token
    const sessionToken = jwt.sign(
      {
        userId: dbUser.id,
        email: dbUser.email,
        learnwordsUserId: lwUser.id,
        categorySlugs: dbUser.category_slugs,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 6. Set httpOnly cookie and return user info
    res.cookie('session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        username: lwUser.username,
        display_name: displayName,
        avatar_url: lwUser.avatar_url || null,
        category_slugs: dbUser.category_slugs,
        learnworlds_tags: tags,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me — return current user info
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, username, display_name, avatar_url, learnworlds_tags, category_slugs
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[Auth] Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/auth/logout — clear session cookie
router.post('/logout', (req, res) => {
  res.clearCookie('session', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
  res.json({ success: true });
});

module.exports = router;
