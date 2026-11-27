# -*- coding: utf-8 -*-
"""Independent no-project lifecycle observation; IronPython 2.7 compatible.

No project operation, business helper import, private reflection, or forced exit.
Public FileExit is dispatched at most once by an experimental Idle condition.
"""
import os
import sys
import json
import hashlib
import datetime
import traceback
import imp

_ordinal = 0
_first_error = None
_binding = {}
_root = None
_intent = None
_controller = None
_secondary_errors = []


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
    value = dict(binding=dict(_binding), utc=datetime.datetime.utcnow().isoformat() + 'Z',
                 ordinal=_ordinal, stage=stage, **fields)
    publish('event-%04d-%s.json' % (_ordinal, stage), value)


def fallback(text):
    try:
        sys.stderr.write(text + '\n')
        sys.stderr.flush()
    except Exception as error:
        # Sticky in-memory evidence remains; no logger error escapes to a UI dialog.
        _secondary_errors.append(dict(stage='stderr', type=type(error).__name__, message=repr(error)))


def fail(stage, error):
    global _first_error
    detail = dict(stage=stage, type=type(error).__name__, message=unicode(error), traceback=traceback.format_exc())
    if _first_error is None:
        _first_error = detail
        try:
            record('first-error', error=detail)
        except Exception as logging_error:
            _secondary_errors.append(dict(stage='record-first-error', message=repr(logging_error)))
            fallback('IDLE_FIRST_ERROR ' + repr(detail))
            fallback('IDLE_LOGGING_ERROR ' + repr(logging_error))
    else:
        _secondary_errors.append(detail)
        fallback('IDLE_SECONDARY_ERROR ' + repr(detail))
    if _controller is not None:
        _controller.policy.fail(stage, detail)
        _controller.stop_sampling()


def observer_has_stopped(now=None):
    keys = ('operationId', 'requestId', 'launchId', 'requestFingerprint', 'scriptSha256')
    expected = dict((k, _binding[k]) for k in keys)
    with open(os.path.join(_root, 'native-admission.json'), 'rb') as stream:
        admission = json.loads(stream.read().decode('utf-8'))
    if admission['binding'] != expected:
        raise ValueError('Parent admission binding differs')
    deadline = datetime.datetime.strptime(admission['deadlineUtc'], '%Y-%m-%dT%H:%M:%S.%fZ')
    if (datetime.datetime.utcnow() if now is None else now) >= deadline:
        raise ValueError('Fixed parent dispatch deadline expired')
    stop = os.path.join(_root, 'observer-stop.json')
    if os.path.exists(stop):
        with open(stop, 'rb') as stream:
            stopped = json.loads(stream.read().decode('utf-8'))
        if stopped['binding'] != expected:
            raise ValueError('Parent stop marker binding differs; no native dispatch')
        raise ValueError('Observer stopped admission; no new native dispatch')


def empty_projects():
    state = dict(primaryIsNone=projects.primary is None, openProjectCount=len(list(projects.all)),
                 uiPresent=bool(system.ui_present))
    if state != dict(primaryIsNone=True, openProjectCount=0, uiPresent=True):
        raise ValueError('Unexpected project/UI state; probe will not close any project')
    return state


def current_stack():
    frames = StackTrace(False).GetFrames()
    if frames is None:
        raise ValueError('No stack frames')
    out = []
    for frame in frames:
        method = frame.GetMethod()
        if method is None:
            raise ValueError('Stack method unavailable')
        declaring = method.DeclaringType
        module = method.Module
        out.append(dict(assembly=unicode(module.Assembly.GetName().Name),
                        mvid=unicode(module.ModuleVersionId),
                        type=unicode(declaring.FullName) if declaring is not None else None,
                        method=unicode(method.Name)))
    return out


