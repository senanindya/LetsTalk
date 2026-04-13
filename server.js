require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { initDb, queryAll, queryOne, runSql, saveDb } = require('./database/db');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const socialRoutes = require('./routes/social');

// ==========================================
// EXPRESS SETUP
// ==========================================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/social', socialRoutes);


// Public config endpoint (exposes non-secret config to frontend)
app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    });
});

// GIF API Endpoint (Proxies Giphy)
app.get('/api/gifs', async (req, res) => {
    try {
        const query = req.query.q || '';
        const apiKey = process.env.GIPHY_API_KEY;
        
        if (!apiKey) {
            return res.status(401).json({ error: 'Giphy API key missing. Please add GIPHY_API_KEY to your .env' });
        }

        let url = query 
            ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=24&rating=g`
            : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=24&rating=g`;
            
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            return res.status(500).json({ error: 'Failed to load GIFs' });
        }
        
        // Normalize Giphy response to match expected frontend structure
        const normalizedResults = (data.data || []).map(gif => ({
            media_formats: {
                tinygif: { url: gif.images.fixed_height_small.url },
                gif: { url: gif.images.original.url }
            }
        }));
        
        res.json({ results: normalizedResults });
    } catch (e) {
        console.error('GIF API Error:', e);
        res.status(500).json({ error: 'Failed to access GIF service' });
    }
});

// Sticker API Endpoint (Proxies Giphy Stickers)
app.get('/api/stickers', async (req, res) => {
    try {
        const query = req.query.q || '';
        const apiKey = process.env.GIPHY_API_KEY;
        
        if (!apiKey) {
            return res.status(401).json({ error: 'Giphy API key missing. Please add GIPHY_API_KEY to your .env' });
        }

        let url = query 
            ? `https://api.giphy.com/v1/stickers/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=24&rating=g`
            : `https://api.giphy.com/v1/stickers/trending?api_key=${apiKey}&limit=24&rating=g`;
            
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            return res.status(500).json({ error: 'Failed to load Stickers' });
        }
        
        const normalizedResults = (data.data || []).map(gif => ({
            media_formats: {
                tinygif: { url: gif.images.fixed_height_small.url },
                gif: { url: gif.images.original.url }
            }
        }));
        
        res.json({ results: normalizedResults });
    } catch (e) {
        console.error('Sticker API Error:', e);
        res.status(500).json({ error: 'Failed to access Sticker service' });
    }
});

// Image Upload Endpoint (Proxies IMGBB)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided' });
        }
        
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey) {
            return res.status(401).json({ error: 'IMGBB_API_KEY missing in .env file' });
        }

        const base64Image = req.file.buffer.toString('base64');
        const formData = new URLSearchParams();
        formData.append('image', base64Image);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const data = await response.json();
        
        if (!response.ok || !data.success) {
            console.error("ImgBB Error:", data);
            return res.status(500).json({ error: 'Failed to upload image to ImgBB server' });
        }
        
        res.json({ url: data.data.url });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ error: 'Failed to process image upload' });
    }
});

// YouTube API Proxy
app.get('/api/youtube', async (req, res) => {
    try {
        const query = req.query.q;
        const apiKey = process.env.YOUTUBE_API_KEY;
        
        if (!apiKey) return res.status(401).json({ error: 'YOUTUBE_API_KEY missing' });
        if (!query) return res.status(400).json({ error: 'Search query required' });

        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&videoEmbeddable=true&q=${encodeURIComponent(query)}&type=video&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) return res.status(500).json({ error: 'YouTube API Error' });
        
        const results = data.items.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails.high.url
        }));
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: 'Failed to search YouTube' });
    }
});

