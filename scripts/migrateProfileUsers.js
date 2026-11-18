// migrateProfileUsers.js - Fixed migration script with no duplicates
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, queryOne, testConnection } = require('./config/database');

// Configuration
const CONFIG = {
    DEFAULT_ROLE: 'profile_holder',
    BATCH_SIZE: 25,
    DRY_RUN: false,
    SALT_ROUNDS: 12,
    EMAIL_DOMAIN: 'cydidcard.com'
};

// Global tracking to prevent duplicates across entire session
const globalUsedUsernames = new Set();
const globalUsedEmails = new Set();

// Generate username: first 4 letters + day + month from DOB
const generateUsername = (name, dateOfBirth) => {
    if (!name || name.trim() === '') return null;
    
    // Clean name: remove spaces, special characters, keep only letters
    const cleanName = name.toLowerCase()
        .replace(/[^a-z]/g, '') // Remove everything except letters
        .substring(0, 4) // First 4 letters
        .padEnd(4, 'x'); // Pad with 'x' if name is less than 4 characters
    
    // Extract day and month from date of birth
    let dayMonth = '';
    if (dateOfBirth) {
        try {
            const date = new Date(dateOfBirth);
            if (!isNaN(date.getTime())) {
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                dayMonth = day + month;
            } else {
                // Invalid date, use current date
                const now = new Date();
                const day = now.getDate().toString().padStart(2, '0');
                const month = (now.getMonth() + 1).toString().padStart(2, '0');
                dayMonth = day + month;
            }
        } catch (error) {
            // Error parsing date, use current date
            const now = new Date();
            const day = now.getDate().toString().padStart(2, '0');
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            dayMonth = day + month;
        }
    } else {
        // No date of birth provided, use current date
        const now = new Date();
        const day = now.getDate().toString().padStart(2, '0');
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        dayMonth = day + month;
    }
    
    return `${cleanName}${dayMonth}`;
};

// Generate email from username
const generateEmail = (username) => `${username}@${CONFIG.EMAIL_DOMAIN}`;

// Get password from phone number
const getPasswordFromPhone = (phone) => {
    if (!phone || phone.trim() === '') return 'default123';
    
    // Clean phone number: remove all non-numeric characters
    const cleanPhone = phone.toString().replace(/[^0-9]/g, '');
    
    // If phone is too short, pad it
    if (cleanPhone.length < 6) {
        return cleanPhone.padEnd(8, '0');
    }
    
    return cleanPhone;
};

// Ensure username is unique with enhanced checking
const ensureUniqueUsername = async (baseUsername, profileId) => {
    let username = baseUsername;
    let counter = 1;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        // Check if username exists in database
        const existingInDb = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
        
        // Check if username is being used in current session
        const existingInSession = globalUsedUsernames.has(username);
        
        if (!existingInDb && !existingInSession) {
            // Username is unique, reserve it
            globalUsedUsernames.add(username);
            console.log(`  Reserved username: ${username} for profile ${profileId}`);
            return username;
        }
        
        // Generate next variant
        if (attempts === 1) {
            // First attempt with counter
            username = `${baseUsername}${counter}`;
        } else {
            // Add profile ID for even more uniqueness
            username = `${baseUsername}${counter}${profileId}`;
        }
        counter++;
    }
    
    // Fallback: use profile ID and timestamp
    const timestamp = Date.now().toString().slice(-6);
    username = `${baseUsername.substring(0, 3)}${profileId}${timestamp}`;
    globalUsedUsernames.add(username);
    console.log(`  Fallback username generated: ${username} for profile ${profileId}`);
    return username;
};

// Ensure email is unique with enhanced checking
const ensureUniqueEmail = async (baseEmail, profileId) => {
    let email = baseEmail;
    let counter = 1;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        // Check if email exists in database
        const existingInDb = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
        
        // Check if email is being used in current session
        const existingInSession = globalUsedEmails.has(email);
        
        if (!existingInDb && !existingInSession) {
            // Email is unique, reserve it
            globalUsedEmails.add(email);
            return email;
        }
        
        // Generate next variant
        const [localPart, domain] = baseEmail.split('@');
        email = `${localPart}${counter}@${domain}`;
        counter++;
    }
    
    // Fallback: use profile ID and timestamp
    const timestamp = Date.now().toString().slice(-6);
    const [localPart, domain] = baseEmail.split('@');
    email = `${localPart}${profileId}${timestamp}@${domain}`;
    globalUsedEmails.add(email);
    return email;
};

