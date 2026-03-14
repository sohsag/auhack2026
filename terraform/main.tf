terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  # Credentials come from environment variables:
  #   AWS_ACCESS_KEY_ID
  #   AWS_SECRET_ACCESS_KEY
}

# Random suffix so bucket names are globally unique
resource "random_id" "suffix" {
  byte_length = 4
}

locals {
  bucket_name = "${var.project}-${random_id.suffix.hex}"
}
