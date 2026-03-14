variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Project name — used as a prefix for all resource names"
  type        = string
  default     = "nerdata"
}
