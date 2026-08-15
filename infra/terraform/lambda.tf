resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = var.environment == "prod" ? 30 : 14
}

resource "aws_cloudwatch_log_group" "llm" {
  name              = "/aws/lambda/${local.name_prefix}-llm"
  retention_in_days = var.environment == "prod" ? 30 : 14
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = local.image_uri
  architectures = ["x86_64"]
  memory_size   = var.lambda_memory_mb
  timeout       = var.lambda_timeout_s
  description   = "FileWorks conversion API (${var.environment})"

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  environment {
    variables = {
      STORAGE_BACKEND      = "s3"
      S3_BUCKET            = aws_s3_bucket.history.bucket
      S3_PREFIX            = "history"
      S3_REGION            = local.region
      S3_UPLOAD_BUCKET     = aws_s3_bucket.uploads.bucket
      S3_UPLOAD_PREFIX     = "upload/files"
      FILEWORKS_SECRET_ARN = aws_secretsmanager_secret.app.arn
      CORS_ORIGINS         = local.cors_csv
      CORS_ORIGIN_REGEX    = var.cors_origin_regex
      UPLOAD_DIR           = "/tmp/uploads"
      HOME                 = "/tmp"
      PADDLE_DEVICE        = "cpu"
      OCR_ENGINE           = var.ocr_engine
      MAX_UPLOAD_MB        = tostring(var.max_upload_mb)
      DATABASE_URL         = local.database_url
      JWT_SECRET           = random_password.jwt.result
      GOOGLE_CLIENT_ID     = var.google_client_id
      LLM_LAMBDA_FUNCTION  = aws_lambda_function.llm.function_name
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  depends_on = [
    aws_iam_role_policy.lambda_app,
    aws_iam_role_policy_attachment.lambda_logs,
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_cloudwatch_log_group.api,
    aws_vpc_endpoint.s3,
    aws_vpc_endpoint.interface,
  ]
}

# No `cors` block on purpose: FastAPI's CORSMiddleware already answers with
# Access-Control-Allow-Origin (from CORS_ORIGINS). Setting it here too makes the
# Function URL append a second value, which browsers reject.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
}

# Same image, no VPC — public HTTPS to LLM vendors. Invoked by the API Lambda
# through the Lambda interface VPC endpoint (not a Function URL, which needs NAT).
resource "aws_lambda_function" "llm" {
  function_name = "${local.name_prefix}-llm"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = local.image_uri
  architectures = ["x86_64"]
  memory_size   = var.lambda_memory_mb
  timeout       = var.lambda_timeout_s
  description   = "FileWorks vision LLM + translation (${var.environment})"

  image_config {
    command = ["python", "-m", "awslambdaric", "app.lambda_worker.handler"]
  }

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  environment {
    variables = {
      STORAGE_BACKEND      = "s3"
      S3_BUCKET            = aws_s3_bucket.history.bucket
      S3_PREFIX            = "history"
      S3_REGION            = local.region
      S3_UPLOAD_BUCKET     = aws_s3_bucket.uploads.bucket
      S3_UPLOAD_PREFIX     = "upload/files"
      FILEWORKS_SECRET_ARN = aws_secretsmanager_secret.app.arn
      UPLOAD_DIR           = "/tmp/uploads"
      HOME                 = "/tmp"
      PADDLE_DEVICE        = "cpu"
      OCR_ENGINE           = var.ocr_engine
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.llm.name
  }

  depends_on = [
    aws_iam_role_policy.lambda_app,
    aws_iam_role_policy_attachment.lambda_logs,
    aws_cloudwatch_log_group.llm,
  ]
}
