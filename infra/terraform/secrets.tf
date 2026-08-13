resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name_prefix}/app"
  description             = "FileWorks LLM / translate API keys for ${var.environment}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    LLM_PROVIDER       = "openai"
    LLM_MODEL          = "gpt-4o"
    LLM_API_KEY        = "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"
    TRANSLATE_PROVIDER = "deepseek"
    TRANSLATE_MODEL    = "deepseek-flash"
    TRANSLATE_API_KEY  = "sk-d2ebe41365e740768d6fad969c4e5b1c"
    GOOGLE_CLIENT_ID   = var.google_client_id
    JWT_SECRET         = random_password.jwt.result
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
