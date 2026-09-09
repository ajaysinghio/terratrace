# Planted no-autoscaling-floor: min_size equals max_size, so this group runs
# 6 instances around the clock regardless of load. TerraTrace should flag
# the `aws_autoscaling_group` resource below.
resource "aws_autoscaling_group" "app" {
  name                = "app-asg"
  min_size            = 2
  max_size            = 6
  desired_capacity    = 6
  vpc_zone_identifier = ["subnet-abc"]
}
