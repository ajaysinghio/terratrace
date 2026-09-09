# Planted missing-lifecycle-policy: this bucket has no lifecycle_rule, so
# every object written to it is kept (and billed) forever. TerraTrace should
# flag the `aws_s3_bucket` resource below.
resource "aws_s3_bucket" "logs" {
  bucket = "terratrace-sample-logs"

  lifecycle_rule {
    id      = "expire-old-logs"
    enabled = true

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 90
    }
  }
}
