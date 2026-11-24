# -*- coding: utf-8 -*-
"""One public FileExit request after project cleanup; IronPython 2.7 compatible.

This records a close request, not process termination. The parent must independently
verify the process creation identity, exit status and these immutable receipts.
"""
import datetime
import hashlib
import os
import sys
import traceback
try:
    _close_text = unicode
except NameError:
    _close_text = str

NORMAL_EXIT_GUID = 'caa0ef1f-6563-49ae-b0e0-80095fb233ef'


class NativeExit(object):
    def __init__(self, request, request_path, system, projects, publish, identity,
                 guid, empty_arguments, script_hashes):
        self.request = request
        self.directory = os.path.dirname(request['resultPath'])
        self.system = system
        self.projects = projects
        self.publish = publish
        self.guid = guid
        self.empty_arguments = empty_arguments
        self.script_hashes = script_hashes
        with open(request_path, 'rb') as stream:
            request_hash = hashlib.sha256(stream.read()).hexdigest()
        self.binding = dict((key, request[key]) for key in
                            ('operationId', 'requestId', 'requestFingerprint', 'launchId'))
        self.binding.update(pid=identity['pid'], startId=identity['startId'], requestFileHash=request_hash)
        self.ready = False
        self.queued = False
        self.dispatched = False
        self.first_error = None
        self.command = None

    def record(self, stage, **fields):
        value = dict(schemaVersion=1, binding=self.binding, stage=stage,
                     utc=datetime.datetime.utcnow().isoformat() + 'Z', **fields)
        self.publish(os.path.join(self.directory, 'normal-close-' + stage + '.json'), value)

    def fail(self, stage, error):
        # The first failure is sticky, including a failed queue after a reentrant callback.
        detail = dict(stage=stage, type=type(error).__name__, message=_close_text(error),
                      traceback=traceback.format_exc())
        if self.first_error is not None:
            try:
                sys.stderr.write('NORMAL_CLOSE_SECONDARY_ERROR ' + repr(detail) + '\n')
            except Exception:
                pass  # The immutable first failure remains authoritative.
            return
        self.first_error = detail
        publication_error = None
        try:
            self.record('failed', firstError=detail)
        except Exception:
            publication_error = traceback.format_exc()
        # Independent receipt if JSON publication failed; never replace the first error.
        try:
            sys.stderr.write('NORMAL_CLOSE_FIRST_ERROR ' + repr(detail) + '\n')
            if publication_error:
                sys.stderr.write('NORMAL_CLOSE_RECORD_ERROR ' + publication_error + '\n')
            sys.stderr.flush()
        except Exception:
            # No close retry. Missing required receipts still fail parent verification.
            self.first_error['recorderErrors'] = [publication_error, traceback.format_exc()]

    def empty_ui(self):
        value = dict(primaryIsNone=self.projects.primary is None,
                     openProjectCount=len(list(self.projects.all)), uiPresent=bool(self.system.ui_present))
        if value != dict(primaryIsNone=True, openProjectCount=0, uiPresent=True):
            raise ValueError('Public normal close requires UI and no open projects')
        return value

    def public_command(self):
        command = self.system.commands[self.guid(NORMAL_EXIT_GUID)]
        if command is None or command.guid != self.guid(NORMAL_EXIT_GUID):
            raise ValueError('Public FileExit command identity unavailable or changed')
        if not callable(command.execute) or not callable(self.system.execute_on_primary_thread):
            raise ValueError('Public FileExit or primary-thread callable unavailable')
        return command

    def preflight(self):
        policy = self.request.get('normalClosePolicy')
        expected = dict(version=1, commandGuid=NORMAL_EXIT_GUID, **self.script_hashes)
        if policy != expected:
            raise ValueError('Normal close policy or fixed script fingerprint changed')
        empty = self.empty_ui()
        self.command = self.public_command()
        self.record('preflight', noProject=empty, policy=policy)
        self.ready = True

    def queue(self):
        try:
            if not self.ready or self.queued or self.first_error is not None:
                raise ValueError('Normal close not ready or already requested')
            empty = self.empty_ui()
            self.public_command()
            self.record('queue', noProject=empty, asyncRequested=True, callableKind='python-callable')
            self.queued = True
            # Public signature is PieceOfCode, not System.Action. Async does NOT prove
            # OnLoad has unwound: this callback may run in a nested message pump.
            self.system.execute_on_primary_thread(self.callback, True)
            self.record('queued')
        except Exception as error:
            self.fail('queue', error)

    def callback(self):
        try:
            if self.first_error is not None or self.dispatched or not self.queued:
                raise ValueError('Close callback failed, duplicated or not queued')
            empty = self.empty_ui()
            self.record('callback', noProject=empty)
            command = self.public_command()
            if self.command.guid != command.guid:
                raise ValueError('Resolved public command identity changed')
            arguments = self.empty_arguments()
            self.record('dispatch', commandGuid=NORMAL_EXIT_GUID, arguments=[], dispatchOrdinal=1)
            self.dispatched = True
            command.execute(arguments)
            self.record('returned', dispatchCount=1)
        except Exception as error:
            # Do not throw into the native UI exception dialog, force exit, or retry.
            self.fail('callback', error)
