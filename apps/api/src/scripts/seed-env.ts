/**
 * Environment for seeding. Imported first by the seed CLIs (ESM evaluates imports in order), so the
 * config sees these values: no OCR calls, no queue, no email and an instant, always-answering mock
 * bank API.
 */
import 'reflect-metadata';

process.env.QUEUE_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.OCR_URL = '';
process.env.MOCK_BANK_API_LATENCY_MS = '0';
process.env.MOCK_BANK_API_FAILURE_RATE = '0';
process.env.BANK_ADAPTER = 'auto';
