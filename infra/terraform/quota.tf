# Concurrent executions (L-B99A9384) defaults to 1000 on this account.
# AWS rejects a request at or below the current quota (100 is a decrease).
# Enabling this resource waits for approval and can block `fw apply`, so it
# is off by default. Prefer `fw lambda-quota` if you actually need > 1000.

resource "aws_servicequotas_service_quota" "lambda_concurrent" {
  count        = var.manage_lambda_account_concurrency ? 1 : 0
  quota_code   = "L-B99A9384"
  service_code = "lambda"
  value        = var.lambda_account_concurrency
}
