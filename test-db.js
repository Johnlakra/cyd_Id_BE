// test-db.js
const mysql = require('mysql2/promise');

async function test() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: 'John@123.', // Your actual password
            database: 'cyd_new'
        });
        console.log('✅ MySQL connection successful!');
        await connection.end();
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

test();