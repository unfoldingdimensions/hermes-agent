"""What a session with no resident agent can still tell you about its context.

``session.context_breakdown``'s ``agent is None`` branch used to answer from
``stats()`` → ``usage_stats(None)``, which reads every figure off a live agent and
is therefore structurally zero without one. So every non-resident session
reported ``context_max: 0, context_used: 0, categories: []`` — and the desktop,
correctly given that payload, drew a dark context meter for a conversation that
might be hundreds of thousands of tokens long (the Session Rail's "Session not
loaded" card, on a 122-message session).

These tests cover the replacement directly rather than through
``test_tui_session_reads``'s gateway fixture, so they stay runnable in a checkout
nested under a real Hermes home (that fixture imports ``gateway.run``, which
reads ``<install>/manifest.json`` at import time and trips the home I/O guard).
"""
from types import SimpleNamespace

from gateway.session_tui_reads import _stored_context_breakdown


class _Db:
    def __init__(self, messages=(), model='deepseek-v4.1-flash'):
        self.messages = list(messages)
        self.model = model

    def get_session(self, session_id):
        return {'session_id': session_id, 'model': self.model}

    def get_messages_as_conversation(self, session_id, include_ancestors=False):
        return self.messages


class _BrokenDb(_Db):
    def get_session(self, session_id):
        raise RuntimeError('db unavailable')

    def get_messages_as_conversation(self, session_id, include_ancestors=False):
        raise RuntimeError('db unavailable')


def _authority(db):
    return SimpleNamespace(db=db)


def test_measures_the_stored_transcript():
    db = _Db([{'role': 'user', 'content': 'x' * 4_000},
              {'role': 'assistant', 'content': 'y' * 4_000}])

    out = _stored_context_breakdown(_authority(db), 's1')

    assert out['context_used'] > 0, out
    assert out['estimated_total'] == out['context_used'], out
    assert out['context_source'] == 'stored_transcript', out
    assert out['context_estimated'] is True
    assert out['model'] == 'deepseek-v4.1-flash'


def test_reports_only_the_recoverable_category():
    """The prompt composition belongs to the live process. Reporting a guessed
    system-prompt or tool-definition row would put an invented number in a card
    that renders whatever it is given."""
    db = _Db([{'role': 'user', 'content': 'hello'}])

    out = _stored_context_breakdown(_authority(db), 's1')

    assert [category['id'] for category in out['categories']] == ['conversation'], out
    assert out['categories'][0]['tokens'] == out['context_used']


def test_reports_no_window_rather_than_resolving_one():
    """No window resolution: `get_model_context_length` probes endpoints and
    models.dev, and this RPC is polled on every idle mount. A percentage
    denominator is not worth ambient I/O on that path."""
    db = _Db([{'role': 'user', 'content': 'hello'}])

    out = _stored_context_breakdown(_authority(db), 's1')

    assert out['context_max'] == 0
    assert out['context_percent'] == 0
    assert out['context_used'] > 0


def test_an_empty_transcript_reads_as_nothing():
    out = _stored_context_breakdown(_authority(_Db()), 's1')

    assert out['categories'] == [], out
    assert out['context_used'] == 0 and out['estimated_total'] == 0, out


def test_a_broken_db_degrades_to_nothing_instead_of_raising():
    """This runs inside a read RPC the rail polls; a wedged session must not turn
    into a 500 that blanks every card."""
    out = _stored_context_breakdown(_authority(_BrokenDb()), 's1')

    assert out['categories'] == [], out
    assert out['context_used'] == 0 and out['estimated_total'] == 0, out
