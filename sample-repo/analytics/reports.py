from .models import Event, Session


def sessions_with_event_counts(request):
    """Attach an event count to every session.

    Planted N+1: queries Event once per Session instead of annotating with
    a single aggregate query.
    """
    sessions = Session.objects.filter(active=True)
    counts = {}

    for session in sessions:
        events = Event.objects.filter(session_id=session.id)
        counts[session.id] = len(events)

    return counts