class Probe(object):
    def __init__(self):
        self.policy = policy_module.IdlePolicy()
        self.form = None
        self.getter = None
        self.timer = None
        self.idle_handler = None
        self.tick_handler = None
        self.primary_thread = None
        self.clock = Stopwatch.StartNew()
        self.sample_count = 0
        self.closed_events = 0

    def stop_sampling(self):
        # Only remove this diagnostic's listeners. Do not close or enable UI.
        errors = []
        if self.timer is not None:
            try:
                self.timer.Stop()
                if self.tick_handler is not None:
                    self.timer.remove_Tick(self.tick_handler)
                    self.tick_handler = None
            except Exception as error:
                fallback('IDLE_STOP_TIMER_ERROR ' + repr(error))
                errors.append(repr(error))
        if self.idle_handler is not None:
            try:
                Application.remove_Idle(self.idle_handler)
                self.idle_handler = None
            except Exception as error:
                fallback('IDLE_REMOVE_HANDLER_ERROR ' + repr(error))
                errors.append(repr(error))
        return errors

    def setup(self):
        try:
            observer_has_stopped()
            state = empty_projects()
            self.primary_thread = Thread.CurrentThread.ManagedThreadId
            record('entry-empty', thread=self.primary_thread, noProject=state, stack=current_stack())
            forms = list(Application.OpenForms)
            rows = [dict(type=unicode(f.GetType().FullName), assembly=unicode(f.GetType().Assembly.GetName().Name)) for f in forms]
            matches = [f for f in forms if unicode(f.GetType().FullName) == '_3S.CoDeSys.Frame.MainForm']
            record('forms-read', forms=rows, matchCount=len(matches))
            if len(matches) != 1 or len(forms) != 1:
                raise ValueError('Expected one MainForm and no other open form; no prompt handling')
            self.form = matches[0]
            kind = self.form.GetType()
            assembly = kind.Assembly
            identity = dict(path=unicode(assembly.Location), sha256=sha_file(unicode(assembly.Location)),
                            mvid=unicode(assembly.ManifestModule.ModuleVersionId), type=unicode(kind.FullName))
            if identity != _intent['frameIdentity']:
                raise ValueError('Current MainForm assembly identity differs')
            prop = kind.GetProperty('LengthyOperationIsActive', BindingFlags.Public | BindingFlags.Instance)
            if prop is None or prop.GetIndexParameters().Length != 0 or unicode(prop.PropertyType.FullName) != 'System.Boolean':
                raise ValueError('Public Boolean property unavailable')
            self.getter = prop.GetGetMethod(False)
            if self.getter is None or not self.getter.IsPublic:
                raise ValueError('Public getter unavailable; no non-public fallback')
            if self.form.InvokeRequired:
                raise ValueError('Not on native UI thread')
            record('public-getter-ready', identity=identity, getter=unicode(self.getter.Name),
                   visibility='Public Instance only', declaringType=unicode(self.getter.DeclaringType.FullName))
            self.closing_handler = FormClosingEventHandler(self.on_closing)
            self.closed_handler = FormClosedEventHandler(self.on_closed)
            self.form.add_FormClosing(self.closing_handler)
            self.form.add_FormClosed(self.closed_handler)
            self.idle_handler = EventHandler(self.on_idle)
            Application.add_Idle(self.idle_handler)
            self.timer = Timer()
            self.timer.Interval = 100
            self.tick_handler = EventHandler(self.on_tick)
            self.timer.add_Tick(self.tick_handler)
            self.clock.Restart()
            self.timer.Start()
            record('listeners-ready', limitMs=10000, timerMs=100, timerPurpose='sampling/deadline only')
        except Exception as error:
            fail('setup', error)

    def on_idle(self, sender, args):
        self.sample('idle')

    def on_tick(self, sender, args):
        self.sample('timer')

    def sample(self, kind):
        if self.policy.stopped or _first_error is not None:
            self.stop_sampling()
            return
        try:
            observer_has_stopped()
            self.sample_count += 1
            if self.sample_count > 1000:
                raise ValueError('Bounded diagnostic event limit reached')
            state = empty_projects()
            thread = Thread.CurrentThread.ManagedThreadId
            same_thread = thread == self.primary_thread and not self.form.InvokeRequired
            raw = self.getter.Invoke(self.form, None)
            if not isinstance(raw, (bool, Boolean)):
                raise ValueError('Actual public getter result is not Boolean')
            busy = bool(raw)
            stack = current_stack()
            elapsed = self.clock.ElapsedMilliseconds
            decision = self.policy.sample(kind, elapsed, busy, stack, True, same_thread)
            record('sample', kind=kind, elapsedMs=elapsed, busy=busy, resultType=type(raw).__name__,
                   tailSeen=self.policy.tail_seen, thread=thread, noProject=state, stack=stack, decision=decision)
            if decision == 'candidate':
                self.dispatch()
            elif decision == 'stopped':
                raise ValueError(repr(self.policy.first_error))
        except Exception as error:
            fail('sample', error)

    def dispatch(self):
        # Reserve before any callback can re-enter. A cancelled close is never retried.
        self.policy.reserve_dispatch()
        errors = self.stop_sampling()
        if errors:
            raise ValueError('Diagnostic listener removal failed: ' + repr(errors))
        observer_has_stopped()
        state = empty_projects()
        if Thread.CurrentThread.ManagedThreadId != self.primary_thread or self.form.InvokeRequired:
            raise ValueError('UI thread changed immediately before FileExit')
        command = system.commands[Guid(_intent['commandGuid'])]
        if command is None or unicode(command.guid).lower() != _intent['commandGuid'] or not callable(command.execute):
            raise ValueError('Exact public FileExit command unavailable')
        record('close-dispatch', commandGuid=_intent['commandGuid'], dispatchOrdinal=1,
               noProject=state, candidateOnly=True, sufficientProductReadinessNotClaimed=True)
        command.execute(Array[String]([]))
        record('close-returned', returnContract='void', dispatchCount=1)
        publish('result.json', dict(binding=dict(_binding), status='returned-observation-only',
                  message=u'无工程观察：唯一退出命令已返回，正常退出仍以父进程回执为准。',
                  dispatchCount=1, firstError=_first_error, projectCalls=0, compileCalls=0, saveCalls=0,
                  requiresIndependentExit=True))

    def on_closing(self, sender, args):
        try:
            record('form-closing', cancel=bool(args.Cancel), reason=unicode(args.CloseReason),
                   thread=Thread.CurrentThread.ManagedThreadId, stack=current_stack(),
                   observationIsNotAssumedFinalCancel=True)
        except Exception as error:
            fail('form-closing', error)

    def on_closed(self, sender, args):
        try:
            self.closed_events += 1
            record('form-closed', reason=unicode(args.CloseReason), count=self.closed_events,
                   thread=Thread.CurrentThread.ManagedThreadId)
        except Exception as error:
            fail('form-closed', error)


