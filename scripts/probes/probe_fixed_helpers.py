"""Pinned probe helpers only; importing/loading this module performs no project action."""
import hashlib
import imp
import io
import os


def execute_fixed_source(source, filename, namespace):
    # Python 2 treats this as an exec statement. Keep it in a function WITHOUT
    # nested functions/free-variable closures. Both runtimes use this same dict.
    exec(compile(source, filename, 'exec'), namespace)
    return namespace


def load_fixed_helpers(fixed, script_dir, expected, trace, native_globals):
    trace.record('project-helpers-start')
    files = {'guardSha256':os.path.join(script_dir,'library_placeholder_clear_guard.py'),
             'bridgeSha256':os.path.join(fixed,'bridge','worker.py'),
             'libraryHelperSha256':os.path.join(fixed,'bridge','library_reference.py'),
             'recorderSha256':os.path.join(script_dir,'probe_startup_trace.py'),
             'loaderSha256':os.path.abspath(__file__)}
    actual = {}
    for key, filename in files.items():
        with open(filename,'rb') as stream: actual[key] = hashlib.sha256(stream.read()).hexdigest()
        if actual[key] != expected[key]: raise ValueError('Helper fingerprint changed: '+key)
    guard = imp.load_source('placeholder_clear_guard', files['guardSha256'])
    trace.record('guard-helper-loaded')
    api = dict(__file__=files['bridgeSha256'],projects=native_globals['projects'],
               system=native_globals['system'],librarymanager=native_globals['librarymanager'])
    with io.open(files['bridgeSha256'],'r',encoding='utf-8') as stream: source = stream.read()
    marker = '# Fixed helper code only; request text is never evaluated.'
    guard.require(source.count(marker)==1,'Fixed worker helper boundary changed')
    execute_fixed_source(source.split(marker)[0], files['bridgeSha256'], api)
    trace.record('worker-helpers-loaded')
    with io.open(files['libraryHelperSha256'],'r',encoding='utf-8') as stream: source = stream.read()
    execute_fixed_source(source, 'library_reference.py', api)
    trace.record('project-helpers-complete',fingerprints=actual)
    return guard, api, actual
