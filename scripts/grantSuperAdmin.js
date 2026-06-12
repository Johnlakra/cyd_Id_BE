// scripts/grantSuperAdmin.js - Promote an existing user to platform super_admin.
// platform_role sits above the regular role column (additive, migration 102).
//
// Usage: node scripts/grantSuperAdmin.js <username>
require('dotenv').config();
const { query, queryOne, testConnection } = require('../config/database');

const main = async () => {
    const username = process.argv[2];
    if (!username) {
        throw new Error('Usage: node scripts/grantSuperAdmin.js <username>');
    }

    const connected = await testConnection();
    if (!connected) {
        throw new Error('Database connection failed.');
    }

    const user = await queryOne(
        'SELECT id, username, platform_role FROM users WHERE username = ? AND status = 1',
        [username]
    );
    if (!user) {
        throw new Error(`No active user found with username '${username}'.`);
    }
    if (user.platform_role === 'super_admin') {
        console.log(`ℹ️  '${username}' is already a super_admin.`);
        return;
    }

    await query('UPDATE users SET platform_role = \'super_admin\' WHERE id = ?', [user.id]);
    console.log(`✅ '${username}' (id ${user.id}) is now a platform super_admin.`);
};

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌', err.message);
            process.exit(1);
        });
}

module.exports = { main };
