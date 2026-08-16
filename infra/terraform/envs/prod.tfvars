environment                 = "prod"
aws_region                  = "us-east-1"
image_tag                   = "prod"
public_api_url              = "https://api.fileworks.ai"
lambda_memory_mb            = 3008
lambda_timeout_s            = 900
ephemeral_storage_mb        = 10240
lambda_reserved_concurrency = -1
lambda_provisioned_min      = 1
lambda_provisioned_max      = 20
# Production CORS: stable Pages origin (and custom domain when you have one).
# Do not reuse staging origins or preview regex here.
cors_origins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://fileworks-prod.pages.dev",
  "https://fileworks.ai"
]
cors_origin_regex     = ""
cors_wildcard_origins = []
