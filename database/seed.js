/**
 * Seed the database with initial rooms and demo users.
 * Run with: node database/seed.js
 */
const { initDb, queryOne, queryAll, runSql } = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
    const db = await initDb();

    // Check if already seeded
    const roomCount = await queryOne('SELECT COUNT(*) as count FROM rooms');
    if (roomCount && roomCount.count > 0) {
        console.log('Database already seeded. Skipping.');
        return;
    }

    console.log('Seeding database...');

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
        {
            name: 'English Casual Talk', desc: 'Relaxed conversation about anything — movies, travel, daily life.',
            lang: 'english', flag: '🇬🇧', type: 'both', creator: 'Maria',
            messages: [
                { user: 'Maria', text: 'Hey everyone! I just came back from London 🇬🇧' },
                { user: 'Kenji', text: 'Oh nice! How was the weather?' },
                { user: 'Maria', text: 'Rainy as expected 😂 but I loved it!' },
                { user: 'Fatima', text: 'I want to visit London someday. Any tips?' },
                { user: 'Kenji', text: 'Try the Borough Market, the food is amazing!' },
            ]
        },
        {
            name: 'Español para Todos', desc: 'Practice your Spanish with native speakers from Spain and Latin America.',
            lang: 'spanish', flag: '🇪🇸', type: 'voice', creator: 'Carlos',
            messages: [
                { user: 'Carlos', text: '¡Hola! ¿Cómo están todos?' },
                { user: 'Ana', text: 'Muy bien, gracias. ¿Y tú?' },
                { user: 'Carlos', text: 'Todo perfecto. ¿Alguien quiere practicar verbos?' },
                { user: 'Sophie', text: 'Sí, por favor. Los verbos irregulares me confunden.' },
            ]
        },
        {
            name: '日本語 Practice Room', desc: 'Beginner-friendly Japanese practice. Hiragana, Katakana & basic Kanji.',
            lang: 'japanese', flag: '🇯🇵', type: 'text', creator: 'Yuki',
            messages: [
                { user: 'Yuki', text: 'こんにちは！今日は何を勉強しますか？' },
                { user: 'Tom', text: 'I want to practice katakana today!' },
                { user: 'Yuki', text: 'いいですね！Let me help you.' },
                { user: 'Lisa', text: 'Can someone explain は vs が?' },
            ]
        },
        {
            name: 'Café Français', desc: 'Un café virtuel pour parler français. Tous niveaux bienvenus!',
            lang: 'french', flag: '🇫🇷', type: 'voice', creator: 'Pierre',
            messages: [
                { user: 'Pierre', text: 'Bonjour à tous! Comment ça va?' },
                { user: 'Emma', text: "Ça va bien! J'apprends le subjonctif..." },
                { user: 'Pierre', text: "Ah, le subjonctif! C'est un sujet intéressant." },
            ]
        },
        {
            name: '한국어 Chat Room', desc: 'Learn Korean through K-drama discussions and everyday conversation.',
            lang: 'korean', flag: '🇰🇷', type: 'both', creator: 'Minji',
            messages: [
                { user: 'Minji', text: '안녕하세요! 오늘 무슨 드라마 봤어요?' },
                { user: 'Alex', text: 'I watched Squid Game season 3! So good!' },
                { user: 'Minji', text: '오 정말? 저도 봤어요! No spoilers! 😂' },
            ]
        },
        {
            name: 'Deutsch Sprechen', desc: 'Improve your German speaking skills with friendly conversation partners.',
            lang: 'german', flag: '🇩🇪', type: 'voice', creator: 'Hans',
            messages: [
                { user: 'Hans', text: 'Hallo zusammen! Wie geht es euch?' },
                { user: 'Yuki', text: 'Mir geht es gut, danke!' },
                { user: 'Hans', text: 'Wollen wir über Reisen sprechen?' },
            ]
        },
        {
            name: 'IELTS Prep Group', desc: 'Focused practice for IELTS speaking tasks. Mock tests and feedback.',
            lang: 'english', flag: '🇺🇸', type: 'both', creator: 'Priya',
            messages: [
                { user: 'Priya', text: "Let's practice Part 2 — describe a place you visited." },
                { user: 'Wei', text: "I'll go first! I visited Kyoto last year..." },
                { user: 'Priya', text: 'Great start! Try to use more descriptive adjectives.' },
            ]
        },
        {
            name: 'Bate-papo Brasileiro', desc: 'Casual Brazilian Portuguese conversations. Come practice with us!',
            lang: 'portuguese', flag: '🇧🇷', type: 'text', creator: 'Lucas',
            messages: [
                { user: 'Lucas', text: 'E aí galera! Tudo bem?' },
                { user: 'Sarah', text: 'Oi Lucas! Estou praticando meu português.' },
                { user: 'Lucas', text: 'Seu português está muito bom!' },
            ]
        },
        {
            name: 'Mexican Spanish Vibes', desc: 'Learn slang, culture, and everyday Mexican Spanish with locals.',
            lang: 'spanish', flag: '🇲🇽', type: 'voice', creator: 'Diego',
            messages: [
                { user: 'Diego', text: '¡Qué onda! ¿Cómo están?' },
                { user: 'Kim', text: '¿Qué significa "neta"?' },
                { user: 'Diego', text: '"Neta" means "really?" or "for real" 😄' },
            ]
        },
    ];

    for (const room of rooms) {
        const result = await runSql(
            'INSERT INTO rooms (name, description, language, flag, type, creator_id) VALUES (?, ?, ?, ?, ?, ?)',
            [room.name, room.desc, room.lang, room.flag, room.type, userIds[room.creator]]
        );
        const roomId = result.lastInsertRowid;

        for (let i = 0; i < room.messages.length; i++) {
            const msg = room.messages[i];
            const offset = (room.messages.length - i) * 5;
            await runSql(
                `INSERT INTO messages (room_id, user_id, content, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '${offset} minutes')`,
                [roomId, userIds[msg.user], msg.text]
            );
        }
    }

    console.log(`✅ Seeded ${demoUsers.length} users and ${rooms.length} rooms`);
}

seed().catch(console.error);
