"""Bounded progress snapshots beside synchronous requests; never stores output bytes."""
from collections import OrderedDict
from dataclasses import dataclass, field
import threading
import time
import uuid

MAX_ACTIVE = 64
MAX_FINISHED = 128
QUEUED_TTL = 120
RUNNING_TTL = 1800
FINISHED_TTL = 600
EVENT_KEYS = {'phase', 'current', 'total', 'name', 'completed', 'bytes', 'objects', 'label'}

@dataclass
class _Job:
    job_id: str
    kind: str
    status: str = 'queued'
    progress: dict = field(default_factory=dict)
    events: list = field(default_factory=list)
    claimed: bool = False
    updated: float = field(default_factory=time.monotonic)

    def snapshot(self):
        return {'job_id': self.job_id, 'kind': self.kind, 'status': self.status,
                'progress': dict(self.progress), 'events': [dict(e) for e in self.events]}

_lock = threading.RLock()
_jobs = OrderedDict()

def _prune():
    now = time.monotonic()
    for key, job in list(_jobs.items()):
        ttl = QUEUED_TTL if job.status == 'queued' else RUNNING_TTL if job.status == 'running' else FINISHED_TTL
        if now - job.updated > ttl:
            del _jobs[key]
    finished = [key for key, job in _jobs.items() if job.status in ('finished', 'failed')]
    for key in finished[:-MAX_FINISHED]:
        del _jobs[key]

def create(kind='export'):
    with _lock:
        _prune()
        if sum(j.status in ('queued', 'running') for j in _jobs.values()) >= MAX_ACTIVE:
            raise ValueError('진행 중인 출력 작업이 너무 많습니다.')
        jid = uuid.uuid4().hex
        _jobs[jid] = _Job(jid, str(kind))
        return _jobs[jid].snapshot()

def status(job_id):
    with _lock:
        _prune()
        job = _jobs.get(str(job_id))
        return job.snapshot() if job else None

def claim(job_id, kind=None):
    with _lock:
        _prune()
        job = _jobs.get(str(job_id))
        if not job or job.claimed or job.status != 'queued' or (kind is not None and job.kind != kind):
            return False
        job.claimed = True
        job.status = 'running'
        job.updated = time.monotonic()
        return True

def _event(event):
    return {key: value[:1024] if isinstance(value, str) else value
            for key, value in event.items() if key in EVENT_KEYS and isinstance(value, (str, bool, int, float))}

def update(job_id, **event):
    with _lock:
        job = _jobs.get(str(job_id))
        if not job or not job.claimed or job.status != 'running':
            return
        clean = _event(event)
        job.progress = clean
        if clean:
            job.events.append(clean)
            del job.events[:-200]
        job.updated = time.monotonic()

def _end(job_id, state, event):
    with _lock:
        job = _jobs.get(str(job_id))
        if not job:
            return None
        if job.status not in ('finished', 'failed'):
            job.status = state
            if event:
                job.progress = _event(event)
            job.updated = time.monotonic()
        snapshot = job.snapshot()
        _prune()
        return snapshot

def finish(job_id, **event):
    return _end(job_id, 'finished', event)

def fail(job_id, error=None, **event):
    # Errors are delivered in the original response; progress never retains private error text.
    return _end(job_id, 'failed', event)

def clear():
    with _lock:
        _jobs.clear()
