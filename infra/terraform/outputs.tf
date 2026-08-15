output "account_id" {
  value = local.account_id
}

output "region" {
  value = local.region
}

output "environment" {
  value = var.environment
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}

output "llm_function_name" {
  value = aws_lambda_function.llm.function_name
}

output "lambda_url" {
  value       = trimsuffix(aws_lambda_function_url.api.function_url, "/")
  description = "Raw Lambda Function URL (no 29s API Gateway limit)."
}

output "api_url" {
  value = trimsuffix(
    var.public_api_url != "" ? var.public_api_url : aws_lambda_function_url.api.function_url,
    "/",
  )
  description = "Public API origin used by the UI. Set public_api_url to a custom host; otherwise the Function URL."
}

output "history_bucket" {
  value = aws_s3_bucket.history.bucket
}

output "uploads_bucket" {
  value       = aws_s3_bucket.uploads.bucket
  description = "s3://fileworks-<prod|stage|dev>/upload/files/<user_id>/<file>"
}

output "uploads_prefix" {
  value = "upload/files"
}

output "lambda_in_vpc" {
  value       = true
  description = "API Lambda is in a private VPC (RDS + S3 gateway). LLM Lambda is outside the VPC."
}

output "db_address" {
  value       = aws_db_instance.app.address
  description = "Private RDS hostname (reachable only from the API Lambda)."
}

output "secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "google_client_id" {
  value       = var.google_client_id
  description = "Public GIS client ID baked into Pages and the API Lambda."
}
