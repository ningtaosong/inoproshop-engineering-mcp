"""Probe-only append-only startup evidence, usable by CPython and IronPython 2.7."""
import datetime
import hashlib
import json
import os
import sys
import traceback

try:
    string = unicode
except NameError:
    string = str


def exception(error):
    value = dict(type=type(error).__name__, message=string(error), traceback=traceback.format_exc())
    try:
        inner = getattr(error, 'InnerException', None)
        if inner is not None: value['innerException'] = string(inner)
    except Exception as secondary: value['innerReadError'] = string(secondary)
    return value


def durable(path, value):
    # New files only; do not overwrite even an earlier uncertain result.
    raw = (json.dumps(value, ensure_ascii=True, indent=2) + '\n').encode('utf-8')
    temp = path + '.publishing'
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        if os.path.exists(path): raise IOError('Evidence already exists: ' + path)
        os.rename(temp, path)
    except Exception:
        # Keep partial publication evidence; no cleanup that hides the first error.
        raise


def bootstrap(namespace):
    """First operation after this stdlib-only recorder import; no project helpers."""
    root = os.environ.get('INOPRO_TRACE_ROOT') or os.environ['INOPRO_CLEAR_ROOT']
    mode = os.environ.get('INOPRO_TRACE_MODE') or os.environ.get('INOPRO_CLEAR_MODE', 'startup')
    script = os.path.abspath(namespace['__file__'])
    value = dict(stage='entry', pid=os.getpid(), entryName=namespace.get('__name__'), scriptPath=script,
                 cwd=os.getcwd(), operationId=os.environ.get('INOPRO_TRACE_OPERATION'),
                 launchId=os.environ.get('INOPRO_TRACE_LAUNCH'), expectedScriptSha256=os.environ.get('INOPRO_TRACE_SCRIPT_SHA'))
    try:
        durable(os.path.join(root, mode + '-entry.json'), value)
        with open(script, 'rb') as f: actual = hashlib.sha256(f.read()).hexdigest()
        expected = value['expectedScriptSha256']
        if expected is not None and expected != actual: raise ValueError('Script fingerprint changed')
        return Trace(root, mode, dict(value, scriptSha256=actual))
    except Exception as first:
        evidence = dict(stage='bootstrap', primaryException=exception(first), binding=value)
        try: durable(os.path.join(root, mode + '-bootstrap-failure.json'), evidence)
        except Exception as logger:
            evidence['loggerException'] = exception(logger)
        try: sys.stderr.write(json.dumps(evidence, ensure_ascii=True) + '\n');sys.stderr.flush()
        except Exception: pass  # Both normal file logging and stderr can be unavailable.
        raise


class Trace:
    def __init__(self, root, mode, binding, writer=durable, fallback=None):
        self.root, self.mode, self.binding, self.writer = root, mode, binding, writer
        self.count = 0;self.primary = None;self.logging_errors = []
        self.fallback = fallback or (lambda line: sys.stderr.write(line + '\n'))
    def record(self, stage, **value):
        self.count += 1
        event = dict(value, stage=stage, sequence=self.count, binding=dict(self.binding),
                     utc=datetime.datetime.utcnow().isoformat()+'Z')
        self.writer(os.path.join(self.root, self.mode+'-trace-%03d.json'%self.count), event)
    def fail(self, stage, error):
        if self.primary is None: self.primary = dict(exception(error), stage=stage)
        else: self.logging_errors.append(dict(exception(error), stage=stage))
        payload = dict(primaryException=self.primary, secondaryExceptions=list(self.logging_errors), binding=self.binding)
        try: self.record('failure', **payload)
        except Exception as logger:
            self.logging_errors.append(dict(exception(logger), stage='failure-recorder'))
            payload['secondaryExceptions'] = list(self.logging_errors)
            try: self.fallback(json.dumps(payload, ensure_ascii=True));sys.stderr.flush()
            except Exception: pass
        return payload
    def bind_process(self, process):
        self.binding.update(pid=process.Id, creationUtcTicks=string(process.StartTime.ToUniversalTime().Ticks))
        self.record('process-identity')
    def publish_result(self, result, path=None):
        self.record('result-publication-start')
        result['traceBinding'] = dict(self.binding)
        target = path or os.path.join(self.root, self.mode+'-result.json')
        self.writer(target, result)
        with open(target, 'rb') as f: raw = f.read()
        if json.loads(raw.decode('utf-8')) != result: raise ValueError('Published result readback differs')
        self.record('result-publication-complete', path=target, sha256=hashlib.sha256(raw).hexdigest())
    def primary_call(self, system, action):
        self.record('primary-thread-requested')
        def guarded():
            try:
                self.record('primary-thread-entered')
                action()
                self.record('primary-thread-returning')
            except Exception as error:
                self.fail('primary-thread', error)
                raise
        system.execute_on_primary_thread(guarded)
        self.record('primary-thread-returned')
    def request_exit(self, system):
        self.record('exit-requested')
        system.exit()
        self.record('exit-call-returned')  # A request/return is not OS exit evidence.
