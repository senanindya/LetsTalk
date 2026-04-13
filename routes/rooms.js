const express = require('express');
const { queryAll, queryOne, runSql } = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const roomRolesRoutes = require('./room-roles');

const router = express.Router();

// Mount roles sub-router
router.use('/:id/roles', roomRolesRoutes);

// ==========================================
// GET /api/rooms — List all rooms
// ==========================================
router.get('/', async (req, res) => {
    try {
        const rooms = await queryAll(`
            SELECT
                r.*,
                u.username as creator_name,
                (SELECT COUNT(*) FROM room_participants rp WHERE rp.room_id = r.id) as participant_count
            FROM rooms r
            LEFT JOIN users u ON r.creator_id = u.id
            ORDER BY r.created_at DESC
        `);

        const roomsWithColors = await Promise.all(rooms.map(async room => {
            const participantRows = await queryAll(`
                SELECT u.avatar_color
                FROM room_participants rp
                JOIN users u ON rp.user_id = u.id
                WHERE rp.room_id = ?
                LIMIT 5
            `, [room.id]);
            
            const colors = participantRows.map(p => p.avatar_color);
            return { ...room, colors };
        }));

        res.json({ rooms: roomsWithColors });
    } catch (err) {
        console.error('Get rooms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// POST /api/rooms — Create a new room
// ==========================================
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, description, language, flag, type, access, level, max_participants } = req.body;

        if (!name || !language) {
            return res.status(400).json({ error: 'Room name and language are required' });
        }

        if (type && !['voice', 'text', 'both'].includes(type)) {
            return res.status(400).json({ error: 'Room type must be voice, text, or both' });
        }

        const maxP = Math.min(Math.max(parseInt(max_participants) || 10, 2), 25);

        const result = await runSql(
            'INSERT INTO rooms (name, description, language, flag, type, access, level, max_participants, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', language, flag || '🌐', type || 'both', access || 'open', level || 'any', maxP, req.user.id]
        );

        const room = await queryOne('SELECT * FROM rooms WHERE id = ?', [result.lastInsertRowid]);

        res.status(201).json({ room });
    } catch (err) {
        console.error('Create room error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/rooms/:id — Get room details + recent messages
// ==========================================
router.get('/:id', async (req, res) => {
    try {
        const room = await queryOne(`
            SELECT r.*, u.username as creator_name
            FROM rooms r
            LEFT JOIN users u ON r.creator_id = u.id
            WHERE r.id = ?
        `, [parseInt(req.params.id)]);

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const messages = await queryAll(`
            SELECT m.*, u.username, u.avatar_color, u.avatar_url
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.room_id = ?
            ORDER BY m.created_at ASC
            LIMIT 50
        `, [parseInt(req.params.id)]);

        const participants = await queryAll(`
            SELECT u.id, u.username, u.avatar_color, u.avatar_url,
                CASE
                    WHEN r.creator_id = u.id THEN 'owner'
                    WHEN rr.role IS NOT NULL THEN rr.role
                    ELSE 'guest'
                END as room_role
            FROM room_participants rp
            JOIN users u ON rp.user_id = u.id
            JOIN rooms r ON r.id = rp.room_id
            LEFT JOIN room_roles rr ON rr.room_id = rp.room_id AND rr.user_id = u.id
            WHERE rp.room_id = ?
        `, [parseInt(req.params.id)]);

        res.json({ room, messages, participants });
    } catch (err) {
        console.error('Get room error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/rooms/:id/messages — Paginated message history
// ==========================================
router.get('/:id/messages', async (req, res) => {
    try {
        const { before, limit = 50 } = req.query;
        const limitNum = Math.min(parseInt(limit) || 50, 100);

        let messages;
        if (before) {
            messages = await queryAll(`
                SELECT m.*, u.username, u.avatar_color, u.avatar_url
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.room_id = ? AND m.id < ?
                ORDER BY m.created_at DESC
                LIMIT ?
            `, [parseInt(req.params.id), parseInt(before), limitNum]);
        } else {
            messages = await queryAll(`
                SELECT m.*, u.username, u.avatar_color, u.avatar_url
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.room_id = ?
                ORDER BY m.created_at DESC
                LIMIT ?
            `, [parseInt(req.params.id), limitNum]);
        }

        res.json({ messages: messages.reverse() });
    } catch (err) {
        console.error('Get messages error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
