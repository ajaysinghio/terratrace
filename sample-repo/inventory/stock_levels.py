from .models import Warehouse, StockEntry


def low_stock_by_warehouse(threshold=10):
    """Flag warehouses with any SKU below the reorder threshold.

    Planted N+1: issues one StockEntry query per warehouse instead of a
    single batched query — another high-severity sample so the heatmap
    has more than one hot spot to show at a glance.
    """
    warehouses = Warehouse.objects.all()
    low_stock = {}

    warehouse_ids = [w.id for w in warehouses]
    all_entries = StockEntry.objects.filter(
        warehouse_id__in=warehouse_ids, quantity__lt=threshold
    )
    for entry in all_entries:
        low_stock.setdefault(entry.warehouse_id, []).append(entry)

    return low_stock
