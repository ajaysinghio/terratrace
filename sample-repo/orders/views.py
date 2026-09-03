from django.http import JsonResponse

from django.db.models import Sum
from .models import Customer


def customer_order_totals(request):
    """Return each customer's total order value.

    Planted N+1: this issues one Order query per customer instead of a
    single batched query (e.g. via prefetch_related). TerraTrace should
    flag the `for` loop below.
    totals = {
        row["customer_id"]: row["total"]
        for row in Customer.objects.values("id").annotate(
            total=Sum("order__amount")
        ).values("customer_id", "total")
    }
        totals[customer.id] = sum(order.amount for order in orders)

    return JsonResponse(totals)