try:
    _intent_path = os.environ['INOPRO_IDLE_INTENT']
    with open(_intent_path, 'rb') as stream:
        _intent = json.loads(stream.read().decode('utf-8'))
    _root = _intent['directory']
    if not os.path.isabs(_root) or _intent['scope'] != 'one-no-project-public-idle-observation':
        raise ValueError('Unexpected diagnostic intent')
    _binding = dict((k, _intent[k]) for k in ('operationId', 'requestId', 'launchId', 'requestFingerprint'))
    _binding['scriptSha256'] = sha_file(__file__)
    record('script-entry', pid=os.getpid())
    observer_has_stopped()
    if _binding['scriptSha256'] != _intent['scriptSha256']:
        raise ValueError('Native script fingerprint differs')
    helper = os.path.join(os.path.dirname(__file__), 'native_idle_policy.py')
    if sha_file(helper) != _intent['policySha256']:
        raise ValueError('Policy fingerprint differs')
    policy_module = imp.load_source('fixed_native_idle_policy', helper)
    import clr
    clr.AddReference('System.Windows.Forms')
    from System import Array, String, Guid, Boolean, EventHandler
    from System.Reflection import BindingFlags
    from System.Diagnostics import Process, StackTrace, Stopwatch
    from System.Threading import Thread
    from System.Windows.Forms import Application, Timer, FormClosingEventHandler, FormClosedEventHandler
    from scriptengine import system, projects
    native_process = Process.GetCurrentProcess()
    _binding.update(pid=native_process.Id, startId=unicode(native_process.StartTime.ToUniversalTime().Ticks))
    record('modules-loaded', policySha256=sha_file(helper), language=unicode(sys.version))
    _controller = Probe()
    system.execute_on_primary_thread(_controller.setup)
    if _first_error is None:
        record('script-tail', note='last marker, not proof that the hosting executor has unwound')
        _controller.policy.tail_seen = True
except Exception as error:
    fail('entry', error)
