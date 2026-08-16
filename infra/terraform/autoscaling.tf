# Provisioned-concurrency autoscaling for the API live alias.
#
# On-demand Lambda already scales out. This warms extra instances when the
# alias is busy (LambdaProvisionedConcurrencyUtilization). It cannot exceed
# the account concurrent-executions quota (1000 default) or
# reserved_concurrent_executions. The LLM function stays on $LATEST.

locals {
  api_provisioned_enabled = var.lambda_provisioned_max > 0
}

resource "aws_appautoscaling_target" "api_provisioned" {
  count              = local.api_provisioned_enabled ? 1 : 0
  max_capacity       = var.lambda_provisioned_max
  min_capacity       = var.lambda_provisioned_min
  resource_id        = "function:${aws_lambda_function.api.function_name}:${aws_lambda_alias.api_live.name}"
  scalable_dimension = "lambda:function:ProvisionedConcurrency"
  service_namespace  = "lambda"

  depends_on = [aws_lambda_alias.api_live]
}

resource "aws_appautoscaling_policy" "api_provisioned" {
  count              = local.api_provisioned_enabled ? 1 : 0
  name               = "${local.name_prefix}-api-provisioned"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api_provisioned[0].resource_id
  scalable_dimension = aws_appautoscaling_target.api_provisioned[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.api_provisioned[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "LambdaProvisionedConcurrencyUtilization"
    }
    target_value       = var.lambda_provisioned_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 0
  }
}
