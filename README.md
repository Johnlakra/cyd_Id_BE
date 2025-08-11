# CYD ID Card Management System - Backend API

## 🚨 CRITICAL: Database Migration Required for Existing Data

**IMPORTANT**: there are existing profile data in our database, need to create user accounts for all existing profiles to enable the profile holder login system.

### Required Migration for Existing Profiles

For any profiles that exist in database before implementing the profile holder system, we need to:

1. **Create user accounts** for each existing profile
2. **Generate usernames** using format: `{first4letters}{day}{month}` (e.g., "Jonathan" born on 13/12/2000 → "john1312")
3. **Set passwords** to their phone numbers (properly hashed)
4. **Link profiles** to their respective user accounts via `profile_user_id`

This ensures existing profile holders can log in and access their profiles through the new self-service system.

---

## 🎯 System Overview

This CYD ID Card Management System provides a comprehensive multi-role authentication system with the following features:

### 🔐 **User Roles & Permissions**

#### **Admin Role**
- Full system access and management
- Create, view, edit, and delete all profiles
- Manage user accounts and system settings
- View deleted profiles and restore them
- Access to system statistics and reports

#### **Regular User Role** 
- Limited system access
- Can view profiles (restricted permissions)
- Basic system functionality

#### **Profile Holder Role** *(Auto-generated)*
- Self-service profile management
- Can only access their own profile data
- Limited editing permissions (photo, qualification, postal address only)
- Personal ID card generation and download
- Password change capability

### 🚀 **Key Features Implemented**

#### **Automatic User Account Generation**
- When admin creates a profile, system automatically generates login credentials
- Username format: `{first4letters}{day}{month}` (e.g., "john1312")
- Password: Profile holder's phone number
- Email: Auto-generated as `{username}@profile.local`

#### **Soft Delete System**
- Profiles are marked as deleted (status = 0) rather than permanently removed
- Data integrity preserved with ability to restore deleted profiles
- Smart profile restoration when creating profiles with same details

#### **Profile Holder Self-Service**
- Individual login system for each profile holder
- Restricted editing permissions for security
- Personal dashboard with ID card access
- Password management capabilities

---

## 🔐 API Endpoints

### Authentication Endpoints

#### **General Authentication**
```http
POST /auth/login
POST /auth/register  
POST /auth/logout
GET /auth/profile
PUT /auth/profile
PUT /auth/change-password
```

#### **Profile Holder Authentication**
```http
POST /profile-holder/login
GET /profile-holder/my-profile
PUT /profile-holder/update-profile
GET /profile-holder/my-id-card
PUT /profile-holder/change-password
```

### Profile Management Endpoints

#### **Admin & User Profile Management**
```http
POST /profiles                    # Create new profile (auto-generates user account)
GET /profiles                     # Get profiles with filtering/pagination
GET /profiles/filter-options      # Get filter options for dropdowns
GET /profiles/stats              # Get profile statistics (admin only)
GET /profiles/:id                # Get specific profile
PUT /profiles/:id                # Update profile (full access)
DELETE /profiles/:id             # Soft delete profile
```

#### **Profile Holder Limited Access**
```http
PUT /profiles/update-limited     # Update only photo, qualification, postal_address
```

## 📋 Request/Response Examples

### Profile Holder Login
```javascript
// Request
POST /profile-holder/login
{
    "username": "john1312",  // Auto-generated username
    "password": "+1234567890" // Their phone number
}

// Response
{
    "success": true,
    "message": "Login successful",
    "data": {
        "token": "jwt_token_here",
        "user": {
            "id": 5,
            "username": "john1312",
            "role": "profile_holder"
        },
        "profile": {
            "id": 1,
            "name": "John Doe",
            // ... profile data
        }
    }
}
```

