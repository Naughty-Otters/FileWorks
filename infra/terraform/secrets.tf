resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name_prefix}/app"
  description             = "FileWorks LLM / translate API keys for ${var.environment}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    LLM_PROVIDER       = ""
    LLM_MODEL          = ""
    LLM_API_KEY        = ""
    TRANSLATE_PROVIDER = ""
    TRANSLATE_MODEL    = ""
    TRANSLATE_API_KEY  = ""
    GOOGLE_CLIENT_ID   = var.google_client_id
    JWT_SECRET         = random_password.jwt.result
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
