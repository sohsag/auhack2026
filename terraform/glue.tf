resource "aws_glue_catalog_database" "nerdata" {
  name        = var.project
  description = "Nerdata energy grid dataset — tables registered by ingest_athena.py"
}
