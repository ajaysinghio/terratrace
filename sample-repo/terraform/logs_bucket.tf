# Planted missing-lifecycle-policy: this bucket has no lifecycle_rule, so
# every object written to it is kept (and billed) forever. TerraTrace should
# flag the `aws_s3_bucket` resource below.
resource "aws_s3_bucket" "logs" {
  bucket = "terratrace-sample-logs"
}
