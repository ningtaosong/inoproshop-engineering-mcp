# -*- coding: utf-8 -*-
"""Two fixed no-project reads in one owned IDE; no close/exit/engineering calls.

Independent validation only. File polling is confined to a background thread.
The exclusive UTF-8 publisher is reused unchanged from native_idle_probe.py.
"""
import os
import sys
import json
import hashlib
import datetime
import traceback

_root = None
_binding = {}
_ordinal = 0
_first_error = None
_secondary_errors = []
_controller = None
BLOCKED = (
    ('ScriptEngine.plugin', '_3S.CoDeSys.ScriptEngine.ScriptExecutor', 'Execute'),
    ('ScriptEngine.plugin', '_3S.CoDeSys.ScriptEngine.ScriptEngine', 'OnApplicationReady'),
    ('Frame.plugin', '_3S.CoDeSys.Frame.MainForm', 'OnLoad'),
)


def sha_file(p):
    with open(p, 'rb') as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def publish(name, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + u'\n').encode('utf-8')
    target = os.path.join(_root, name)
    temporary = target + '.publishing'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        stream = os.fdopen(fd, 'wb')
    except Exception:
        os.close(fd)
        raise
    try:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    finally:
        stream.close()
    if os.path.exists(target):
        raise IOError('Evidence already exists: ' + target)
    os.rename(temporary, target)
    with open(target, 'rb') as stream:
        if json.loads(stream.read().decode('utf-8')) != value:
            raise ValueError('Published evidence readback differs')


def record(stage, **fields):
    global _ordinal
    _ordinal += 1
    value = dict(binding=dict(_binding), ordinal=_ordinal, stage=stage,
                 utc=datetime.datetime.utcnow().isoformat() + 'Z')
    value.update(fields)
    publish('native-%04d-%s.json' % (_ordinal, stage), value)


def exception_detail(error):
    # Preserve Python's original traceback AND public CLR inner-exception data.
    # Recorder failures are separate; never replace the first exception.
    detail = dict(type=type(error).__name__, traceback=traceback.format_exc(), clrChain=[], clrChainAvailable=False, evidenceErrors=[])
    try:detail['message'] = unicode(error)
    except Exception as secondary:
        detail['message'] = '<message unavailable>'
        detail['evidenceErrors'].append(dict(field='message', error=repr(secondary)))
    try:
        native = getattr(error, 'clsException', None)
        if native is None and hasattr(error, 'InnerException'):native = error
        detail['clrChainAvailable'] = native is not None
        seen = set()
        while native is not None:
            if id(native) in seen or len(seen) >= 32:
                detail['evidenceErrors'].append(dict(field='InnerException', error='cycle or bound reached'))
                break
            seen.add(id(native))
            row = {}
            for key, getter in [('type', lambda:unicode(native.GetType().FullName)),
                                ('message', lambda:unicode(native.Message)),
                                ('stack', lambda:unicode(native.StackTrace) if native.StackTrace is not None else None),
                                ('full', lambda:unicode(native.ToString()))]:
                try:row[key] = getter()
                except Exception as secondary:
                    detail['evidenceErrors'].append(dict(field=key, error=repr(secondary)))
            detail['clrChain'].append(row)
            native = native.InnerException
    except Exception as secondary:
        detail['evidenceErrors'].append(dict(field='CLR chain', error=repr(secondary)))
    detail['clrChainComplete'] = detail['clrChainAvailable'] and not bool(detail['evidenceErrors'])
    return detail


def fail(stage, error):
    global _first_error
    detail = exception_detail(error)
    detail['stage'] = stage
    if _controller is not None and _controller.callback_error is not None:
        detail['nativeCallback'] = _controller.callback_error
    if _first_error is None:
        _first_error = detail
        try:
            record('first-error', error=detail)
        except Exception as secondary:
            _secondary_errors.append(dict(stage='record-first-error', message=repr(secondary)))
    else:
        _secondary_errors.append(detail)
    try:
        sys.stderr.write('TWO_READ_ERROR ' + repr(dict(first=_first_error, secondary=_secondary_errors)) + '\n')
        sys.stderr.flush()
    except Exception as secondary:
        _secondary_errors.append(dict(stage='stderr', message=repr(secondary)))


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate JSON field')
        value[key] = item
    return value


def read_json(file, limit=16384):
    with open(file, 'rb') as stream:
        data = stream.read(limit+1)
    if len(data) > limit:
        raise ValueError('Structured request exceeds fixed limit')
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique_pairs)


