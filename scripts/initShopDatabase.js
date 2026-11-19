// scripts/initShopDatabase.js - Creates/updates the Shop module tables.
// Run with: npm run init-shop-db   (same as `node scripts/migrate.js`)
require('dotenv').config();
const { testConnection } = require('../config/database');
const { runMigrations } = require('./migrate');

const main = async () => {
    console.log('🛍️  Initializing Shop module database...\n');
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Database connection failed. Please check your configuration.');
        process.exit(1);
    }
    try {
        await runMigrations();
        console.log('\n🎉 Shop module database is ready!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Shop database initialization failed:', error.message);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}

module.exports = { main };
