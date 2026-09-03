from django.http import JsonResponse
from django.db.models import Sum

from .models import Customer, Order


def customer_order_totals(request):
    """Return each customer's total order value.

    Planted N+1: this issues one Order query per customer instead of a
    single batched query (e.g. via prefetch_related). TerraTrace should
    flag the `for` loop below.
    """
    customers = Customer.objects.all()
    order_totals = (
        Order.objects.values("customer_id")
        .annotate(total=Sum("amount"))
    )
    totals = {row["customer_id"]: row["total"] for row in order_totals}

    return JsonResponse(totals)
