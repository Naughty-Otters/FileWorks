resource "random_password" "db" {
  length           = 24
  special          = true
  override_special = "-_"
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "app" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "app" {
  identifier                   = "${local.name_prefix}-pg"
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = 20
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "fileworks"
  username                     = "fileworks"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.app.name
  vpc_security_group_ids       = [aws_security_group.rds.id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = var.environment == "prod" ? 7 : 1
  deletion_protection          = var.environment == "prod"
  skip_final_snapshot          = var.environment != "prod"
  final_snapshot_identifier    = var.environment == "prod" ? "${local.name_prefix}-pg-final" : null
  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
  apply_immediately            = var.environment != "prod"
}
