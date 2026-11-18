// Runs before every test file: point the app at the TEST database, never the real one.
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'hf';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'hfpass';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'cyd_test';
process.env.JWT_SECRET = 'test-secret';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
