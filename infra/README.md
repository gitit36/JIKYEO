# Local infra

`docker compose up -d` brings up:

| Service     | Port | Notes                              |
|-------------|------|------------------------------------|
| Postgres 16 | 5432 | user/db/pw: `jikyeo/jikyeo/jikyeo` |
| Redis 7     | 6379 | queues + locks + cache             |
| LocalStack  | 4566 | S3 only (`evidence` bucket)         |

Create the evidence bucket on first run:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url=http://localhost:4566 s3 mb s3://evidence
```
