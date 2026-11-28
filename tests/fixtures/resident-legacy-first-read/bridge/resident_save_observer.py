# -*- coding: utf-8 -*-
"""Offline-prepared save-event observer; NOT a product admission proof.

Install only in a separately authorized, owned diagnostic IDE after its project
is open. This module never opens, edits, saves, closes, or executes a command.
No result from this observer authorizes resident continuation by itself.
"""
import datetime
import hashlib
import os
import traceback
try:
    text_type = unicode
except NameError:
    text_type = str

CORE_SHA256 = 'b9169084ad15230ea9be121d026d80a2a4f71e020c424959dd2090385e8430ca'


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            block = f.read(1024 * 1024)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def field(fn):
    """Preserve null versus missing/error. Observation errors never imply false."""
    try:
        value = fn()
        return dict(state='null' if value is None else 'value', value=value)
    except Exception as error:
        return dict(state='error', error=dict(type=type(error).__name__, message=text_type(error)))


def exception_value(value):
    if value is None:
        return None
    return dict(type=text_type(value.GetType().FullName), message=text_type(value.Message))


def field_errors(value, path='details'):
    if isinstance(value, dict):
        if value.get('state') == 'error' and isinstance(value.get('error'), dict):
            return [dict(path=path, error=value['error'])]
        errors = []
        for key in sorted(value):
            errors.extend(field_errors(value[key], path + '.' + key))
        return errors
    if isinstance(value, list):
        errors = []
        for index, item in enumerate(value):
            errors.extend(field_errors(item, path + '[%d]' % index))
        return errors
    return []


class Observer(object):
    def __init__(self, binding, owner, publish, fallback, clock=None, after_command=None):
        self.binding = dict(binding)
        self.owner = owner
        self.publish = publish
        self.fallback = fallback
        self.clock = clock or (lambda: datetime.datetime.utcnow().isoformat() + 'Z')
        self.after_command = after_command
        self.sequence = 0
        self.first_error = None
        self.secondary_errors = []

    def record(self, kind, details):
        """No exception escapes into OEM save/command dispatch.

        A failed observation stays failed; it is never turned into save success.
        The independently retained first error survives a failed error recorder.
        """
        self.sequence += 1
        try:
            row = dict(scheme='resident-save-observation-v1', sequence=self.sequence,
                       at=self.clock(), binding=self.binding, event=kind,
                       owner=self.owner(), details=details(), writeAuthorized=False)
            errors = field_errors(row['owner'], 'owner') + field_errors(row['details'])
            row['complete'] = not errors
            if errors and self.first_error is None:
                # All field failures remain in the row. The retained first
                # incomplete observation prevents further diagnostic requests.
                self.first_error = dict(event=kind, sequence=self.sequence, fieldErrors=errors)
            self.publish('%04d-%s.json' % (self.sequence, kind), row)
            return row
        except Exception as error:
            failure = dict(event=kind, sequence=self.sequence, type=type(error).__name__,
                           message=text_type(error), traceback=traceback.format_exc())
            if self.first_error is None:
                self.first_error = failure
            else:
                self.secondary_errors.append(failure)
            try:
                self.fallback(dict(first=self.first_error, secondary=failure))
            except Exception as recording_error:
                self.secondary_errors.append(dict(type=type(recording_error).__name__,
                                                  message=text_type(recording_error)))
            return None

    def project_event(self, kind, args):
        def details():
            stream = args.Stream
            return dict(projectHandle=field(lambda: int(args.ProjectHandle)),
                        streamName=field(lambda: None if args.StreamName is None else text_type(args.StreamName)),
                        workingFolder=field(lambda: None if args.WorkingFolder is None else text_type(args.WorkingFolder)),
                        stream=dict(type=field(lambda: text_type(stream.GetType().FullName)),
                                    canRead=field(lambda: bool(stream.CanRead)),
                                    canSeek=field(lambda: bool(stream.CanSeek)),
                                    position=field(lambda: text_type(stream.Position)),
                                    length=field(lambda: text_type(stream.Length))),
                        exception=field(lambda: exception_value(args.Exception)) if kind == 'project-saving' else dict(state='not-exposed'))
        return self.record(kind, details)

    def command_event(self, kind, args):
        def details():
            return dict(commandGuid=field(lambda: text_type(args.CommandGuid)),
                        commandType=field(lambda: text_type(args.Command.GetType().FullName)),
                        commandAssembly=field(lambda: text_type(args.Command.GetType().Assembly.FullName)),
                        exception=field(lambda: exception_value(args.Exception)),
                        cancelled=field(lambda: bool(args.ExcecutionCancelled)) if kind == 'command-executed' else dict(state='not-exposed'),
                        memory=field(self.after_command) if kind == 'command-executed' and self.after_command is not None else dict(state='not-collected'))
        # Batch arguments are deliberately not collected; this observes ownership
        # and save timing, not arbitrary command payloads or account data.
        return self.record(kind, details)


