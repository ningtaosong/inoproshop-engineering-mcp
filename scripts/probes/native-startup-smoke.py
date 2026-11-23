# -*- coding: utf-8 -*-
"""No-project startup smoke: no project/library/compile/save API is imported."""
import os
import sys

# Record a primitive marker before even importing the recorder module.
# It needs only os/sys and cannot be mistaken for a completed native callback.
try:
    _root = os.environ['INOPRO_TRACE_ROOT']
    _fd = os.open(os.path.join(_root, 'startup-bootstrap-entered.txt'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(_fd, 'wb') as _f:
        _f.write(('pid=%d\nname=%s\n'%(os.getpid(),__name__)).encode('ascii'));_f.flush();os.fsync(_f.fileno())
except Exception:
    import traceback
    sys.stderr.write('EARLIEST_ENTRY_FAILURE\n'+traceback.format_exc());sys.stderr.flush()
    raise

_trace = None
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import probe_startup_trace
    _trace = probe_startup_trace.bootstrap(globals())
    _trace.record('necessary-modules-start')
    from System.Diagnostics import Process
    from scriptengine import system
    _trace.bind_process(Process.GetCurrentProcess())
    _trace.record('necessary-modules-complete')
    _returned = []
    def work():
        _returned.append(u'无工程启动取证：主线程往返完成。')
    _trace.primary_call(system, work)
    if len(_returned)!=1: raise ValueError('Main-thread callback count differs')
    _trace.publish_result(dict(status='succeeded', message=_returned[0], noProject=True,
                               projectCalls=0, placeholderCalls=0, compileCalls=0, saveCalls=0))
    _trace.request_exit(system)
except Exception as _error:
    if _trace is not None: _trace.fail('startup-envelope', _error)
    else:
        import traceback
        sys.stderr.write('RECORDER_IMPORT_FAILURE\n'+traceback.format_exc());sys.stderr.flush()
    raise