def request_view(value, intent, sequence, prior_hash):
    expected = dict(schemaVersion=1, command='empty-project-status', sequence=sequence,
                    requestId=intent['requestIds'][sequence-1], launchId=intent['launchId'],
                    scriptSha256=intent['scriptSha256'], previousResultSha256=prior_hash)
    # JSON booleans/numbers must not pass as integer protocol fields.
    if type(value) is not dict or type(value.get('sequence')) is not int or type(value.get('schemaVersion')) is not int or value != expected:
        raise ValueError('Request identity, order, scope or prior receipt differs')
    return dict(expected)


def stable_identity(first, current):
    for key in ('thread', 'mainHandle', 'frameIdentity'):
        if first[key] != current[key]:
            raise ValueError('Owned native context changed: ' + key)


class TwoReadProbe(object):
    def __init__(self, intent):
        self.intent = intent
        self.primary_thread = None
        self.first_state = None
        self.completed = 0
        self.prior_hash = None
        self.background = None
        self.callback_error = None
        self.initialization_complete = False

    def admission(self):
        if _first_error is not None or os.path.exists(os.path.join(_root, 'observer-stop.json')):
            raise ValueError('Observation stopped; no next dispatch')
        receipt = read_json(os.path.join(_root, 'native-admission.json'))
        if receipt['launchId'] != self.intent['launchId'] or receipt['scriptSha256'] != self.intent['scriptSha256']:
            raise ValueError('Admission binding differs')
        limit = datetime.datetime.strptime(receipt['deadlineUtc'], '%Y-%m-%dT%H:%M:%S.%fZ')
        if datetime.datetime.utcnow() >= limit:
            raise ValueError('Fixed observation deadline expired')

    def capture(self):
        # This method runs only through the public primary-thread entry.
        current_thread = Thread.CurrentThread.ManagedThreadId
        if self.primary_thread is not None and current_thread != self.primary_thread:
            raise ValueError('Primary thread changed')
        no_project = dict(primaryIsNone=projects.primary is None,
                          openProjectCount=len(list(projects.all)), uiPresent=bool(system.ui_present))
        if no_project != dict(primaryIsNone=True, openProjectCount=0, uiPresent=True):
            raise ValueError('Unexpected project or UI state; no project will be touched')
        forms = list(Application.OpenForms)
        mains = [form for form in forms if unicode(form.GetType().FullName) == '_3S.CoDeSys.Frame.MainForm']
        if len(mains) != 1:
            raise ValueError('Unique owned MainForm unavailable')
        main = mains[0]
        assembly = main.GetType().Assembly
        identity = dict(path=unicode(assembly.Location), mvid=unicode(assembly.ManifestModule.ModuleVersionId),
                        type=unicode(main.GetType().FullName))
        expected = dict((key, self.intent['frameIdentity'][key]) for key in ('path', 'mvid', 'type'))
        if identity != expected or main.IsDisposed or main.InvokeRequired:
            raise ValueError('Owned MainForm identity or thread unavailable')
        rows = [dict(type=unicode(form.GetType().FullName), visible=bool(form.Visible), modal=bool(form.Modal)) for form in forms]
        if any(row['visible'] and row['modal'] for row in rows):
            raise ValueError('Visible modal form; no prompt handling')
        frames = StackTrace(False).GetFrames()
        if not frames:
            raise ValueError('Current stack unavailable')
        stack = []
        for frame in frames:
            method = frame.GetMethod()
            if method is None:
                raise ValueError('Current stack incomplete')
            stack.append(dict(assembly=unicode(method.Module.Assembly.GetName().Name),
                              type=unicode(method.DeclaringType.FullName) if method.DeclaringType else None,
                              method=unicode(method.Name)))
        startup = any((row['assembly'], row['type'], row['method']) in BLOCKED for row in stack)
        if not main.Enabled and not startup:
            raise ValueError('MainForm disabled after startup; no prompt handling')
        return dict(noProject=no_project, thread=current_thread, mainHandle=unicode(main.Handle.ToInt64()),
                    frameIdentity=identity, mainEnabled=bool(main.Enabled), forms=rows, stack=stack, startupFramesPresent=startup)

    def on_primary(self):
        holder = []
        errors = []
        def callback():
            try:
                holder.append(self.capture())
            except Exception as error:
                if self.callback_error is None:
                    self.callback_error = exception_detail(error)
                errors.append(error)
        system.execute_on_primary_thread(callback)
        if errors:
            raise errors[0]
        if len(holder) != 1:
            raise ValueError('Public primary-thread callback incomplete')
        return holder[0]

    def initialize(self):
        try:
            self.primary_thread = Thread.CurrentThread.ManagedThreadId
            record('initialization-entered', thread=self.primary_thread)
            initial = self.capture()
            record('initialization', state=initial)
            self.first_state = initial
            self.initialization_complete = True
        except Exception as error:
            if self.callback_error is None:self.callback_error = exception_detail(error)
            fail('initialization', error)
            # No exception escapes this callback to be replaced by a native wrapper.

    def service_request(self, sequence):
        if sequence != self.completed+1 or self.completed >= 2:
            raise ValueError('Duplicate or out-of-order receiver dispatch')
        self.admission()
        name = 'request-%d.json' % sequence
        value = request_view(read_json(os.path.join(_root, name)), self.intent, sequence, self.prior_hash)
        request_hash = sha_file(os.path.join(_root, name))
        record('request-dispatch', request=value, requestSha256=request_hash)
        state = self.on_primary()
        if state['startupFramesPresent']:
            raise ValueError('Request ran inside startup execution; initialization return not proven')
        stable_identity(self.first_state, state)
        self.admission()
        response = dict(binding=dict(_binding), request=value, requestSha256=request_hash, state=state,
                        status='read-returned', message=u'已只读确认当前无工程；未关闭IDE',
                        engineeringCalls=0, closeCalls=0, exitCalls=0)
        result_name = 'result-%d.json' % sequence
        publish(result_name, response)
        self.prior_hash = sha_file(os.path.join(_root, result_name))
        self.completed += 1
        record('request-completed', requestId=value['requestId'], sequence=sequence, resultSha256=self.prior_hash)
        return response

    def run(self):
        try:
            # Waiting occurs on this background thread, never in a primary callback.
            record('receiver-started', thread=Thread.CurrentThread.ManagedThreadId)
            while True:
                self.admission()
                state = self.on_primary()
                stable_identity(self.first_state, state)
                if not state['startupFramesPresent']:
                    publish('ready.json', dict(binding=dict(_binding), state=state,
                        proof='Public primary callback stack lacks known startup frames; not a script-tail inference'))
                    break
                Thread.Sleep(100)
            for sequence in (1, 2):
                while not os.path.exists(os.path.join(_root, 'request-%d.json' % sequence)):
                    self.admission()
                    Thread.Sleep(100)
                self.service_request(sequence)
            record('receiver-completed', requests=self.completed, scope='two reads only; no reconnect or project handle claim')
        except Exception as error:
            fail('receiver', error)
        finally:
            try:
                record('receiver-stopped', completed=self.completed, firstError=_first_error, ideExitRequested=False)
            except Exception as error:
                fail('receiver-stop-publication', error)


