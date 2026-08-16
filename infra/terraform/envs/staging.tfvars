environment          = "staging"
aws_region           = "us-east-1"
image_tag            = "staging"
public_api_url       = "https://api.staging.fileworks.ai"
google_client_id     = "1063086817026-33rehu3tmsg08gll6dc9jue97000ib8f.apps.googleusercontent.com"
lambda_memory_mb     = 3008
lambda_timeout_s     = 900
ephemeral_storage_mb = 10240
# Unreserved: Lambda scales on demand up to the account quota (1000 default).
# Do not set a reserved cap of 10.
lambda_reserved_concurrency = -1
# Warm extra API instances under load (1–20). Counts against the 1000
# account Concurrent executions quota; leave headroom for the LLM function.
lambda_provisioned_min = 1
lambda_provisioned_max = 20
# Staging: custom host + Pages. Preview hosts match via cors_origin_regex.
cors_origins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://fileworks-staging.pages.dev",
  "https://staging.fileworks.ai",
]
cors_origin_regex     = "^https://(([a-z0-9-]+\\.)?fileworks-staging\\.pages\\.dev|(www\\.)?staging\\.fileworks\\.ai)$"
cors_wildcard_origins = ["https://*.fileworks-staging.pages.dev"]
