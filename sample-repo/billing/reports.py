from django.db.models import Sum
from .models import Invoice, Subscription


def monthly_revenue_by_subscription():
    """Sum invoice totals per subscription.

    Planted N+1: fetches invoices one subscription at a time instead of a
    single batched query.
    totals = (
        Invoice.objects
        .values("subscription_id")
        .annotate(total_revenue=Sum("total"))
    )
    revenue = {row["subscription_id"]: row["total_revenue"] for row in totals}

    return revenue


def overdue_subscription_ids():
    """Find subscriptions with any overdue invoice.

    Planted N+1: a second, independent occurrence in the same file so the
    per-file impact score reflects multiple hits, not just one.
    overdue_ids = list(
        Invoice.objects
        .filter(status="overdue")
        .values_list("subscription_id", flat=True)
        .distinct()
    )

    return overdue_ids