def start():
    global _root, _binding, _controller
    intent = read_json(os.environ['INOPRO_TWO_READ_INTENT'], 1048576)
    _root = intent['directory']
    _binding = dict((key, intent[key]) for key in ('operationId', 'requestId', 'launchId', 'requestFingerprint', 'scriptSha256'))
    record('script-entry', pid=os.getpid())
    if intent['scope'] != 'one-owned-ide-two-empty-status-reads' or not os.path.isabs(_root):
        raise ValueError('Diagnostic scope differs')
    if len(intent['requestIds']) != 2 or len(set(intent['requestIds'])) != 2:
        raise ValueError('Two distinct request identities required')
    if sha_file(__file__) != intent['scriptSha256']:
        raise ValueError('Fixed script fingerprint differs')
    for item in intent['fixedFiles']:
        if sha_file(item['path']) != item['sha256']:
            raise ValueError('Fixed dependency fingerprint differs: ' + item['path'])
    global Process, StackTrace, Thread, ThreadStart, Application, system, projects
    import clr
    clr.AddReference('System.Windows.Forms')
    from System.Diagnostics import Process, StackTrace
    from System.Threading import Thread, ThreadStart
    from System.Windows.Forms import Application
    from scriptengine import system, projects
    process = Process.GetCurrentProcess()
    try:
        _binding.update(pid=process.Id, startId=unicode(process.StartTime.ToUniversalTime().Ticks))
    finally:
        process.Dispose()
    record('modules-loaded', language=unicode(sys.version), scriptSha256=sha_file(__file__))
    if sha_file(intent['frameIdentity']['path']) != intent['frameIdentity']['sha256']:
        raise ValueError('Installed Frame fingerprint differs')
    _controller = TwoReadProbe(intent)
    _controller.admission()
    system.execute_on_primary_thread(_controller.initialize)
    if _first_error is not None or not _controller.initialization_complete:
        return # no receiver/background thread after an uncertain initialization
    _controller.background = Thread(ThreadStart(_controller.run))
    _controller.background.IsBackground = True
    _controller.background.Start()
    # No tail marker is used as initialization-return evidence. The receiver
    # verifies the public callback stack before ready and both actual requests.


try:
    start()
except Exception as error:
    fail('entry', error)
