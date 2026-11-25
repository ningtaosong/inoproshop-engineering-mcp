# -*- coding: utf-8 -*-
"""Pure policy for ONE no-project observation, not a product readiness guarantee."""
BLOCKED_FRAMES = (
    ('ScriptEngine.plugin', '_3S.CoDeSys.ScriptEngine.ScriptExecutor', 'Execute'),
    ('ScriptEngine.plugin', '_3S.CoDeSys.ScriptEngine.ScriptEngine', 'OnApplicationReady'),
    ('Frame.plugin', '_3S.CoDeSys.Frame.MainForm', 'OnLoad'),
)


class IdlePolicy(object):
    def __init__(self, limit_ms=10000):
        self.limit_ms = limit_ms
        self.tail_seen = False
        self.dispatch_count = 0
        self.stopped = False
        self.first_error = None

    def fail(self, code, detail):
        if self.first_error is None:
            self.first_error = dict(code=code, detail=detail)
        self.stopped = True

    def sample(self, kind, elapsed_ms, busy, frames, empty, same_thread):
        if self.stopped or self.dispatch_count:
            return 'stopped'
        if not empty:
            self.fail('UNEXPECTED_PROJECT', 'No project may be closed by this probe')
        elif not same_thread:
            self.fail('THREAD_CHANGED', 'Primary thread evidence differs')
        elif type(busy) is not bool:
            self.fail('BUSY_TYPE', 'Public getter did not return a Boolean')
        elif elapsed_ms >= self.limit_ms:
            self.fail('OBSERVATION_DEADLINE', 'No authorized candidate dispatch in 10 seconds')
        elif not frames or any(not x.get('assembly') or not x.get('method') for x in frames):
            self.fail('STACK_INCOMPLETE', 'Current stack identity cannot be evaluated')
        elif any(x['assembly'] in ('Frame.plugin', 'ScriptEngine.plugin') and not x.get('type') for x in frames):
            self.fail('STACK_INCOMPLETE', 'An OEM stack type is missing')
        if self.stopped:
            return 'stopped'
        blocked = any((x['assembly'], x.get('type'), x['method']) in BLOCKED_FRAMES for x in frames)
        if kind == 'idle' and self.tail_seen and busy is False and not blocked:
            return 'candidate'
        return 'observe'

    def reserve_dispatch(self):
        if self.stopped or self.dispatch_count:
            raise ValueError('Duplicate or stopped dispatch')
        self.dispatch_count = 1
        self.stopped = True
