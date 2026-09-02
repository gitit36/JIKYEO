// Silence noisy Nest logs during tests.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://jikyeo:jikyeo@localhost:5432/jikyeo?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-only';
process.env.S3_ENDPOINT = 'http://localhost:4566';
process.env.S3_REGION = 'ap-northeast-2';
process.env.S3_BUCKET_EVIDENCE = 'evidence';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
