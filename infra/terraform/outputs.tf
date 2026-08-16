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
  value       = trimsuffix(aws_lambda_function_url.api_live.function_url, "/")
  description = "API Function URL on the live alias (provisioned-concurrency autoscaling)."
}

output "lambda_url_latest" {
  value       = trimsuffix(aws_lambda_function_url.api.function_url, "/")
  description = "Legacy Function URL on $LATEST. Kept so the Cloudflare Worker origin does not break mid-apply."
}

output "api_url" {
  value = trimsuffix(
    var.public_api_url != "" ? var.public_api_url : aws_lambda_function_url.api_live.function_url,
    "/",
  )
  description = "Public API origin used by the UI. Set public_api_url to a custom host; otherwise the live-alias Function URL."
}

output "api_log_group" {
  value       = aws_cloudwatch_log_group.api.name
  description = "CloudWatch log group for the API Lambda."
}

output "llm_log_group" {
  value       = aws_cloudwatch_log_group.llm.name
  description = "CloudWatch log group for the LLM worker Lambda."
}

output "history_bucket" {
  value       = aws_s3_bucket.uploads.bucket
  description = "Same as uploads_bucket. History lives under the history/ prefix."
}

output "uploads_bucket" {
  value       = aws_s3_bucket.uploads.bucket
  description = "s3://fileworks-<prod|stage|dev>/{upload/files|history|tfstate}/…"
}

output "uploads_prefix" {
  value = "upload/files"
}

output "lambda_in_vpc" {
  value       = true
  description = "API Lambda is in a private VPC (RDS + S3 gateway). LLM Lambda is outside the VPC."
}

output "api_alias" {
  value       = aws_lambda_alias.api_live.name
  description = "API Function URL and provisioned-concurrency autoscaling target this alias, not $LATEST."
}

output "lambda_reserved_concurrency" {
  value       = var.lambda_reserved_concurrency
  description = "-1 means unreserved (on-demand scale up to the account quota)."
}

output "lambda_provisioned_concurrency" {
  value = {
    min = var.lambda_provisioned_min
    max = var.lambda_provisioned_max
  }
  description = "API live-alias provisioned concurrency autoscaling. max=0 is disabled."
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
