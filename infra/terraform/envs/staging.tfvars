environment          = "staging"
aws_region           = "us-east-1"
image_tag            = "staging"
lambda_memory_mb     = 4096
lambda_timeout_s     = 900
ephemeral_storage_mb = 5120
cors_origins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://fileworks-staging.pages.dev",
]
