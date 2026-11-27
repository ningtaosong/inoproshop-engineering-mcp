# -*- coding: utf-8 -*-
"""Prepared diagnostic entry only. Not registered or used by the product.

Requires a future approved handoff and a fixed manifest. No writes, compilation,
save, close, command execution, or adoption of a changed disk version.
"""
import hashlib
import json
import os
import sys
import traceback

_loaded = None


def load_fixed(path, expected, name):
    with open(path, 'rb') as f:
        raw = f.read()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Fixed diagnostic dependency changed: ' + name)
    namespace = dict(__name__=name, __file__=path)
    eval(compile(raw.decode('utf-8', 'strict'), path, 'exec'), namespace, namespace)
    return namespace


def start():
    global _loaded
    with open(os.environ['INOPRO_SAVE_OBSERVER_PLAN'], 'rb') as f:
        plan = json.loads(f.read().decode('utf-8'))
    if plan.get('approvedForLaunch') is not True:
        raise ValueError('Prepared only; no approved diagnostic launch')
    if not os.path.isdir(plan['observationDirectory']) or os.listdir(plan['observationDirectory']):
        raise ValueError('A fresh observation directory is required; registry must not change')
    host = load_fixed(plan['hostPath'], plan['hostHash'], 'fixed_resident_host')
    observer = load_fixed(plan['observerPath'], plan['observerHash'], 'fixed_save_observer')
    original_loader = host['load_fixed']

    def diagnostic_loader(path, expected, name):
        core = original_loader(path, expected, name)
        base_adapter = core['NativeProjectAdapter']
        base_session = core['ResidentSession']

        class ObservedAdapter(base_adapter):
            save_observer = None

            def _owned(self):
                base_adapter._owned(self)
                if self.save_observer is None:
                    from System.Diagnostics import Process
                    p = Process.GetCurrentProcess()
                    try:
                        identity = dict(pid=int(p.Id), startId=unicode(p.StartTime.ToUniversalTime().Ticks))
                    finally:
                        p.Dispose()
                    with open(os.environ['INOPRO_RESIDENT_REQUEST'], 'rb') as f:
                        intent = json.loads(f.read().decode('utf-8'))
                    binding = dict(launchId=intent['launchId'], processIdentity=identity,
                        entryHash=intent['scriptHash'], hostHash=plan['hostHash'],
                        observerHash=plan['observerHash'], coreHash=expected)

                    def publish(name, row):
                        host['publish'](os.path.join(plan['observationDirectory'], name), row)

                    def fallback(error):
                        sys.stderr.write('SAVE_OBSERVER_ERROR ' + json.dumps(error, ensure_ascii=True) + '\n')
                        sys.stderr.flush()
                    self.save_observer = observer['install'](self.project, binding, publish, fallback,
                                                            lambda: base_adapter.snapshot(self))
                if self.save_observer.first_error is not None:
                    raise ValueError('Prior save observation failed; no continued requests')

        class ReadOnlySession(base_session):
            def handle(self, request):
                if request['command'] not in ('inspect', 'list', 'read'):
                    raise ValueError('Save provenance diagnostic only permits reads')
                return base_session.handle(self, request)

        core['NativeProjectAdapter'] = ObservedAdapter
        core['ResidentSession'] = ReadOnlySession
        return core

    host['load_fixed'] = diagnostic_loader
    # The launched entry fingerprint remains this file; original host/core are
    # separately pinned and recorded, not mislabeled as the new entry bytes.
    host['__file__'] = __file__
    _loaded = host
    host['start']()


if __name__ == '__main__':
    try:
        start()
    except Exception:
        sys.stderr.write('SAVE_PROBE_ENTRY_ERROR ' + traceback.format_exc())
        sys.stderr.flush()
        raise