### Admin Creates Profile (Auto-generates User Account)
```javascript
// Request
POST /profiles
{
    "name": "Jane Smith",
    "date_of_birth": "1995-08-15",
    "phone": "+1987654321",
    "father_name": "Robert Smith",
    // ... other profile fields
    "photo": "data:image/jpeg;base64,..."
}

// Response
{
    "success": true,
    "message": "Profile created successfully",
    "data": {
        "profile": { /* profile data */ },
        "credentials": {
            "username": "jane1508",
            "password": "+1987654321",
            "message": "These credentials have been created for the profile holder to login"
        }
    }
}
```

### Profile Holder Updates Limited Fields
```javascript
// Request
PUT /profile-holder/update-profile
{
    "photo": "data:image/jpeg;base64,..new_photo..",
    "qualification": "Master's Degree in Engineering", 
    "postal_address": "456 New Street, Updated City, State 12345"
}

// Response
{
    "success": true,
    "message": "Profile updated successfully",
    "data": {
        "profile": { /* updated profile data */ }
    }
}
```

## 📋 Setup Instructions

### 1. Environment Setup
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials and secrets
```

### 2. Database Setup
```bash
# Initialize database and create tables
node scripts/initDatabase.js

# Optional: Add sample data
node scripts/initDatabase.js --with-sample-data
```

### 3. Start Server
```bash
# Development
npm run dev

# Production
npm start
```

### 4. Migration (If you have existing data)
If you have existing profiles, run the migration process to create user accounts for profile holders before starting the server.

## 🔧 Configuration

Update your `.env` file with:
```env
# Database
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=cyd_new

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=24h

