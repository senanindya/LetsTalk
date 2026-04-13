require('dotenv').config();
const { initDb, runSql } = require('../database/db');

async function removeArabicRooms() {
    await initDb();
    
    // Delete messages first due to foreign key constraints if they exist
    // But our message table might not have cascading deletes? Let's check.
    // Actually, usually it's better to delete the room and let it cascade if configured,
    // or delete messages first.
    
    console.log('Removing rooms with IDs 2 and 3...');
    
    // Deleting messages first for safety
    await runSql('DELETE FROM messages WHERE room_id IN (2, 3)');
    
    // Delete rooms
    const result = await runSql('DELETE FROM rooms WHERE id IN (2, 3)');
    
    console.log(`✅ Removed Arabic rooms. Rows affected: ${result.rowCount || result.changes || 'unknown'}`);
    process.exit(0);
}

removeArabicRooms().catch(err => {
    console.error(err);
    process.exit(1);
});
