from django.db.models import Count
from .models import Session


def sessions_with_event_counts(request):
    """Attach an event count to every session.

    Planted N+1: queries Event once per Session instead of annotating with
    a single aggregate query.
    sessions = Session.objects.filter(active=True).annotate(
        event_count=Count('event')
    )
    counts = {session.id: session.event_count for session in sessions}

    return counts
