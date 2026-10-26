import { testDatabaseUrl } from './test-env.js';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
process.env.QUEUE_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'fs';
process.env.STORAGE_FS_ROOT = '.data/test-objects';
process.env.BANK_ADAPTER = 'desk';
process.env.MOCK_BANK_API_LATENCY_MS = '0';
process.env.MOCK_BANK_API_FAILURE_RATE = '0';
