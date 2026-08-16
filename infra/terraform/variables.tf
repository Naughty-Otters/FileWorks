variable "environment" {
  type        = string
  description = "Deployment environment name (dev, staging, prod)."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "image_tag" {
  type        = string
  description = "ECR image tag to run (usually the environment name, or a git sha)."
  default     = "dev"
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda memory (MB). Prefer 8192 for Paddle OCR once Support lifts the account 3008 MB cap."
  default     = 3008

  validation {
    condition     = var.lambda_memory_mb >= 128 && var.lambda_memory_mb <= 10240
    error_message = "lambda_memory_mb must be between 128 and 10240."
  }
}

variable "lambda_timeout_s" {
  type        = number
  description = "Lambda timeout in seconds (max 900). Extract can be slow."
  default     = 900
}

variable "lambda_reserved_concurrency" {
  type        = number
  description = <<-EOT
    Reserved concurrent executions for each Lambda (API and LLM).
    -1 = unreserved: share the account pool and scale on demand.
    A positive value is a hard ceiling — auto scaling cannot exceed it.
    New AWS accounts sometimes show a low burst or reserved cap of 10;
    the account Concurrent executions quota defaults to 1000.
  EOT
  default     = -1

  validation {
    condition     = var.lambda_reserved_concurrency >= -1
    error_message = "lambda_reserved_concurrency must be -1 (unreserved) or >= 0."
  }
}

variable "lambda_account_concurrency" {
  type        = number
  description = "Desired account quota for Lambda concurrent executions (L-B99A9384). AWS default is 1000; requests must be greater than the current quota."
  default     = 1000

  validation {
    condition     = var.lambda_account_concurrency >= 1000
    error_message = "lambda_account_concurrency must be at least 1000 (AWS default). Requesting less is rejected."
  }
}

variable "manage_lambda_account_concurrency" {
  type        = bool
  description = "If true, Terraform requests the Lambda concurrent-executions quota. Approval can block apply; leave false and request in Service Quotas / CLI unless you have auto-approval."
  default     = false
}

variable "lambda_provisioned_min" {
  type        = number
  description = "Minimum provisioned concurrency on the API live alias. 0 disables autoscaling. Target tracking needs min >= 1 to scale out from idle."
  default     = 0

  validation {
    condition     = var.lambda_provisioned_min >= 0
    error_message = "lambda_provisioned_min must be >= 0."
  }
}

variable "lambda_provisioned_max" {
  type        = number
  description = "Maximum provisioned concurrency for API autoscaling. 0 disables it. Counts against the account quota; leave headroom for the LLM function."
  default     = 0

  # Cross-checks live only here: two variables validating each other is a Terraform cycle.
  validation {
    condition = (
      var.lambda_provisioned_max >= 0
      && (
        var.lambda_provisioned_max == 0
        || (var.lambda_provisioned_min >= 1 && var.lambda_provisioned_max >= var.lambda_provisioned_min)
      )
    )
    error_message = "lambda_provisioned_max must be 0 (disabled), or min must be >= 1 and max >= min."
  }
}

variable "lambda_provisioned_target" {
  type        = number
  description = "Target LambdaProvisionedConcurrencyUtilization (0–1). Scale out when usage exceeds this."
  default     = 0.7

  validation {
    condition     = var.lambda_provisioned_target > 0 && var.lambda_provisioned_target <= 1
    error_message = "lambda_provisioned_target must be between 0 exclusive and 1 inclusive."
  }
}

variable "ephemeral_storage_mb" {
  type        = number
  description = "Lambda /tmp size for OCR models and uploads."
  default     = 4096
}

variable "cors_origins" {
  type        = list(string)
  description = "Exact browser origins allowed for the API and S3. Per-env: set in envs/<env>.tfvars."
  default     = ["http://localhost:3000", "http://127.0.0.1:3000"]
}

variable "cors_origin_regex" {
  type        = string
  description = "Optional regex for API CORS (FastAPI only; S3 has no regex). Use on staging for Cloudflare Pages preview hosts."
  default     = ""
}

variable "cors_wildcard_origins" {
  type        = list(string)
  description = "S3-only CORS origins that may contain one '*' (e.g. https://*.fileworks-staging.pages.dev). Keep empty in prod."
  default     = []

  validation {
    condition     = alltrue([for origin in var.cors_wildcard_origins : length(regexall("\\*", origin)) <= 1])
    error_message = "S3 allows at most one '*' per allowed origin."
  }
}

variable "max_upload_mb" {
  type    = number
  default = 50
}

variable "ocr_engine" {
  type    = string
  default = "ocr"
}

variable "uploads_bucket_name" {
  type        = string
  default     = ""
  description = "Override uploads bucket name. Default is fileworks-<prod|stage|dev>."
}

variable "public_api_url" {
  type        = string
  default     = ""
  description = "Optional public API origin that proxies to the Lambda Function URL (e.g. https://api.staging.fileworks.ai). Empty uses the Function URL."

  validation {
    condition = (
      var.public_api_url == ""
      || can(regex("^https://[A-Za-z0-9.-]+$", trimsuffix(var.public_api_url, "/")))
    )
    error_message = "public_api_url must be empty or an https origin like https://api.staging.fileworks.ai."
  }
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth client ID (GIS). Set per env in envs/<env>.tfvars. Public; also set on the API Lambda and Pages build."
}

variable "enable_nat_gateway" {
  type        = bool
  default     = true
  description = "Give the private-subnet Lambda public egress. Required for Google sign-in (fetches googleapis.com certs) and Stripe. Disabling it breaks /api/auth/google."
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class. Private VPC; no public access."
}
