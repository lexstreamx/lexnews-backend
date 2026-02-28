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
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim();
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// GET /api/auth/login — redirect to LearnWorlds OAuth
router.get('/login', (req, res) => {
  const redirectUri = `${BACKEND_URL}/api/auth/callback`;
  const authorizeUrl = `${LW_SCHOOL_URL}/oauth2/authorize`
    + `?client_id=${encodeURIComponent(LW_CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&response_type=code`
    + `&scope=read_user_profile`;

  res.redirect(authorizeUrl);
});

// GET /api/auth/callback — OAuth callback from LearnWorlds
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?auth_error=no_code`);
  }

  try {
    // 1. Exchange code for access token
    const redirectUri = `${BACKEND_URL}/api/auth/callback`;
    const tokenRes = await fetch(`${LW_SCHOOL_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: LW_CLIENT_ID,
        client_secret: LW_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[Auth] Token exchange failed:', tokenRes.status, errText);
      return res.redirect(`${FRONTEND_URL}?auth_error=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // 2. Fetch user profile from LearnWorlds
    const userRes = await fetch(`${LW_SCHOOL_URL}/api/v2/user`, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Lw-Client': LW_CLIENT_ID,
      },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      console.error('[Auth] User profile fetch failed:', userRes.status, errText);
      return res.redirect(`${FRONTEND_URL}?auth_error=profile_fetch_failed`);
    }

    const lwUser = await userRes.json();
    const tags = lwUser.tags || [];
    const categorySlugs = mapTagsToSlugs(tags);
    const displayName = [lwUser.first_name, lwUser.last_name].filter(Boolean).join(' ') || lwUser.username || lwUser.email;
    const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

    // 3. Upsert user in database
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
        lwUser.email,
        lwUser.username,
        displayName,
        lwUser.avatar_url || null,
        tags,
        categorySlugs,
        access_token,
        refresh_token || null,
        tokenExpiresAt,
      ]
    );

    const dbUser = upsertResult.rows[0];

    // 4. Mint JWT session token
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

    // 5. Set httpOnly cookie and redirect to frontend
    res.cookie('session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    res.redirect(`${FRONTEND_URL}?authenticated=true`);
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.redirect(`${FRONTEND_URL}?auth_error=server_error`);
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
