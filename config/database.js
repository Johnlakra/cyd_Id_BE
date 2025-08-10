// config/database.js - Database configuration and connection
const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cyd_new',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Execute query with error handling
const query = async (sql, params = []) => {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

// Get a single record
const queryOne = async (sql, params = []) => {
    const results = await query(sql, params);
    return results[0] || null;
};

// Database initialization SQL - removed since we're doing it programmatically now

// Initialize database tables
const initDatabase = async () => {
    try {
        console.log('Creating users table...');
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('admin', 'user', 'profile_holder') DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log('Creating profile table...');
        await query(`
            CREATE TABLE IF NOT EXISTS profile (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            father VARCHAR(100),
            mother VARCHAR(100),
            dob DATE,
            designation VARCHAR(100),
            level VARCHAR(50),
            date_of_baptism DATE,
            postal_address TEXT,
            parish VARCHAR(100),
            deanery VARCHAR(100),
            qualification TEXT,
            phone VARCHAR(20),
            involvement TEXT,
            photo_url VARCHAR(255),
            issue_date DATE,
            status TINYINT DEFAULT 1,
            profile_user_id INT,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (profile_user_id) REFERENCES users(id)
        )
    `);

        console.log('Creating indexes (with error handling)...');
        
        // Helper function to create index only if it doesn't exist
        const createIndexSafely = async (indexName, tableName, columns) => {
            try {
                // Check if index exists
                const existingIndex = await queryOne(`
                    SELECT COUNT(*) as count 
                    FROM information_schema.statistics 
                    WHERE table_schema = ? 
                    AND table_name = ? 
                    AND index_name = ?
                `, [process.env.DB_NAME, tableName, indexName]);

                if (existingIndex.count === 0) {
                    await query(`CREATE INDEX ${indexName} ON ${tableName} (${columns})`);
                    console.log(`✅ Created index: ${indexName}`);
                } else {
                    console.log(`ℹ️  Index already exists: ${indexName}`);
                }
            } catch (error) {
                console.log(`⚠️  Could not create index ${indexName}:`, error.message);
                // Don't throw error for indexes - they're not critical for basic functionality
            }
        };

        // Create indexes safely
        await createIndexSafely('idx_profile_created_by', 'profile', 'created_by');
        await createIndexSafely('idx_users_email', 'users', 'email');
        await createIndexSafely('idx_users_username', 'users', 'username');
        
        console.log('✅ Database tables initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        throw error;
    }
};

module.exports = {
    pool,
    query,
    queryOne,
    testConnection,
    initDatabase
};