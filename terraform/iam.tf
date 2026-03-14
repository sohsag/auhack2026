# IAM user for the Nerdata app (server + ingest script)
resource "aws_iam_user" "nerdata_app" {
  name = "${var.project}-app"
}

resource "aws_iam_access_key" "nerdata_app" {
  user = aws_iam_user.nerdata_app.name
}

resource "aws_iam_user_policy" "nerdata_app" {
  name = "${var.project}-policy"
  user = aws_iam_user.nerdata_app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3: full access to the nerdata bucket only
      {
        Effect = "Allow"
        Action = ["s3:*"]
        Resource = [
          aws_s3_bucket.nerdata.arn,
          "${aws_s3_bucket.nerdata.arn}/*"
        ]
      },
      # Glue: create/update/read catalog (for ingest script)
      {
        Effect = "Allow"
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:CreateDatabase",
          "glue:GetTable",
          "glue:GetTables",
          "glue:CreateTable",
          "glue:UpdateTable",
          "glue:DeleteTable",
          "glue:GetPartitions",
        ]
        Resource = ["*"]
      },
      # Athena: run queries and read results
      {
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:ListQueryExecutions",
          "athena:GetWorkGroup",
        ]
        Resource = ["*"]
      }
    ]
  })
}