# Cloudinary (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Other
PORT=3000
NODE_ENV=development
MAX_FILE_SIZE=5242880
```

## 📝 Default Accounts

### Admin Account
- **Username**: `admin`
- **Email**: `admin@example.com`
- **Password**: `admin123`

### Profile Holder Accounts (Auto-generated)
- **Username Format**: `{first4letters}{day}{month}` (e.g., "john1312")
- **Email Format**: `{username}@profile.local`
- **Password**: Phone number from profile
- **Role**: `profile_holder`

**⚠️ Important**: Change the admin password after first login!

## 🛡️ Security Features

- **Password Hashing**: Uses bcryptjs with salt rounds of 12
- **JWT Authentication**: Secure token-based sessions
- **Role-based Access Control**: Admin, User, and Profile Holder permissions
- **Input Validation**: Comprehensive validation using express-validator
- **SQL Injection Protection**: Parameterized queries with mysql2
- **File Upload Security**: Cloudinary integration with size/type validation
- **CORS Support**: Configurable cross-origin resource sharing
- **Soft Delete System**: Data preservation with restore capability

## 🚀 Key Features

- **Multi-role Authentication**: Admin, User, and Profile Holder access levels
- **Automatic User Generation**: Creates login credentials when profiles are added
- **Profile Holder Self-Service**: Limited self-editing capabilities
- **Soft Delete System**: Data preservation with admin restore functionality
- **Advanced Filtering**: Search and filter profiles by multiple criteria
- **Pagination Support**: Efficient data loading for large datasets
- **Cloudinary Integration**: Secure image upload and management
- **Real-time Validation**: Input validation with detailed error messages
- **RESTful API Design**: Clean, consistent endpoint structure

## 🐛 Error Handling

All endpoints return consistent error responses:
```json
{
    "success": false,
    "message": "Error description here"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `500`: Internal Server Error

## 🔧 Customization

### Adding New Profile Fields
1. Add column to `profile` table in database
2. Update validation in `middleware/validation.js`
3. Update profile creation/update controllers
4. Add to frontend forms as needed

### Modifying Username Generation
The username generation logic in `profileController.js`:
```javascript
const generateUsername = (name, dateOfBirth) => {
    const namePrefix = name.trim()
        .replace(/\s+/g, '')
        .replace(/[^a-zA-Z]/g, '')
        .substring(0, 4)
        .toLowerCase();
    
    const dateParts = dateOfBirth.split('-');
    const day = dateParts[2];
    const month = dateParts[1];
    
    return namePrefix + day + month;
};
```

### Adding New User Roles
1. Update `role` ENUM in database schema
2. Add role validation in `middleware/validation.js`
3. Update authentication middleware for new role permissions

## 📂 File Upload System

- **Storage**: Cloudinary cloud storage
- **Supported Formats**: JPG, PNG, GIF, BMP, WebP
- **Maximum Size**: 5MB (configurable via MAX_FILE_SIZE env variable)
- **Validation**: MIME type and size validation
- **Format**: Base64 upload with automatic cloud conversion

## 🚀 Production Deployment

1. **Environment Variables**: Set all required env variables
2. **Database Migration**: Run migration for existing profiles if needed
3. **SSL/HTTPS**: Enable secure connections
4. **Process Management**: Use PM2 or similar for Node.js apps
5. **Database Backups**: Regular backups (important for soft delete system)
6. **Logging**: Configure proper logging for production
7. **Security Headers**: Add security middleware
8. **Rate Limiting**: Implement rate limiting for API endpoints

## 📞 Support & Documentation

This system implements a complete multi-role authentication system with profile holder self-service capabilities. The soft delete system ensures data integrity while providing flexible profile management.

### Key Implementation Features:
- **Auto-generated Credentials**: Seamless user account creation
- **Role-based Security**: Granular permission control
- **Soft Delete System**: Data preservation with restore capability
- **RESTful API**: Clean, consistent endpoint design
- **Input Validation**: Comprehensive validation and error handling
- **Cloud Storage**: Reliable image storage with Cloudinary

For additional customization or advanced features, refer to the individual controller and middleware files in the codebase.

## 📋 Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user', 'profile_holder') DEFAULT 'user',
    status TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Profile Table
```sql
CREATE TABLE profile (
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
);
```

## 🔄 API Response Format

All API responses follow a consistent format:

### Success Response
```json
{
    "success": true,
    "message": "Operation completed successfully",
    "data": {
        // Response data here
    }
}
```

### Error Response
```json
{
    "success": false,
    "message": "Error description",
    "errors": ["Detailed error messages"] // Optional validation errors
}
```

## 🧪 Testing

### Manual Testing Checklist

#### Admin Functions
- [ ] Admin login and token generation
- [ ] Create new profile (verify user account auto-generation)
- [ ] View all profiles with pagination and filtering
- [ ] Edit any profile
- [ ] Soft delete profiles
- [ ] View deleted profiles
- [ ] Restore deleted profiles

#### Profile Holder Functions
- [ ] Profile holder login with generated credentials
- [ ] View own profile only
- [ ] Update limited fields (photo, qualification, postal_address)
- [ ] Cannot access other profiles
- [ ] Change password
- [ ] Generate personal ID card

#### System Functions
- [ ] Soft delete and restore workflow
- [ ] Username generation logic
- [ ] File upload to Cloudinary
- [ ] Input validation and error handling
- [ ] JWT token expiration and refresh

### Sample Test Data

```javascript
// Admin Login Test
const adminAuth = {
    "username": "admin",
    "password": "admin123"
};

// Profile Creation Test
const testProfile = {
    "name": "Test User",
    "father_name": "Test Father",
    "mother_name": "Test Mother",
    "date_of_birth": "1990-12-15",
    "phone": "+1234567890",
    "designation": "Member",
    "level": "parish",
    "parish": "Test Parish",
    "deanery": "Test Deanery",
    "qualification": "Bachelor's Degree",
    "postal_address": "123 Test Street",
    "involvement": "Community Service"
};

// Expected Generated Username: "test1512"
// Expected Password: "+1234567890"
```

---

**Last Updated**: August 2025  
**Version**: 1.0.0  
**Node.js Version**: 18+  
**Database**: MySQL 8.0+ profile holders
4. **Admin interface enhancements** for soft delete management
5. **Testing and validation** of all new features