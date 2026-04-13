require('dotenv').config();
const { initDb, queryAll } = require('../database/db');

async function checkRooms() {
    await initDb();
    const rooms = await queryAll('SELECT id, name, language FROM rooms');
    console.log('Current Rooms:');
    console.log(JSON.stringify(rooms, null, 2));
    process.exit(0);
}

checkRooms().catch(err => {
    console.error(err);
    process.exit(1);
});
