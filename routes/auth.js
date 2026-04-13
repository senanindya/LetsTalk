const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne, queryAll, runSql } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ==========================================
// POST /api/auth/signup
// ==========================================
router.post('/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required' });
        }
        if (username.length < 2 || username.length > 30) {
            return res.status(400).json({ error: 'Username must be 2-30 characters' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existingUser = await queryOne('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser) {
            return res.status(409).json({ error: 'Username or email already exists' });
        }

        const hash = await bcrypt.hash(password, 10);
        const colors = ['#6366f1', '#22c55e', '#f43f5e', '#f59e0b', '#06b6d4', '#a855f7'];
        const avatarColor = colors[Math.floor(Math.random() * colors.length)];

        const result = await runSql(
            'INSERT INTO users (username, email, password, avatar_color) VALUES (?, ?, ?, ?)',
            [username, email, hash, avatarColor]
        );

        const user = { id: result.lastInsertRowid, username, email, avatar_color: avatarColor };
        const token = generateToken(user);

        res.status(201).json({ token, user: { id: user.id, username, email, avatar_url: '', avatar_color: avatarColor } });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// POST /api/auth/login
// ==========================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);

        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = generateToken(user);

        res.json({
            token,
            user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url || '', avatar_color: user.avatar_color }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// POST /api/auth/google
// ==========================================
router.post('/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Google credential required' });
        }

        const googleClientId = process.env.GOOGLE_CLIENT_ID;
        if (!googleClientId || googleClientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
            return res.status(501).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env' });
        }

        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (!response.ok) {
            return res.status(401).json({ error: 'Invalid Google token' });
        }

        const googleUser = await response.json();

        if (googleUser.aud !== googleClientId) {
            return res.status(401).json({ error: 'Token not intended for this application' });
        }

        const { sub: googleId, email, name, picture } = googleUser;

        let user = await queryOne('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email]);

        if (!user) {
            const colors = ['#6366f1', '#22c55e', '#f43f5e', '#f59e0b', '#06b6d4', '#a855f7'];
            const avatarColor = colors[Math.floor(Math.random() * colors.length)];
            const username = name.replace(/\s+/g, '') + '_' + Math.floor(Math.random() * 1000);

            const result = await runSql(
                'INSERT INTO users (username, email, google_id, avatar_url, avatar_color) VALUES (?, ?, ?, ?, ?)',
                [username, email, googleId, picture || '', avatarColor]
            );

            user = { id: result.lastInsertRowid, username, email, avatar_url: picture || '', avatar_color: avatarColor };
        } else {
            // Update Google ID and avatar URL on every login
            await runSql('UPDATE users SET google_id = COALESCE(google_id, ?), avatar_url = ? WHERE id = ?', [googleId, picture || '', user.id]);
            user.avatar_url = picture || user.avatar_url || '';
        }

        const token = generateToken(user);

        res.json({
            token,
            user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url || '', avatar_color: user.avatar_color }
        });
    } catch (err) {
        console.error('Google auth error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/auth/me
// ==========================================
router.get('/me', requireAuth, async (req, res) => {
    const user = await queryOne('SELECT id, username, email, native_lang, learning_lang, bio, avatar_url, avatar_color, created_at FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
});

// ==========================================
// PUT /api/auth/profile — Update user profile
// ==========================================
router.put('/profile', requireAuth, async (req, res) => {
    try {
        const { username, native_lang, learning_lang, bio, avatar_color } = req.body;

        const updates = [];
        const params = [];

        if (username !== undefined) {
            if (username.length < 2 || username.length > 30) {
                return res.status(400).json({ error: 'Username must be 2-30 characters' });
            }
            const existing = await queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id]);
            if (existing) {
                return res.status(409).json({ error: 'Username already taken' });
            }
            updates.push('username = ?');
            params.push(username);
        }
        if (native_lang !== undefined) { updates.push('native_lang = ?'); params.push(native_lang); }
        if (learning_lang !== undefined) { updates.push('learning_lang = ?'); params.push(learning_lang); }
        if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
        if (avatar_color !== undefined) { updates.push('avatar_color = ?'); params.push(avatar_color); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(req.user.id);
        await runSql(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        const user = await queryOne('SELECT id, username, email, native_lang, learning_lang, bio, avatar_url, avatar_color, created_at FROM users WHERE id = ?', [req.user.id]);
        res.json({ user });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// DELETE /api/auth/account — Delete user account
// ==========================================
router.delete('/account', requireAuth, async (req, res) => {
    try {
        await runSql('DELETE FROM room_participants WHERE user_id = ?', [req.user.id]);
        await runSql('DELETE FROM messages WHERE user_id = ?', [req.user.id]);
        await runSql('DELETE FROM users WHERE id = ?', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete account error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

