resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name_prefix}/app"
  description             = "FileWorks LLM / translate API keys for ${var.environment}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

// Placeholders only: `fw seed-secrets` merges keys from backend/.env and
// backend/.env.<env>, and ignore_changes keeps Terraform from overwriting
// them afterwards. Never commit live keys here — this file is in version control.
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    LLM_PROVIDER          = "openai"
    LLM_MODEL             = "gpt-4o"
    LLM_API_KEY           = ""
    TRANSLATE_PROVIDER    = "deepseek"
    TRANSLATE_MODEL       = "deepseek-v4-flash"
    TRANSLATE_API_KEY     = ""
    DESIGN_AGENT_PROVIDER = "gemini"
    DESIGN_AGENT_MODEL    = "gemini-3.8-flash"
    DESIGN_AGENT_API_KEY  = ""
    GOOGLE_CLIENT_ID      = var.google_client_id
    JWT_SECRET            = random_password.jwt.result
    STRIPE_SECRET_KEY     = ""
    STRIPE_WEBHOOK_SECRET = ""
    STRIPE_PRICE_BASIC    = "0"
    STRIPE_PRICE_PRO      = "5"
    STRIPE_PRICE_PREMIUM  = "29"
    STRIPE_PRICE_API_BUILDER = "5"
    STRIPE_PRICE_API_SCALE   = "29"
    STRIPE_PRICE_API_BUSINESS = "99"
    PUBLIC_APP_URL        = var.environment == "prod" ? "https://fileworks.ai" : "https://staging.fileworks.ai"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
