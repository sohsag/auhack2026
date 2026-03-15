resource "aws_s3_bucket" "nerdata" {
  bucket        = local.bucket_name
  force_destroy = true # allows terraform destroy to empty the bucket
}

resource "aws_s3_bucket_public_access_block" "nerdata" {
  bucket                  = aws_s3_bucket.nerdata.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Folder structure created by empty objects (S3 is flat but this makes it readable)
resource "aws_s3_object" "data_prefix" {
  bucket  = aws_s3_bucket.nerdata.id
  key     = "nerdata/"
  content = ""
}

resource "aws_s3_object" "results_prefix" {
  bucket  = aws_s3_bucket.nerdata.id
  key     = "athena-results/"
  content = ""
}
