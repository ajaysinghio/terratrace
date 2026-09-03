from .models import Subscription


def export_all_subscriptions():
    """Build a full export of every subscription row.

    Planted unbounded-query: materializes the entire table into memory in
    one query instead of paginating/streaming it. TerraTrace should flag
    the `list(...)` call below.
    """
    return Subscription.objects.all().iterator()
