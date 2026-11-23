# -*- coding: utf-8 -*-
"""Load actual pinned helpers without invoking any engineering operation."""
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
    import io
    import json
    import hashlib
    import imp
    from System.Diagnostics import Process
    from scriptengine import system, projects, librarymanager
    _trace.bind_process(Process.GetCurrentProcess())
    _trace.record('necessary-modules-complete')
    # This is the new no-project launch intent, never a prepare/fixture intent.
    with io.open(os.path.join(_root,'launch-intent.json'),'r',encoding='utf-8') as _f: _intent=json.load(_f)
    _fixed = 'D:/InoPro-Fixed/0.36.0-da87ac1d553a'
    if os.path.normcase(os.path.abspath(_intent['fixedRoot'])) != os.path.normcase(os.path.abspath(_fixed)):
        raise ValueError('Fixed helper root differs')
    _directory=os.path.dirname(os.path.abspath(__file__))
    _loader_path=os.path.join(_directory,'probe_fixed_helpers.py')
    with open(_loader_path,'rb') as _f: _loader_hash=hashlib.sha256(_f.read()).hexdigest()
    if _loader_hash != _intent['loaderSha256']: raise ValueError('Helper fingerprint changed: loaderSha256')
    _trace.record('fixed-loader-import-start')
    _loader=imp.load_source('probe_fixed_helpers',_loader_path)
    _guard,_api,_helpers=_loader.load_fixed_helpers(_fixed,_directory,_intent,_trace,
        dict(projects=projects,system=system,librarymanager=librarymanager))
    _names=['text','normalize','sha','encode','content_hash','library_inventory','installed_inventory','task_call_inventory_view']
    _namespace=dict((name,_api[name].func_globals is _api) for name in _names)
    if not all(_namespace.values()): raise ValueError('Loaded helper globals differ')
    _trace.record('helper-namespace-verified',functions=_namespace)
    _returned = []
    def work():
        # Pure text helpers exercise shared globals/cross-calls; no project query.
        _returned.append(_api['content_hash'](u'辅助\r\n声明',u'无工程'))
    _trace.primary_call(system, work)
    _expected=hashlib.sha256(json.dumps([u'辅助\n声明',u'无工程'],ensure_ascii=False,separators=(',',':'),sort_keys=True).encode('utf-8')).hexdigest()
    if _returned!=[_expected]: raise ValueError('Main-thread pure helper result differs')
    _trace.publish_result(dict(status='succeeded', message=u'无工程辅助模块加载：主线程往返完成。', noProject=True,
                               loadedHelpers=_helpers,namespaceEvidence=_namespace,pureTextHash=_returned[0],
                               projectCalls=0, placeholderCalls=0, compileCalls=0, saveCalls=0))
    _trace.request_exit(system)
except Exception as _error:
    if _trace is not None: _trace.fail('startup-envelope', _error)
    else:
        import traceback
        sys.stderr.write('RECORDER_IMPORT_FAILURE\n'+traceback.format_exc());sys.stderr.flush()
    raise
