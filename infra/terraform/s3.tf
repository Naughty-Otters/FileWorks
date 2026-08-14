resource "aws_s3_bucket" "history" {
  bucket        = "fileworks-${local.s3_alias}-history"
  force_destroy = var.environment != "prod"
}

resource "aws_s3_bucket_versioning" "history" {
  bucket = aws_s3_bucket.history.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "history" {
  bucket = aws_s3_bucket.history.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "history" {
  bucket                  = aws_s3_bucket.history.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "history" {
  bucket = aws_s3_bucket.history.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_origins
    expose_headers  = ["ETag", "Content-Type"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "history" {
  bucket = aws_s3_bucket.history.id

  rule {
    id     = "expire-inbox"
    status = "Enabled"
    filter {
      prefix = "history/inbox/"
    }
    expiration {
      days = 2
    }
  }

  rule {
    id     = "expire-llm-out"
    status = "Enabled"
    filter {
      prefix = "llm-out/"
    }
    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-cancel-tokens"
    status = "Enabled"
    filter {
      prefix = "cancel/"
    }
    expiration {
      days = 1
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browser PUTs: s3://fileworks-<prod|stage|dev>/upload/files/<user_id>/<file>
resource "aws_s3_bucket" "uploads" {
  bucket        = local.uploads_bucket_name
  force_destroy = var.environment != "prod"
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_origins
    expose_headers  = ["ETag", "Content-Type"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {
      prefix = "upload/files/"
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
