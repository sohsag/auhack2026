output "s3_bucket" {
  description = "S3 bucket name for data and Athena results"
  value       = aws_s3_bucket.nerdata.bucket
}

output "s3_data_path" {
  description = "S3 path for Parquet data files (use as S3_PREFIX parent)"
  value       = "s3://${aws_s3_bucket.nerdata.bucket}/nerdata/"
}

output "s3_results_path" {
  description = "S3 path for Athena query results (use as OUTPUT_S3_PATH)"
  value       = "s3://${aws_s3_bucket.nerdata.bucket}/athena-results/"
}

output "glue_database" {
  description = "Glue database name (use as GLUE_DATABASE)"
  value       = aws_glue_catalog_database.nerdata.name
}

output "athena_workgroup" {
  description = "Athena workgroup name"
  value       = aws_athena_workgroup.nerdata.name
}

output "aws_region" {
  description = "AWS region"
  value       = var.aws_region
}

output "app_access_key_id" {
  description = "AWS Access Key ID for the Nerdata app user"
  value       = aws_iam_access_key.nerdata_app.id
}

output "app_secret_access_key" {
  description = "AWS Secret Access Key for the Nerdata app user"
  value       = aws_iam_access_key.nerdata_app.secret
  sensitive   = true
}
