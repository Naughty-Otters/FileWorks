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
  description = "Lambda memory. Paddle OCR needs ~4 GB+."
  default     = 4096
}

variable "lambda_timeout_s" {
  type        = number
  description = "Lambda timeout in seconds (max 900). Extract can be slow."
  default     = 900
}

variable "ephemeral_storage_mb" {
  type        = number
  description = "Lambda /tmp size for OCR models and uploads."
  default     = 4096
}

variable "cors_origins" {
  type        = list(string)
  description = "Browser origins allowed to call the API and PUT to S3 (localhost + Cloudflare Pages)."
  default     = ["http://localhost:3000", "http://127.0.0.1:3000"]
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

variable "google_client_id" {
  type        = string
  default     = "1063086817026-33rehu3tmsg08gll6dc9jue97000ib8f.apps.googleusercontent.com"
  description = "Google OAuth client ID (GIS). Public; also set on the API Lambda and Pages build."
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class. Private VPC; no public access."
}