// ==========================================
// DATABASE ADMIN VIEWER (dev-only)
// ==========================================
app.get('/api/admin/db', async (req, res) => {
    const adminKey = process.env.ADMIN_KEY || 'dev123';
    if (req.query.key !== adminKey) {
        return res.status(403).json({ error: 'Invalid admin key. Pass ?key=YOUR_ADMIN_KEY' });
    }
    try {
        const users = await queryAll('SELECT id, username, email, google_id, native_lang, learning_lang, bio, avatar_url, avatar_color, created_at FROM users');
        const rooms = await queryAll('SELECT * FROM rooms');
        const messages = await queryAll(`
            SELECT m.*, u.username, u.avatar_color, u.avatar_url
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.id
            ORDER BY m.created_at DESC
            LIMIT 200
        `);
        const participants = await queryAll(`
            SELECT rp.*, u.username, r.name as room_name
            FROM room_participants rp
            LEFT JOIN users u ON rp.user_id = u.id
            LEFT JOIN rooms r ON rp.room_id = r.id
        `);

        res.json({
            stats: {
                users: users.length,
                rooms: rooms.length,
                messages: messages.length,
                activeParticipants: participants.length,
            },
            users,
            rooms,
            messages,
            participants,
        });
    } catch (err) {
        console.error('Admin DB error:', err);
        res.status(500).json({ error: 'Failed to query database' });
    }
});


// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// SOCKET.IO SETUP
// ==========================================
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Track voice peers per room: { roomId: Map<socketId, {userId, username}> }
const voicePeers = {};

// Map userId → socketId for DM routing
const userSocketMap = new Map();

// Authenticate socket connections
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        socket.user = null;
        return next();
    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = { id: payload.id, username: payload.username, email: payload.email };
        next();
    } catch {
        socket.user = null;
        next();
    }
});

