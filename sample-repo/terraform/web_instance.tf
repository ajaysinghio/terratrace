# Planted oversized-instance-type: this instance type is far larger than a
# typical web tier needs. TerraTrace should flag the `instance_type` line
# below.
resource "aws_instance" "web" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.small"

  tags = {
    Name = "web"
  }
}
