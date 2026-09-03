from .models import Event, Session
from django.db.models import Count


def sessions_with_event_counts(request):
    """Attach an event count to every session.

    Uses a single annotated query instead of querying Event once per Session.
    """
    sessions = Session.objects.filter(active=True).annotate(
        event_count=Count('event')
    )
    counts = {session.id: session.event_count for session in sessions}

    return counts
