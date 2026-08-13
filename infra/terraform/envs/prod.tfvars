environment          = "prod"
aws_region           = "us-east-1"
image_tag            = "prod"
lambda_memory_mb     = 8192
lambda_timeout_s     = 900
ephemeral_storage_mb = 10240
cors_origins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://fileworks-prod.pages.dev",
]