// Get profiles that need users created
const getProfilesWithoutUsers = async () => {
    try {
        const profiles = await query(`
            SELECT 
                p.id,
                p.name,
                p.phone,
                p.dob as date_of_birth,
                p.created_at,
                p.profile_user_id
            FROM profile p
            LEFT JOIN users u ON p.profile_user_id = u.id
            WHERE p.profile_user_id IS NULL 
               OR u.id IS NULL
            ORDER BY p.created_at ASC
        `);

        console.log(`Found ${profiles.length} profiles that need user accounts created`);
        return profiles;
    } catch (error) {
        console.error('Error fetching profiles without users:', error);
        throw error;
    }
};

// Create user account for a profile
const createUserForProfile = async (profile) => {
    try {
        // Generate username from name and DOB
        const baseUsername = generateUsername(profile.name, profile.date_of_birth);
        
        if (!baseUsername) {
            return {
                profile_id: profile.id,
                profile_name: profile.name,
                error: 'Could not generate username from name (name is empty or invalid)',
                action: 'failed'
            };
        }

        // Generate unique username and email
        const username = await ensureUniqueUsername(baseUsername, profile.id);
        const email = await ensureUniqueEmail(generateEmail(username), profile.id);
        const password = getPasswordFromPhone(profile.phone);

        if (CONFIG.DRY_RUN) {
            return {
                profile_id: profile.id,
                profile_name: profile.name,
                username,
                email,
                password,
                phone: profile.phone,
                date_of_birth: profile.date_of_birth,
                action: 'would_create'
            };
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, CONFIG.SALT_ROUNDS);

        // Create the user account (should not fail now due to our uniqueness checking)
        const userResult = await query(`
            INSERT INTO users (username, email, password, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, NOW(), NOW())
        `, [username, email, hashedPassword, CONFIG.DEFAULT_ROLE]);

        const userId = userResult.insertId;

        // Link the profile to the newly created user
        await query(`
            UPDATE profile 
            SET profile_user_id = ?, updated_at = NOW() 
            WHERE id = ?
        `, [userId, profile.id]);

        console.log(`  ✅ Created user ${username} for profile ${profile.id} (${profile.name})`);

        return {
            profile_id: profile.id,
            profile_name: profile.name,
            user_id: userId,
            username,
            email,
            password,
            phone: profile.phone,
            date_of_birth: profile.date_of_birth,
            action: 'created'
        };

    } catch (error) {
        console.error(`  ❌ Error creating user for profile ${profile.id} (${profile.name}):`, error.message);
        return {
            profile_id: profile.id,
            profile_name: profile.name,
            error: error.message,
            phone: profile.phone,
            action: 'failed'
        };
    }
};

