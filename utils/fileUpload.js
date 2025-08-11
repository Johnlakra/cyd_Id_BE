// utils/fileUpload.js - File upload utilities
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('./cloudinaryConfig');

// Ensure upload directory exists
const ensureUploadDir = async () => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    try {
        await fs.access(uploadDir);
    } catch (error) {
        // Directory doesn't exist, create it
        await fs.mkdir(uploadDir, { recursive: true });
        console.log(`📁 Created upload directory: ${uploadDir}`);
    }
    
    return uploadDir;
};

// Get file extension from base64 string
const getFileExtensionFromBase64 = (base64String) => {
    const match = base64String.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
    
    if (!match) {
        return null;
    }
    
    const mimeType = match[1].toLowerCase();
    const extensions = {
        'jpeg': 'jpg',
        'jpg': 'jpg',
        'png': 'png',
        'gif': 'gif',
        'bmp': 'bmp',
        'webp': 'webp'
    };
    
    return extensions[mimeType] || null;
};

// Save base64 image to file
const saveBase64Image = async (base64String) => {
    console.log(base64String, "base64String")
    try {
        const result = await cloudinary.uploader.upload(base64String, {
            folder: 'test_photos',
            resource_type: 'auto'
        });
        
        return result.secure_url; // Return the Cloudinary URL
    } catch (error) {
        throw new Error(`Cloudinary upload failed: ${error.message}`);
    }
};

// const saveBase64Image = async (base64String) => {
//     try {
//         // Ensure upload directory exists
//         const uploadDir = await ensureUploadDir();
        
//         // Get file extension
//         const extension = getFileExtensionFromBase64(base64String);
//         if (!extension) {
//             throw new Error('Unsupported image format. Supported formats: JPEG, PNG, GIF, BMP, WebP');
//         }
        
//         // Extract base64 data
//         const base64Data = base64String.split(',')[1];
//         if (!base64Data) {
//             throw new Error('Invalid base64 format');
//         }
        
//         // Convert base64 to buffer
//         const imageBuffer = Buffer.from(base64Data, 'base64');
        
//         // Check file size
//         const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 5242880; // 5MB default
//         if (imageBuffer.length > maxSize) {
//             throw new Error(`File size too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB`);
//         }
        
//         // Generate unique filename
//         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//         const uniqueId = uuidv4().substring(0, 8);
//         const filename = `${timestamp}-${uniqueId}.${extension}`;
//         const filepath = path.join(uploadDir, filename);
        
//         // Save file
//         await fs.writeFile(filepath, imageBuffer);
        
//         console.log(`📸 Image saved: ${filename}`);
//         return filename;
        
//     } catch (error) {
//         console.error('File upload error:', error);
//         throw error;
//     }
// };

// Delete file if it exists
const deleteFile = async (imageUrl) => {
    try {
        if (imageUrl && imageUrl.includes('cloudinary')) {
            const publicId = imageUrl.split('/').pop().split('.')[0];
            await cloudinary.uploader.destroy(`profile_photos/${publicId}`);
        }
    } catch (error) {
        console.log('Failed to delete from Cloudinary:', error.message);
    }
};

// const deleteFile = async (filename) => {
//     if (!filename) return;
    
//     try {
//         const uploadDir = process.env.UPLOAD_DIR || './uploads';
//         const filepath = path.join(uploadDir, filename);
        
//         await fs.access(filepath);
//         await fs.unlink(filepath);
        
//         console.log(`🗑️ File deleted: ${filename}`);
//     } catch (error) {
//         // File doesn't exist or couldn't be deleted - not critical
//         console.log(`⚠️ Could not delete file: ${filename}`);
//     }
// };

// Get file info
const getFileInfo = async (filename) => {
    if (!filename) return null;
    
    try {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const filepath = path.join(uploadDir, filename);
        
        const stats = await fs.stat(filepath);
        
        return {
            filename,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            url: `/uploads/${filename}` // Relative URL for serving
        };
    } catch (error) {
        return null;
    }
};

// Validate base64 image
const validateBase64Image = (base64String) => {
    if (!base64String) return { valid: false, error: 'No image provided' };

    // If it's a URL, consider it valid
    if (base64String.startsWith('http://') || base64String.startsWith('https://')) {
        return { valid: true };
    }
    
    // Check format
    if (!base64String.startsWith('data:image/')) {
        return { valid: false, error: 'Invalid image format' };
    }
    
    // Check if it has base64 data
    if (!base64String.includes('base64,')) {
        return { valid: false, error: 'Invalid base64 format' };
    }
    
    // Check extension
    const extension = getFileExtensionFromBase64(base64String);
    if (!extension) {
        return { valid: false, error: 'Unsupported image type' };
    }
    
    // Check base64 data
    const base64Data = base64String.split(',')[1];
    if (!base64Data) {
        return { valid: false, error: 'No image data found' };
    }
    
    // Check size
    const estimatedSize = (base64Data.length * 3) / 4; // Rough estimate
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 5242880;
    
    if (estimatedSize > maxSize) {
        return { 
            valid: false, 
            error: `Image too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB` 
        };
    }
    
    return { valid: true };
};

module.exports = {
    saveBase64Image,
    deleteFile,
    getFileInfo,
    validateBase64Image,
    ensureUploadDir
};