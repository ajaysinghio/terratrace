from django.http import JsonResponse

from .models import Customer, Order


def customer_order_totals(request):
    """Return each customer's total order value.

    Planted N+1: this issues one Order query per customer instead of a
    single batched query (e.g. via prefetch_related). TerraTrace should
    flag the `for` loop below.
    """
    customers = Customer.objects.all()
    totals = {}

    for customer in customers:
        orders = Order.objects.filter(customer_id=customer.id)
        totals[customer.id] = sum(order.amount for order in orders)

    return JsonResponse(totals)
