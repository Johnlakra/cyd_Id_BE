// scripts/initDatabase.js - Database initialization script
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDatabase, query, testConnection } = require('../config/database');

const createDefaultAdmin = async () => {
    try {
        // Check if admin already exists
        const existingAdmin = await query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            ['admin', 'admin@example.com']
        );

        if (existingAdmin.length > 0) {
            console.log('ℹ️  Default admin user already exists');
            return;
        }

        // Create default admin user
        const hashedPassword = await bcrypt.hash('admin123', 12);
        
        await query(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            ['admin', 'admin@example.com', hashedPassword, 'admin']
        );

        console.log('✅ Default admin user created successfully');
        console.log('📧 Email: admin@example.com');
        console.log('🔑 Password: admin123');
        console.log('⚠️  Please change the default password after first login!');

    } catch (error) {
        console.error('❌ Failed to create default admin user:', error.message);
        throw error;
    }
};

const seedSampleData = async () => {
    try {
        // Check if sample data already exists
        const existingProfiles = await query('SELECT COUNT(*) as count FROM profile');
        
        if (existingProfiles[0].count > 0) {
            console.log('ℹ️  Sample data already exists');
            return;
        }

        // Get admin user ID
        const adminUser = await query(
            'SELECT id FROM users WHERE username = ?',
            ['admin']
        );

        if (adminUser.length === 0) {
            console.log('⚠️  No admin user found, skipping sample data creation');
            return;
        }

        const adminId = adminUser[0].id;

        // Sample profile data
        const sampleProfiles = [
            {
                name: 'John Doe',
                father: 'Robert Doe',
                mother: 'Mary Doe',
                dob: '1990-05-15',
                designation: 'Software Engineer',
                level: 'Senior',
                date_of_baptism: '2005-06-01',
                postal_address: '123 Main Street, Anytown, ST 12345',
                parish: 'St. Mary\'s Parish',
                deanery: 'Central Deanery',
                qualification: 'Bachelor of Computer Science',
                phone: '+1-555-0101',
                involvement: 'Youth Ministry Leader'
            },
            {
                name: 'Jane Smith',
                father: 'James Smith',
                mother: 'Patricia Smith',
                dob: '1985-08-22',
                designation: 'Teacher',
                level: 'Principal',
                date_of_baptism: '2000-04-15',
                postal_address: '456 Oak Avenue, Somewhere, ST 67890',
                parish: 'St. Joseph\'s Parish',
                deanery: 'Eastern Deanery',
                qualification: 'Master of Education',
                phone: '+1-555-0102',
                involvement: 'Choir Director'
            },
            {
                name: 'Michael Johnson',
                father: 'William Johnson',
                mother: 'Linda Johnson',
                dob: '1988-12-03',
                designation: 'Doctor',
                level: 'Specialist',
                date_of_baptism: '2003-03-25',
                postal_address: '789 Pine Road, Elsewhere, ST 13579',
                parish: 'Holy Trinity Parish',
                deanery: 'Western Deanery',
                qualification: 'Doctor of Medicine',
                phone: '+1-555-0103',
                involvement: 'Health Ministry Coordinator'
            }
        ];

        // Insert sample profiles
        for (const profile of sampleProfiles) {
            await query(`
                INSERT INTO profile (
                    name, father, mother, dob, designation, level, date_of_baptism,
                    postal_address, parish, deanery, qualification, phone, involvement, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                profile.name,
                profile.father,
                profile.mother,
                profile.dob,
                profile.designation,
                profile.level,
                profile.date_of_baptism,
                profile.postal_address,
                profile.parish,
                profile.deanery,
                profile.qualification,
                profile.phone,
                profile.involvement,
                adminId
            ]);
        }

        console.log(`✅ ${sampleProfiles.length} sample profiles created successfully`);

    } catch (error) {
        console.error('❌ Failed to create sample data:', error.message);
        throw error;
    }
};

const main = async () => {
    try {
        console.log('🔧 Initializing database...\n');

        // Test connection
        console.log('📡 Testing database connection...');
        const connected = await testConnection();
        
        if (!connected) {
            console.error('❌ Database connection failed. Please check your configuration.');
            process.exit(1);
        }

        // Initialize database structure
        console.log('📊 Creating database tables...');
        await initDatabase();

        // Create default admin user
        console.log('👤 Setting up default admin user...');
        await createDefaultAdmin();

        // Seed sample data (optional)
        if (process.argv.includes('--with-sample-data')) {
            console.log('📝 Creating sample data...');
            await seedSampleData();
        }

        console.log('\n🎉 Database initialization completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('1. Start the server: npm start');
        console.log('2. Login with admin credentials');
        console.log('3. Change the default admin password');
        console.log('4. Start creating profiles!\n');

    } catch (error) {
        console.error('\n❌ Database initialization failed:', error.message);
        process.exit(1);
    } finally {
        process.exit(0);
    }
};

// Run the initialization
if (require.main === module) {
    main();
}

module.exports = {
    createDefaultAdmin,
    seedSampleData
};