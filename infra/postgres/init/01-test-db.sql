-- Runs once, on first start of the postgres container.
-- A separate database for API integration tests, so tests never touch demo data.
CREATE DATABASE nidhisetu_test;