io.on('connection', (socket) => {
    if (!socket.user) {
        socket.disconnect(true);
        return;
    }

    console.log(`✓ ${socket.user.username} connected (socket ${socket.id})`);

    // Track for DM routing
    userSocketMap.set(socket.user.id, socket.id);

    // ------------------------------------------
    // JOIN ROOM
    // ------------------------------------------
    socket.on('join-room', async (roomId) => {
        const room = await queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
        if (!room) return;

        // Leave any other rooms first
        for (const r of socket.rooms) {
            if (r !== socket.id && r.startsWith('room-')) {
                leaveRoom(socket, parseInt(r.split('-')[1]));
            }
        }

        const socketRoom = `room-${roomId}`;
        socket.join(socketRoom);
        socket.currentRoom = roomId;

        // Add to participants
        try {
            // Check if already exists
            const existing = await queryOne('SELECT * FROM room_participants WHERE room_id = ? AND user_id = ?', [roomId, socket.user.id]);
            if (!existing) {
                await runSql('INSERT INTO room_participants (room_id, user_id) VALUES (?, ?)', [roomId, socket.user.id]);
            }
        } catch (e) {
            // Ignore
        }

        // Get current participants
        const participants = await queryAll(`
            SELECT u.id, u.username, u.avatar_color, u.avatar_url
            FROM room_participants rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_id = ?
        `, [roomId]);

        io.to(socketRoom).emit('user-joined', {
            user: socket.user,
            participants,
            participantCount: participants.length
        });

        console.log(`  → ${socket.user.username} joined room ${roomId}`);
    });

    // ------------------------------------------
    // LEAVE ROOM
    // ------------------------------------------
    socket.on('leave-room', async (roomId) => {
        await leaveRoom(socket, roomId);
    });

    async function leaveRoom(sock, roomId) {
        const socketRoom = `room-${roomId}`;
        sock.leave(socketRoom);

        // Remove voice peer if applicable
        if (voicePeers[roomId]) {
            voicePeers[roomId].delete(sock.id);
            io.to(socketRoom).emit('voice-peer-left', {
                socketId: sock.id,
                userId: sock.user.id,
                username: sock.user.username
            });
        }

        // Remove from participants
        await runSql('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?', [roomId, sock.user.id]);

        const participants = await queryAll(`
            SELECT u.id, u.username, u.avatar_color, u.avatar_url
            FROM room_participants rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_id = ?
        `, [roomId]);

        io.to(socketRoom).emit('user-left', {
            user: sock.user,
            participants,
            participantCount: participants.length
        });

        sock.currentRoom = null;
        console.log(`  ← ${sock.user.username} left room ${roomId}`);
    }

    // ------------------------------------------
    // SEND MESSAGE
    // ------------------------------------------
    socket.on('send-message', async ({ roomId, content }) => {
        if (!content || !content.trim()) return;
        if (!roomId) return;

        const result = await runSql(
            'INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)',
            [roomId, socket.user.id, content.trim()]
        );

        const userInfo = await queryOne('SELECT avatar_color, avatar_url FROM users WHERE id = ?', [socket.user.id]);

        const message = {
            id: result.lastInsertRowid,
            room_id: roomId,
            user_id: socket.user.id,
            username: socket.user.username,
            avatar_color: userInfo?.avatar_color || '#6366f1',
            avatar_url: userInfo?.avatar_url || '',
            content: content.trim(),
            created_at: new Date().toISOString()
        };

        io.to(`room-${roomId}`).emit('new-message', message);
    });

    // ------------------------------------------
    // VOICE: JOIN VOICE CHANNEL
    // ------------------------------------------
    socket.on('voice-join', (roomId) => {
        if (!voicePeers[roomId]) {
            voicePeers[roomId] = new Map();
        }

        voicePeers[roomId].set(socket.id, {
            userId: socket.user.id,
            username: socket.user.username
        });

        // Send list of existing voice peers to the new joiner
        const existingPeers = [];
        for (const [peerId, peerInfo] of voicePeers[roomId]) {
            if (peerId !== socket.id) {
                existingPeers.push({ socketId: peerId, ...peerInfo });
            }
        }

        socket.emit('voice-peers', existingPeers);

        socket.to(`room-${roomId}`).emit('voice-peer-joined', {
            socketId: socket.id,
            userId: socket.user.id,
            username: socket.user.username
        });

        console.log(`  🎙️ ${socket.user.username} joined voice in room ${roomId} (${voicePeers[roomId].size} peers)`);
    });

    // ------------------------------------------
    // VOICE: LEAVE VOICE CHANNEL
    // ------------------------------------------
    socket.on('voice-leave', (roomId) => {
        if (voicePeers[roomId]) {
            voicePeers[roomId].delete(socket.id);
            io.to(`room-${roomId}`).emit('voice-peer-left', {
                socketId: socket.id,
                userId: socket.user.id,
                username: socket.user.username
            });
            console.log(`  🔇 ${socket.user.username} left voice in room ${roomId}`);
        }
    });

    // ------------------------------------------
    // WEBRTC SIGNALING
    // ------------------------------------------
    socket.on('webrtc-offer', ({ to, offer }) => {
        io.to(to).emit('webrtc-offer', {
            from: socket.id,
            offer,
            username: socket.user.username
        });
    });

    socket.on('webrtc-answer', ({ to, answer }) => {
        io.to(to).emit('webrtc-answer', {
            from: socket.id,
            answer
        });
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('webrtc-ice-candidate', {
            from: socket.id,
            candidate
        });
    });

    // ------------------------------------------
    // SCREEN SHARE SIGNALING
    // ------------------------------------------
    socket.on('screen-share-started', ({ roomId }) => {
        if (!roomId) return;
        socket.to(`room-${roomId}`).emit('screen-share-started', {
            socketId: socket.id,
            username: socket.user.username
        });
        console.log(`  📺 ${socket.user.username} started screen sharing in room ${roomId}`);
    });

    socket.on('screen-share-stopped', ({ roomId }) => {
        if (!roomId) return;
        socket.to(`room-${roomId}`).emit('screen-share-stopped', {
            socketId: socket.id,
            username: socket.user.username
        });
        console.log(`  ⏹️ ${socket.user.username} stopped screen sharing in room ${roomId}`);
    });

    // ------------------------------------------
    // YOUTUBE SYNC EVENT
    // ------------------------------------------
    socket.on('yt-sync', ({ roomId, action, payload }) => {
        if (!roomId) return;
        socket.to(`room-${roomId}`).emit('yt-sync', { action, payload, from: socket.id });
    });

    // ------------------------------------------
    // ROOM MODERATION (kick / mute / role-update)
    // ------------------------------------------
    socket.on('room-kick', ({ roomId, targetSocketId, targetUserId }) => {
        if (!roomId) return;
        // Server just relays — permission check is enforced at API level before this fires
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.emit('you-were-kicked', {
                roomId,
                byUsername: socket.user.username
            });
            targetSocket.leave(`room-${roomId}`);
        }
        io.to(`room-${roomId}`).emit('user-kicked', {
            userId: targetUserId,
            byUsername: socket.user.username
        });
    });

    socket.on('room-mute', ({ roomId, targetUserId, muted }) => {
        if (!roomId) return;
        // Broadcast mute state to the room
        io.to(`room-${roomId}`).emit('user-muted', {
            userId: targetUserId,
            muted,
            byUsername: socket.user.username
        });
        // Also notify target directly
        const targetSocketId = userSocketMap.get(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('you-were-muted', { muted, byUsername: socket.user.username });
        }
    });

    socket.on('room-role-update', ({ roomId, targetUserId, role }) => {
        if (!roomId) return;
        io.to(`room-${roomId}`).emit('room-role-update', {
            userId: targetUserId,
            role,
            byUsername: socket.user.username
        });
    });

    // ------------------------------------------
    // DIRECT MESSAGES (real-time relay)
    // ------------------------------------------
    socket.on('dm-send', async ({ receiverId, content }) => {
        if (!content || !receiverId) return;
        const targetSocketId = userSocketMap.get(receiverId);
        const payload = {
            from: socket.user.id,
            fromUsername: socket.user.username,
            content,
            time: new Date().toISOString()
        };
        if (targetSocketId) {
            io.to(targetSocketId).emit('dm-message', payload);
        }
        // Echo back to sender for confirmation
        socket.emit('dm-message-sent', payload);
    });

    socket.on('dm-typing', ({ receiverId }) => {
        const targetSocketId = userSocketMap.get(receiverId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('dm-typing', {
                from: socket.user.id,
                fromUsername: socket.user.username
            });
        }
    });

    // ------------------------------------------
    // DISCONNECT
    // ------------------------------------------
    socket.on('disconnect', async () => {
        console.log(`✗ ${socket.user.username} disconnected`);

        // Clean up DM routing map
        if (userSocketMap.get(socket.user.id) === socket.id) {
            userSocketMap.delete(socket.user.id);
        }

        // Clean up voice peers
        for (const roomIdStr of Object.keys(voicePeers)) {
            const roomId = parseInt(roomIdStr);
            if (voicePeers[roomId] && voicePeers[roomId].has(socket.id)) {
                voicePeers[roomId].delete(socket.id);
                io.to(`room-${roomId}`).emit('voice-peer-left', {
                    socketId: socket.id,
                    userId: socket.user.id,
                    username: socket.user.username
                });
            }
        }

        // Remove from all room_participants
        await runSql('DELETE FROM room_participants WHERE user_id = ?', [socket.user.id]);

        // Notify current room
        if (socket.currentRoom) {
            const participants = await queryAll(`
                SELECT u.id, u.username, u.avatar_color, u.avatar_url
                FROM room_participants rp
                JOIN users u ON rp.user_id = u.id
                WHERE rp.room_id = ?
            `, [socket.currentRoom]);

            io.to(`room-${socket.currentRoom}`).emit('user-left', {
                user: socket.user,
                participants,
                participantCount: participants.length
            });
        }
    });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;

async function start() {
    await initDb();

    // Auto-seed if database is empty
    const roomCount = await queryOne('SELECT COUNT(*) as count FROM rooms');
    if (!roomCount || roomCount.count === 0) {
        console.log('  📦 Empty database detected — running seed...');
        // Run seed inline
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash('demo1234', 10);

        const demoUsers = [
            { username: 'Maria', email: 'maria@demo.com', lang: 'english', color: '#6366f1' },
            { username: 'Kenji', email: 'kenji@demo.com', lang: 'japanese', color: '#22c55e' },
            { username: 'Carlos', email: 'carlos@demo.com', lang: 'spanish', color: '#f43f5e' },
            { username: 'Ana', email: 'ana@demo.com', lang: 'spanish', color: '#f59e0b' },
            { username: 'Sophie', email: 'sophie@demo.com', lang: 'french', color: '#06b6d4' },
            { username: 'Yuki', email: 'yuki@demo.com', lang: 'japanese', color: '#a855f7' },
            { username: 'Tom', email: 'tom@demo.com', lang: 'english', color: '#6366f1' },
            { username: 'Lisa', email: 'lisa@demo.com', lang: 'english', color: '#f43f5e' },
            { username: 'Pierre', email: 'pierre@demo.com', lang: 'french', color: '#22c55e' },
            { username: 'Emma', email: 'emma@demo.com', lang: 'french', color: '#f59e0b' },
            { username: 'Minji', email: 'minji@demo.com', lang: 'korean', color: '#a855f7' },
            { username: 'Alex', email: 'alex@demo.com', lang: 'english', color: '#06b6d4' },
            { username: 'Hans', email: 'hans@demo.com', lang: 'german', color: '#f59e0b' },
            { username: 'Fatima', email: 'fatima@demo.com', lang: 'arabic', color: '#22c55e' },
            { username: 'Priya', email: 'priya@demo.com', lang: 'hindi', color: '#6366f1' },
            { username: 'Wei', email: 'wei@demo.com', lang: 'chinese', color: '#f43f5e' },
            { username: 'Lucas', email: 'lucas@demo.com', lang: 'portuguese', color: '#22c55e' },
            { username: 'Sarah', email: 'sarah@demo.com', lang: 'english', color: '#f59e0b' },
            { username: 'Diego', email: 'diego@demo.com', lang: 'spanish', color: '#f43f5e' },
            { username: 'Kim', email: 'kim@demo.com', lang: 'korean', color: '#06b6d4' },
        ];

        const userIds = {};
        for (const u of demoUsers) {
            const result = await runSql(
                'INSERT INTO users (username, email, password, native_lang, avatar_color) VALUES (?, ?, ?, ?, ?)',
                [u.username, u.email, passwordHash, u.lang, u.color]
            );
            userIds[u.username] = result.lastInsertRowid;
        }

        const rooms = [
            { name: 'English Casual Talk', desc: 'Relaxed conversation about anything — movies, travel, daily life.', lang: 'english', flag: '🇬🇧', type: 'both', creator: 'Maria',
              msgs: [['Maria','Hey everyone! I just came back from London 🇬🇧'],['Kenji','Oh nice! How was the weather?'],['Maria','Rainy as expected 😂 but I loved it!'],['Fatima','I want to visit London someday. Any tips?'],['Kenji','Try the Borough Market, the food is amazing!']] },
            { name: 'Español para Todos', desc: 'Practice your Spanish with native speakers from Spain and Latin America.', lang: 'spanish', flag: '🇪🇸', type: 'voice', creator: 'Carlos',
              msgs: [['Carlos','¡Hola! ¿Cómo están todos?'],['Ana','Muy bien, gracias. ¿Y tú?'],['Carlos','Todo perfecto. ¿Alguien quiere practicar verbos?'],['Sophie','Sí, por favor. Los verbos irregulares me confunden.']] },
            { name: '日本語 Practice Room', desc: 'Beginner-friendly Japanese practice. Hiragana, Katakana & basic Kanji.', lang: 'japanese', flag: '🇯🇵', type: 'text', creator: 'Yuki',
              msgs: [['Yuki','こんにちは！今日は何を勉強しますか？'],['Tom','I want to practice katakana today!'],['Yuki','いいですね！Let me help you.'],['Lisa','Can someone explain は vs が?']] },
            { name: 'Café Français', desc: 'Un café virtuel pour parler français. Tous niveaux bienvenus!', lang: 'french', flag: '🇫🇷', type: 'voice', creator: 'Pierre',
              msgs: [['Pierre','Bonjour à tous! Comment ça va?'],['Emma',"Ça va bien! J'apprends le subjonctif..."],['Pierre',"Ah, le subjonctif! C'est un sujet intéressant."]] },
            { name: '한국어 Chat Room', desc: 'Learn Korean through K-drama discussions and everyday conversation.', lang: 'korean', flag: '🇰🇷', type: 'both', creator: 'Minji',
              msgs: [['Minji','안녕하세요! 오늘 무슨 드라마 봤어요?'],['Alex','I watched Squid Game season 3! So good!'],['Minji','오 정말? 저도 봤어요! No spoilers! 😂']] },
            { name: 'Deutsch Sprechen', desc: 'Improve your German speaking skills with friendly conversation partners.', lang: 'german', flag: '🇩🇪', type: 'voice', creator: 'Hans',
              msgs: [['Hans','Hallo zusammen! Wie geht es euch?'],['Yuki','Mir geht es gut, danke!'],['Hans','Wollen wir über Reisen sprechen?']] },
            { name: 'IELTS Prep Group', desc: 'Focused practice for IELTS speaking tasks. Mock tests and feedback.', lang: 'english', flag: '🇺🇸', type: 'both', creator: 'Priya',
              msgs: [['Priya',"Let's practice Part 2 — describe a place you visited."],['Wei',"I'll go first! I visited Kyoto last year..."],['Priya','Great start! Try to use more descriptive adjectives.']] },
            { name: 'Bate-papo Brasileiro', desc: 'Casual Brazilian Portuguese conversations. Come practice with us!', lang: 'portuguese', flag: '🇧🇷', type: 'text', creator: 'Lucas',
              msgs: [['Lucas','E aí galera! Tudo bem?'],['Sarah','Oi Lucas! Estou praticando meu português.'],['Lucas','Seu português está muito bom!']] },
            { name: 'Mexican Spanish Vibes', desc: 'Learn slang, culture, and everyday Mexican Spanish with locals.', lang: 'spanish', flag: '🇲🇽', type: 'voice', creator: 'Diego',
              msgs: [['Diego','¡Qué onda! ¿Cómo están?'],['Kim','¿Qué significa "neta"?'],['Diego','"Neta" means "really?" or "for real" 😄']] },
        ];

        for (const room of rooms) {
            const r = await runSql(
                'INSERT INTO rooms (name, description, language, flag, type, creator_id) VALUES ($1, $2, $3, $4, $5, $6)',
                [room.name, room.desc, room.lang, room.flag, room.type, userIds[room.creator]]
            );
            // Must run in loop
            for (let i = 0; i < room.msgs.length; i++) {
                const m = room.msgs[i];
                await runSql(
                    `INSERT INTO messages (room_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '${(room.msgs.length - i) * 5} minutes')`,
                    [r.lastInsertRowid, userIds[m[0]], m[1]]
                );
            }
        }

        console.log('  ✅ Seeded 20 users and 9 rooms');
    }

    // Clean up stale participants from previous runs
    await runSql('DELETE FROM room_participants');

    server.listen(PORT, () => {
        console.log('');
        console.log('  ════════════════════════════════════════');
        console.log(`  💬  LinguaConnect server running`);
        console.log(`  🌐  http://localhost:${PORT}`);
        console.log('  ════════════════════════════════════════');
        console.log('');
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
