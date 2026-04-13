const express = require('express');
const { queryOne, runSql } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// Helper: get effective role for a user in a room
// Owner is the creator_id; co-owners are stored in room_roles
async function getRole(roomId, userId) {
    const room = await queryOne('SELECT creator_id FROM rooms WHERE id = ?', [roomId]);
    if (!room) return null;
    if (room.creator_id === userId) return 'owner';
    const row = await queryOne('SELECT role FROM room_roles WHERE room_id = ? AND user_id = ?', [roomId, userId]);
    return row ? row.role : 'guest';
}

// POST /api/rooms/:id/roles — Assign role (owner only)
router.post('/', requireAuth, async (req, res) => {
    try {
        const roomId = parseInt(req.params.id);
        const { userId, role } = req.body;
        if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
        if (!['co-owner', 'guest'].includes(role)) return res.status(400).json({ error: 'Role must be co-owner or guest' });

        const myRole = await getRole(roomId, req.user.id);
        if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can assign roles' });

        const targetRole = await getRole(roomId, parseInt(userId));
        if (targetRole === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });

        if (role === 'guest') {
            // Removing co-owner role → delete from room_roles
            await runSql('DELETE FROM room_roles WHERE room_id = ? AND user_id = ?', [roomId, userId]);
        } else {
            // Upsert co-owner
            await runSql(
                'INSERT INTO room_roles (room_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role',
                [roomId, userId, role]
            );
        }

        res.json({ success: true, roomId, userId, role });
    } catch (err) {
        console.error('Role assign error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/rooms/:id/roles/:userId — Reset to guest
router.delete('/:userId', requireAuth, async (req, res) => {
    try {
        const roomId = parseInt(req.params.id);
        const targetUserId = parseInt(req.params.userId);

        const myRole = await getRole(roomId, req.user.id);
        if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can remove roles' });

        const targetRole = await getRole(roomId, targetUserId);
        if (targetRole === 'owner') return res.status(403).json({ error: 'Cannot remove owner role' });

        await runSql('DELETE FROM room_roles WHERE room_id = ? AND user_id = ?', [roomId, targetUserId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Role remove error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