def install(script_project, binding, publish, fallback, after_command=None):
    """Public CLR candidate route, statically checked; real access not yet tested.

    Caller must supply the owned launch/process identity and fresh output writer.
    No reflective private access, command invocation, disk write or hash adoption.
    """
    import clr
    from System import AppDomain
    from System.Threading import Thread
    matches = [a for a in AppDomain.CurrentDomain.GetAssemblies() if text_type(a.GetName().Name) == 'Core']
    if len(matches) != 1 or file_hash(text_type(matches[0].Location)) != CORE_SHA256:
        raise ValueError('Unverified loaded Core assembly; no observer installed')
    from _3S.CoDeSys.Core import SystemInstances
    engine = SystemInstances.Engine
    manager = SystemInstances.ObjectMgr
    commands = engine.CommandManager
    handle = int(script_project.handle)
    path = text_type(script_project.path)
    primary_thread = int(Thread.CurrentThread.ManagedThreadId)

    def owner():
        native = engine.Projects.GetProjectByHandle(handle)
        if native is None or int(native.Handle) != handle:
            raise ValueError('Owned public project handle unavailable')
        current = text_type(native.Path)
        if os.path.normcase(os.path.abspath(current)) != os.path.normcase(os.path.abspath(path)):
            raise ValueError('Owned path changed; no save-as continuation')
        if int(script_project.handle) != handle or text_type(script_project.path) != path:
            raise ValueError('Script/native project identity differs')
        thread = int(Thread.CurrentThread.ManagedThreadId)
        if thread != primary_thread:
            raise ValueError('Save callback not on the owned primary thread')
        return dict(projectHandle=handle, projectPath=path, thread=thread,
                    dirty=field(lambda: bool(native.Dirty)),
                    diskHash=field(lambda: file_hash(path)))

    observer = Observer(binding, owner, publish, fallback, after_command=after_command)
    callbacks = [lambda sender, args: observer.command_event('command-executing', args),
                 lambda sender, args: observer.project_event('project-saving', args),
                 lambda sender, args: observer.project_event('project-saved', args),
                 lambda sender, args: observer.command_event('command-executed', args)]
    attached = []
    try:
        commands.CommandExecuting += callbacks[0]
        attached.append((commands, 'CommandExecuting', callbacks[0]))
        manager.ProjectSaving += callbacks[1]
        attached.append((manager, 'ProjectSaving', callbacks[1]))
        manager.ProjectSaved += callbacks[2]
        attached.append((manager, 'ProjectSaved', callbacks[2]))
        commands.CommandExecuted += callbacks[3]
        attached.append((commands, 'CommandExecuted', callbacks[3]))
        if observer.record('installed', lambda: dict(coreSha256=CORE_SHA256)) is None:
            raise ValueError('Observer initial evidence failed')
        if observer.first_error is not None:
            raise ValueError('Observer initial fields incomplete')
    except Exception:
        # Removing our own partially subscribed observers does not save/close.
        for source, name, callback in reversed(attached):
            try:
                getattr(source, name).__isub__(callback)
            except Exception as error:
                observer.secondary_errors.append(dict(type=type(error).__name__, message=text_type(error)))
        raise
    observer.callbacks = callbacks
    observer.attached = attached
    return observer
