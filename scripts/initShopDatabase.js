// scripts/initShopDatabase.js - Initializes the Shop module tables
// Run with: node scripts/initShopDatabase.js
require('dotenv').config();
const { testConnection } = require('../config/database');
const { initShopTables, seedDefaultCategories } = require('../config/shopDatabase');

const main = async () => {
    try {
        console.log('🛍️  Initializing Shop module database...\n');

        const connected = await testConnection();
        if (!connected) {
            console.error('❌ Database connection failed. Please check your configuration.');
            process.exit(1);
        }

        await initShopTables();
        await seedDefaultCategories();

        console.log('\n🎉 Shop module database initialization completed successfully!');
    } catch (error) {
        console.error('\n❌ Shop database initialization failed:', error.message);
        process.exit(1);
    } finally {
        process.exit(0);
    }
};

if (require.main === module) {
    main();
}

module.exports = { main };
