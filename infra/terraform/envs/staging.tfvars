environment          = "staging"
aws_region           = "us-east-1"
image_tag            = "staging"
public_api_url       = "https://api.staging.fileworks.ai"
lambda_memory_mb     = 3008
lambda_timeout_s     = 900
ephemeral_storage_mb = 10240
# Staging: custom host + Pages. Preview hosts match via cors_origin_regex.
cors_origins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://fileworks-staging.pages.dev",
  "https://staging.fileworks.ai",
]
cors_origin_regex     = "^https://(([a-z0-9-]+\\.)?fileworks-staging\\.pages\\.dev|(www\\.)?staging\\.fileworks\\.ai)$"
cors_wildcard_origins = ["https://*.fileworks-staging.pages.dev"]