// Generate comprehensive report of migration results
const generateReport = (results) => {
    const successful = results.filter(r => r.action === 'created' || r.action === 'would_create');
    const failed = results.filter(r => r.action === 'failed');

    console.log('\n📊 MIGRATION REPORT');
    console.log('='.repeat(80));
    console.log(`Total profiles processed: ${results.length}`);
    console.log(`Successfully created: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);
    console.log(`Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
    
    if (CONFIG.DRY_RUN) {
        console.log('\n⚠️  DRY RUN MODE - No actual changes made');
    }

    if (successful.length > 0) {
        console.log('\n✅ SUCCESSFULLY CREATED USERS:');
        successful.forEach((result, index) => {
            const status = CONFIG.DRY_RUN ? '[DRY RUN]' : '[CREATED]';
            console.log(`${status} ${index + 1}. ${result.profile_name}`);
            console.log(`   Username: ${result.username} | Password: ${result.password} | Phone: ${result.phone}`);
            console.log(`   Email: ${result.email} | Profile ID: ${result.profile_id}`);
        });
    }

    if (failed.length > 0) {
        console.log('\n❌ FAILED PROFILES:');
        failed.forEach((result, index) => {
            console.log(`[ERROR] ${index + 1}. ${result.profile_name} (ID: ${result.profile_id})`);
            console.log(`   Phone: ${result.phone || 'N/A'} | Error: ${result.error}`);
        });
    }

    if (!CONFIG.DRY_RUN && successful.length > 0) {
        console.log('\n📝 IMPORTANT NOTES:');
        console.log('• Username format: First 4 letters of name + day + month (with uniqueness numbers if needed)');
        console.log('• Password: Phone number from profile');
        console.log('• Email format: username@cydidcard.com');
        console.log('• All created users have "profile_holder" role');
        console.log('• Profile.profile_user_id field now points to the correct user ID');
        console.log('• Users can now log in with username and phone number as password');
    }
};

// Main migration execution
const main = async () => {
    try {
        console.log('🚀 Starting CYD Profile User Migration (No Duplicates Version)...');
        console.log('='.repeat(60));

        // Test database connection
        console.log('📡 Testing database connection...');
        const connected = await testConnection();
        if (!connected) {
            throw new Error('Database connection failed. Please check your database configuration.');
        }
        console.log('✅ Database connected successfully');

        // Find profiles that need users
        console.log('\n🔍 Finding profiles without users...');
        const profiles = await getProfilesWithoutUsers();
        
        if (profiles.length === 0) {
            console.log('✅ No profiles found without users. Migration not needed.');
            return;
        }

        console.log(`\n📋 Found ${profiles.length} profiles that need user accounts`);

        if (CONFIG.DRY_RUN) {
            console.log('\n⚠️  Running in DRY RUN mode - no actual changes will be made\n');
        } else {
            console.log('\n🔧 Processing profiles sequentially to prevent duplicates...\n');
        }

        // Process profiles one by one to prevent any duplicates
        const results = [];
        const totalProfiles = profiles.length;

        for (let i = 0; i < profiles.length; i++) {
            const profile = profiles[i];
            
            // Show progress
            console.log(`Processing ${i + 1}/${totalProfiles}: ${profile.name} (ID: ${profile.id})...`);
            
            try {
                const result = await createUserForProfile(profile);
                results.push(result);
                
                // Show batch progress
                if ((i + 1) % CONFIG.BATCH_SIZE === 0) {
                    console.log(`\n✅ Completed ${i + 1}/${totalProfiles} profiles\n`);
                }
                
                // Small delay to reduce database load
                await new Promise(resolve => setTimeout(resolve, 50));
                
            } catch (error) {
                console.error(`Error processing profile ${profile.id} (${profile.name}):`, error.message);
                results.push({
                    profile_id: profile.id,
                    profile_name: profile.name,
                    error: error.message,
                    action: 'failed'
                });
            }
        }

        // Generate comprehensive report
        generateReport(results);

        console.log('\n🎉 Migration completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
};

// Parse command line arguments
const parseArgs = () => {
    const args = process.argv.slice(2);
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dry-run':
                CONFIG.DRY_RUN = true;
                break;
            case '--batch-size':
                CONFIG.BATCH_SIZE = parseInt(args[++i]) || CONFIG.BATCH_SIZE;
                break;
            case '--email-domain':
                CONFIG.EMAIL_DOMAIN = args[++i] || CONFIG.EMAIL_DOMAIN;
                break;
            case '--help':
                console.log(`
CYD Profile User Migration Script - No Duplicates Version
========================================================

Creates user accounts for existing profiles with guaranteed uniqueness.

Features:
• Sequential processing (no parallel execution)
• Global duplicate prevention
• Enhanced uniqueness checking
• Profile ID fallback for extreme cases
• Proper profile.profile_user_id linking

Usage:
  node migrateProfileUsers.js [options]

Options:
  --dry-run              Preview without making changes
  --batch-size <n>       Progress reporting interval (default: 25)
  --email-domain <domain> Set email domain (default: cydidcard.com)
  --help                 Show this help

Examples:
  node migrateProfileUsers.js --dry-run
  node migrateProfileUsers.js --batch-size 50
                `);
                process.exit(0);
                break;
        }
    }
};

// Run the script if called directly
if (require.main === module) {
    parseArgs();
    
    console.log('CYD ID Card System - Profile User Migration (No Duplicates)');
    console.log(`Configuration: Role=${CONFIG.DEFAULT_ROLE}, BatchSize=${CONFIG.BATCH_SIZE}, Domain=${CONFIG.EMAIL_DOMAIN}`);
    
    main().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Migration script failed:', error);
        process.exit(1);
    });
}

module.exports = { 
    main, 
    CONFIG,
    generateUsername,
    getPasswordFromPhone 
};