const { Pool } = require('pg');

let pool = null;

async function initDb() {
    if (pool) return pool;

    const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_URL;

    if (!connectionString) {
        console.warn('WARNING: No DATABASE_URL or SUPABASE_URL found in env! Using local postgres://postgres:postgres@localhost:5432/linguaconnect');
    }

    pool = new Pool({
        connectionString: connectionString || 'postgres://postgres:postgres@localhost:5432/linguaconnect',
        ssl: (process.env.NODE_ENV === 'production' || (connectionString && connectionString.includes('supabase.co'))) ? { rejectUnauthorized: false } : false
    });

    // Create schema
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id           SERIAL PRIMARY KEY,
            username     TEXT NOT NULL UNIQUE,
            email        TEXT NOT NULL UNIQUE,
            password     TEXT,
            google_id    TEXT UNIQUE,
            native_lang  TEXT DEFAULT 'english',
            learning_lang TEXT DEFAULT '',
            bio          TEXT DEFAULT '',
            avatar_url   TEXT DEFAULT '',
            avatar_color TEXT DEFAULT '#6366f1',
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            id               SERIAL PRIMARY KEY,
            name             TEXT NOT NULL,
            description      TEXT,
            language         TEXT NOT NULL,
            flag             TEXT DEFAULT '🌐',
            type             TEXT DEFAULT 'both',
            access           TEXT DEFAULT 'open',
            level            TEXT DEFAULT 'any',
            max_participants INTEGER DEFAULT 10,
            creator_id       INTEGER REFERENCES users(id),
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id         SERIAL PRIMARY KEY,
            room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            content    TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS room_participants (
            room_id   INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id   INTEGER NOT NULL REFERENCES users(id),
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (room_id, user_id)
        )
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_participants_room ON room_participants(room_id)');

    return pool;
}

function getDb() {
    if (!pool) throw new Error('Database not initialized. Call initDb() first.');
    return pool;
}

// Postgres uses $1, $2 instead of ?
function replacePlaceholders(sql) {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
}

async function queryAll(sql, params = []) {
    const res = await pool.query(replacePlaceholders(sql), params);
    return res.rows;
}

async function queryOne(sql, params = []) {
    const res = await pool.query(replacePlaceholders(sql), params);
    return res.rows.length > 0 ? res.rows[0] : null;
}

async function runSql(sql, params = []) {
    let parsedSql = replacePlaceholders(sql);
    let isInsert = parsedSql.trim().toUpperCase().startsWith('INSERT');
    
    if (isInsert && !parsedSql.toUpperCase().includes('RETURNING')) {
        parsedSql += ' RETURNING *';
    }

    const res = await pool.query(parsedSql, params);
    return {
        lastInsertRowid: (isInsert && res.rows.length > 0 && res.rows[0].id) ? res.rows[0].id : 0,
        changes: res.rowCount
    };
}

// Empty stub for backwards compatibility during migration
function saveDb() { }

module.exports = { initDb, getDb, saveDb, queryAll, queryOne, runSql };
