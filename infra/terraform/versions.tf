terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "fileworks"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "fileworks-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id
  region      = data.aws_region.current.id
  image_uri   = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
  cors_csv    = join(",", var.cors_origins)
  # Bucket alias: staging → stage so URIs match s3://fileworks-prod|stage|dev/...
  s3_alias            = var.environment == "staging" ? "stage" : var.environment
  uploads_bucket_name = var.uploads_bucket_name != "" ? var.uploads_bucket_name : "fileworks-${local.s3_alias}"
  database_url        = "postgresql+psycopg://${aws_db_instance.app.username}:${random_password.db.result}@${aws_db_instance.app.address}:5432/${aws_db_instance.app.db_name}"
}
