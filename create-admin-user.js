// create-admin-user.js
const bcrypt = require('bcryptjs');
const { query, queryOne } = require('./config/database');
require('dotenv').config();

const createAdminUser = async () => {
    try {
        // Check if admin already exists
        const existingAdmin = await queryOne(
            'SELECT id FROM users WHERE username = ?',
            ['admin']
        );

        if (existingAdmin) {
            console.log('Admin user already exists, updating password...');
            
            // Update existing admin
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await query(
                'UPDATE users SET password = ? WHERE username = ?',
                [hashedPassword, 'admin']
            );
            
            console.log('✅ Admin password updated successfully!');
        } else {
            // Create new admin user
            console.log('Creating new admin user...');
            
            const hashedPassword = await bcrypt.hash('admin123', 12);
            
            await query(
                'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
                ['admin', 'admin@example.com', hashedPassword, 'admin']
            );
            
            console.log('✅ Admin user created successfully!');
        }
        
        console.log('Login credentials:');
        console.log('Username: admin');
        console.log('Password: admin123');
        
        // Verify the password works
        const testUser = await queryOne(
            'SELECT password FROM users WHERE username = ?',
            ['admin']
        );
        
        const isValid = await bcrypt.compare('admin123', testUser.password);
        console.log('Password verification test:', isValid ? '✅ PASS' : '❌ FAIL');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
        process.exit(1);
    }
};

createAdminUser();