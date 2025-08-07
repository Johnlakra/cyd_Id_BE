# Backend Setup Guide and API Documentation

## 📋 Setup Instructions

### 1. Database Setup
1. Create a MySQL database and run the SQL script from `database_setup.sql`
2. Update `config.php` with your database credentials
3. Make sure the `assets` folder is writable (chmod 755)

### 2. File Structure
```
your-project/
├── config.php          # Configuration file
├── auth.php            # Authentication system
├── login.php           # Login endpoint
├── register.php        # Registration endpoint
├── logout.php          # Logout endpoint
├── profile.php         # Profile management endpoint
└── assets/             # Photo uploads folder
```

### 3. Configuration
Update these values in `config.php`:
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` - Your database details
- `JWT_SECRET` - Change to a secure random string
- `UPLOAD_DIR` - Photo upload directory path

## 🔐 API Endpoints

### Authentication Endpoints

#### POST `/register.php`
Register a new user
```json
{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "password123",
    "role": "user"  // optional: "admin" or "user"
}
```
**Response:**
```json
{
    "result": "success",
    "message": "Registration successful",
    "data": {
        "id": 1,
        "username": "john_doe",
        "email": "john@example.com",
        "role": "user"
    }
}
```

#### POST `/login.php`
Login with username/email and password
```json
{
    "username": "john_doe",  // or email
    "password": "password123"
}
```
**Response:**
```json
{
    "result": "success",
    "message": "Login successful",
    "data": {
        "token": "abc123...",
        "user": {
            "id": 1,
            "username": "john_doe",
            "email": "john@example.com",
            "role": "user"
        },
        "expires_at": "2025-08-01 10:30:00"
    }
}
```

#### POST `/logout.php`
Logout (invalidate token)
**Headers:** `Authorization: Bearer your_token_here`
**Response:**
```json
{
    "result": "success",
    "message": "Logout successful"
}
```

### Profile Endpoints

#### POST `/profile.php` 
Create a new profile (requires authentication)
**Headers:** `Authorization: Bearer your_token_here`
```json
{
    "name": "John Doe",
    "father_name": "Father Name",
    "mother_name": "Mother Name",
    "date_of_birth": "1990-01-01",
    "designation": "Manager",
    "level": "Senior",
    "date_of_baptism": "2000-01-01",
    "postal_address": "123 Main St",
    "parish": "St. Mary's",
    "deanery": "Central",
    "qualification": "Bachelor's Degree",
    "phone": "+1234567890",
    "involvement": "Active member",
    "photo": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
}
```

#### GET `/profile.php`
Get all profiles (admin sees all, users see only their own)
**Headers:** `Authorization: Bearer your_token_here`
**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `id` (optional): Get specific profile by ID

**Response:**
```json
{
    "result": "success",
    "message": "Profiles retrieved successfully",
    "data": {
        "profiles": [
            {
                "id": 1,
                "name": "John Doe",
                "father": "Father Name",
                // ... other fields
                "photo_url": "20250731123456_abc123.jpg",
                "created_by": 1,
                "created_by_username": "admin",
                "created_at": "2025-07-31 10:30:00"
            }
        ],
        "pagination": {
            "current_page": 1,
            "per_page": 10,
            "total": 25,
            "total_pages": 3
        }
    }
}
```

## 🔧 Usage Examples

### JavaScript/Frontend Usage
```javascript
// Login
const loginResponse = await fetch('http://your-domain.com/login.php', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        username: 'john_doe',
        password: 'password123'
    })
});

const loginData = await loginResponse.json();
if (loginData.result === 'success') {
    const token = loginData.data.token;
    localStorage.setItem('auth_token', token);
}

// Create Profile
const profileResponse = await fetch('http://your-domain.com/profile.php', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
    },
    body: JSON.stringify({
        name: 'John Doe',
        father_name: 'Father Name',
        // ... other fields
        photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
    })
});

// Get Profiles
const getProfilesResponse = await fetch('http://your-domain.com/profile.php?page=1&limit=10', {
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
    }
});

const profilesData = await getProfilesResponse.json();
```

### PHP/cURL Usage
```php
// Login
$loginData = json_encode([
    'username' => 'john_doe',
    'password' => 'password123'
]);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'http://your-domain.com/login.php');
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, $loginData);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$data = json_decode($response, true);
curl_close($ch);

if ($data['result'] === 'success') {
    $token = $data['data']['token'];
}
```

## 🛡️ Security Features

- **Password Hashing**: Uses PHP's `password_hash()` with bcrypt
- **Token-based Authentication**: Secure session tokens
- **Session Management**: Automatic cleanup of expired sessions
- **Input Validation**: Validates all user inputs
- **SQL Injection Protection**: Uses prepared statements
- **File Upload Security**: Validates file types and sizes
- **CORS Support**: Configurable cross-origin resource sharing

## 🚀 Features

- **User Registration & Login**: Complete authentication system
- **Role-based Access Control**: Admin and user roles
- **Profile Management**: Create and view profiles with photo uploads
- **Pagination**: Efficient data loading with pagination
- **File Uploads**: Base64 image upload with validation
- **Session Management**: Secure token-based sessions
- **Error Handling**: Comprehensive error messages
- **CORS Support**: Ready for frontend integration

## 📝 Default Admin Account

A default admin account is created during database setup:
- **Username**: `admin`
- **Email**: `admin@example.com`
- **Password**: `admin123`

**⚠️ Important**: Change this password immediately after setup!

## 🐛 Error Handling

All endpoints return consistent error responses:
```json
{
    "result": "failure",
    "message": "Error description here"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `405`: Method Not Allowed
- `500`: Internal Server Error

## 📁 File Upload Notes

- **Supported formats**: JPG, PNG, GIF, BMP, WebP
- **Maximum size**: 5MB (configurable in config.php)
- **Storage**: Files stored in `/assets/` directory
- **Naming**: Timestamp + unique ID to prevent conflicts
- **Security**: File type validation based on MIME type

## 🔧 Customization

### Adding New Fields to Profile
1. Add column to `profile` table in database
2. Update the `createProfile()` method in `profile.php`
3. Add validation as needed

### Changing Session Duration
Update `SESSION_DURATION` in `config.php` (value in seconds)

### Adding New User Roles
1. Modify the `role` ENUM in the `users` table
2. Update validation in `register.php`
3. Add role-based logic where needed

## 🚀 Production Deployment

1. **Change default secrets** in `config.php`
2. **Enable HTTPS** for secure token transmission
3. **Set proper file permissions** (644 for PHP files, 755 for directories)
4. **Configure web server** (Apache/Nginx) properly
5. **Enable error logging** but disable error display
6. **Set up database backups**
7. **Use environment variables** for sensitive configuration

## 📞 Support

This is a simple, professional backend designed for beginners. The code is well-commented and follows PHP best practices. Each endpoint handles errors gracefully and provides clear responses for frontend integration.