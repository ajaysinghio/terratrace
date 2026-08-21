from .models import Invoice, Subscription


def monthly_revenue_by_subscription():
    """Sum invoice totals per subscription.

    Planted N+1: fetches invoices one subscription at a time instead of a
    single batched query.
    """
    subscriptions = Subscription.objects.all()
    revenue = {}

    for subscription in subscriptions:
        invoices = Invoice.objects.filter(subscription_id=subscription.id)
        revenue[subscription.id] = sum(invoice.total for invoice in invoices)

    return revenue


def overdue_subscription_ids():
    """Find subscriptions with any overdue invoice.

    Planted N+1: a second, independent occurrence in the same file so the
    per-file impact score reflects multiple hits, not just one.
    """
    subscriptions = Subscription.objects.all()
    overdue_ids = []

    for subscription in subscriptions:
        overdue = Invoice.objects.get(subscription_id=subscription.id, status="overdue")
        if overdue:
            overdue_ids.append(subscription.id)

    return overdue_ids
