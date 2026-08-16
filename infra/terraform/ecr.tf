resource "aws_ecr_repository" "api" {
  name                 = "fileworks-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

# Lambda pulls the container image with the *service* principal, not the
# function role. Without this repository policy CreateFunction fails with
# "Lambda does not have permission to access the ECR image" — even in the
# same account, and even when the caller IAM user can push/pull. Staging
# got this statement from AWS after the first successful create; manage it
# in Terraform so a fresh account does not depend on that side effect.
data "aws_iam_policy_document" "ecr_lambda_pull" {
  statement {
    sid = "LambdaECRImageRetrievalPolicy"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    condition {
      test     = "StringLike"
      variable = "aws:sourceArn"
      values   = ["arn:aws:lambda:${local.region}:${local.account_id}:function:*"]
    }
  }
}

resource "aws_ecr_repository_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = data.aws_iam_policy_document.ecr_lambda_pull.json
}
