# Planted compute-optimizer-overprovisioned: db.t3.medium doesn't look
# oversized syntactically (no static rule flags it — there isn't even a
# Semgrep rule for RDS instance sizing), but sample-data/compute-optimizer-sample.json
# marks it "Overprovisioned" from real measured utilization. TerraTrace
# should flag this via the Compute Optimizer cross-reference, not a static
# pattern match.
resource "aws_db_instance" "orders" {
  engine            = "postgres"
  instance_class    = "db.t3.medium"
  allocated_storage = 100

  tags = {
    Name = "orders-db"
  }
}