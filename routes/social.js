const express = require('express');
const { queryAll, queryOne, runSql } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/social/me — own social data (followers, following, blocks, DM list)
router.get('/me', requireAuth, async (req, res) => {
    try {
        const uid = req.user.id;

        const [followers, following, blocks, user] = await Promise.all([
            queryAll(`
                SELECT u.id, u.username, u.avatar_url, u.avatar_color
                FROM follows f JOIN users u ON u.id = f.follower_id
                WHERE f.following_id = ?
                ORDER BY f.created_at DESC LIMIT 100
            `, [uid]),
            queryAll(`
                SELECT u.id, u.username, u.avatar_url, u.avatar_color
                FROM follows f JOIN users u ON u.id = f.following_id
                WHERE f.follower_id = ?
                ORDER BY f.created_at DESC LIMIT 100
            `, [uid]),
            queryAll(`
                SELECT blocked_id FROM blocks WHERE blocker_id = ?
            `, [uid]),
            queryOne('SELECT followers_count, following_count FROM users WHERE id = ?', [uid])
        ]);

        res.json({ followers, following, blocks: blocks.map(b => b.blocked_id), counts: user });
    } catch (err) {
        console.error('Social me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/:userId — public profile
router.get('/users/:userId', requireAuth, async (req, res) => {
    try {
        const targetId = parseInt(req.params.userId);
        const myId = req.user.id;

        const user = await queryOne(`
            SELECT id, username, bio, avatar_url, avatar_color, native_lang, learning_lang,
                   followers_count, following_count, created_at
            FROM users WHERE id = ?
        `, [targetId]);

        if (!user) return res.status(404).json({ error: 'User not found' });

        const [followRow, blockRow, blockedByRow] = await Promise.all([
            queryOne('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [myId, targetId]),
            queryOne('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [myId, targetId]),
            queryOne('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [targetId, myId])
        ]);

        res.json({
            user,
            isFollowing: !!followRow,
            isBlocked: !!blockRow,
            isBlockedBy: !!blockedByRow
        });
    } catch (err) {
        console.error('User profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/social/follow/:userId
router.post('/follow/:userId', requireAuth, async (req, res) => {
    try {
        const followingId = parseInt(req.params.userId);
        const followerId = req.user.id;
        if (followingId === followerId) return res.status(400).json({ error: 'Cannot follow yourself' });

        await runSql(
            'INSERT INTO follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
            [followerId, followingId]
        );
        // Recalculate counts accurately
        const [fcRow, fgRow] = await Promise.all([
            queryOne('SELECT COUNT(*) as c FROM follows WHERE following_id = ?', [followingId]),
            queryOne('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?', [followerId])
        ]);
        await runSql('UPDATE users SET followers_count = ? WHERE id = ?', [parseInt(fcRow.c), followingId]);
        await runSql('UPDATE users SET following_count = ? WHERE id = ?', [parseInt(fgRow.c), followerId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Follow error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/social/follow/:userId
router.delete('/follow/:userId', requireAuth, async (req, res) => {
    try {
        const followingId = parseInt(req.params.userId);
        const followerId = req.user.id;

        await runSql('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [followerId, followingId]);
        const [fcRow, fgRow] = await Promise.all([
            queryOne('SELECT COUNT(*) as c FROM follows WHERE following_id = ?', [followingId]),
            queryOne('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?', [followerId])
        ]);
        await runSql('UPDATE users SET followers_count = ? WHERE id = ?', [parseInt(fcRow.c), followingId]);
        await runSql('UPDATE users SET following_count = ? WHERE id = ?', [parseInt(fgRow.c), followerId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Unfollow error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// POST /api/social/block/:userId
router.post('/block/:userId', requireAuth, async (req, res) => {
    try {
        const blockedId = parseInt(req.params.userId);
        const blockerId = req.user.id;
        if (blockedId === blockerId) return res.status(400).json({ error: 'Cannot block yourself' });

        await runSql('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [blockerId, blockedId]);
        // Also unfollow both directions
        await runSql('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)', [blockerId, blockedId, blockedId, blockerId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Block error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/social/block/:userId
router.delete('/block/:userId', requireAuth, async (req, res) => {
    try {
        const blockedId = parseInt(req.params.userId);
        await runSql('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, blockedId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Unblock error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/social/dms — DM conversation list (last message per partner)
router.get('/dms', requireAuth, async (req, res) => {
    try {
        const uid = req.user.id;
        // Get all distinct conversation partners with their latest message
        const convos = await queryAll(`
            SELECT
                partner_id,
                u.username as partner_username,
                u.avatar_url as partner_avatar_url,
                u.avatar_color as partner_avatar_color,
                last_message,
                last_sender_id,
                last_time
            FROM (
                SELECT
                    CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as partner_id,
                    content as last_message,
                    sender_id as last_sender_id,
                    created_at as last_time,
                    ROW_NUMBER() OVER (
                        PARTITION BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
                        ORDER BY created_at DESC
                    ) as rn
                FROM direct_messages
                WHERE sender_id = ? OR receiver_id = ?
            ) sub
            JOIN users u ON u.id = sub.partner_id
            WHERE sub.rn = 1
            ORDER BY last_time DESC
        `, [uid, uid, uid, uid]);
        res.json({ conversations: convos });
    } catch (err) {
        console.error('DM list error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// GET /api/social/dms/:userId — DM history
router.get('/dms/:userId', requireAuth, async (req, res) => {
    try {
        const uid = req.user.id;
        const otherId = parseInt(req.params.userId);

        // Check block
        const blockRow = await queryOne(
            'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
            [uid, otherId, otherId, uid]
        );
        if (blockRow) return res.status(403).json({ error: 'Blocked' });

        const messages = await queryAll(`
            SELECT dm.*, u.username as sender_username, u.avatar_url as sender_avatar_url, u.avatar_color as sender_avatar_color
            FROM direct_messages dm
            JOIN users u ON u.id = dm.sender_id
            WHERE (dm.sender_id = ? AND dm.receiver_id = ?) OR (dm.sender_id = ? AND dm.receiver_id = ?)
            ORDER BY dm.created_at ASC
            LIMIT 50
        `, [uid, otherId, otherId, uid]);

        res.json({ messages });
    } catch (err) {
        console.error('DM history error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/social/dms/:userId — Send DM (REST, socket also used)
router.post('/dms/:userId', requireAuth, async (req, res) => {
    try {
        const uid = req.user.id;
        const receiverId = parseInt(req.params.userId);
        const { content } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });

        const blockRow = await queryOne(
            'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
            [uid, receiverId, receiverId, uid]
        );
        if (blockRow) return res.status(403).json({ error: 'Blocked' });

        const result = await runSql(
            'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
            [uid, receiverId, content.trim()]
        );

        const msg = await queryOne(`
            SELECT dm.*, u.username as sender_username, u.avatar_url as sender_avatar_url, u.avatar_color as sender_avatar_color
            FROM direct_messages dm JOIN users u ON u.id = dm.sender_id
            WHERE dm.id = ?
        `, [result.lastInsertRowid]);

        res.json({ message: msg });
    } catch (err) {
        console.error('Send DM error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
