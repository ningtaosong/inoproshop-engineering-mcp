# -*- coding: utf-8 -*-
"""Exercise the actual fixed-module loader offline; never call start or native APIs."""
import os, sys, json, hashlib, tempfile, traceback, ast

# Independent expected codepoints, not values derived from the loaded module.
EXPECTED = (
    u'(* \u672a\u4fdd\u5b58\u8fde\u7eed\u8bf7\u6c42\uff1a\u7b2c\u4e00\u5904\u6ce8\u91ca *)',
    u'(* \u672a\u4fdd\u5b58\u8fde\u7eed\u8bf7\u6c42\uff1a\u7b2c\u4e8c\u5904\u6ce8\u91ca *)')

def run_cases_json(probe_path, module_path):
    cases=[]; observations={}; root=tempfile.mkdtemp(prefix='resident-loader-offline-')
    def check(value, message):
        if not value: raise AssertionError(message)
    def case(name, fn):
        try: fn(); cases.append(dict(name=name,passed=True))
        except Exception: cases.append(dict(name=name,passed=False,error=traceback.format_exc()))
    def raw(path):
        with open(path,'rb') as stream: return stream.read()
    def digest(value): return hashlib.sha256(value).hexdigest()
    def describe(value): return dict(codepoints=[ord(c) for c in value])
    probe_raw=raw(probe_path); module_raw=raw(module_path)
    source=probe_raw.decode('utf-8','strict')
    # Load only the original imports and the two original loader functions. No
    # start definition/body or native entry can execute. No copied implementation.
    boundary='\ndef start():'
    check(source.count(boundary)==1,'Native entry boundary missing/ambiguous')
    prefix=source.split(boundary,1)[0]
    tree=ast.parse(prefix,probe_path)
    check(all(isinstance(n,(ast.Expr,ast.Import,ast.FunctionDef)) for n in tree.body),'Unexpected top-level loader code')
    check([n.name for n in tree.body if isinstance(n,ast.FunctionDef)]==['sha','load_fixed'],'Loader functions differ')
    check([a.name for n in tree.body if isinstance(n,ast.Import) for a in n.names]==['os','sys','json','hashlib','datetime','traceback'],'Unexpected loader import')
    namespace=dict(__name__='offline_actual_loader',__file__=probe_path)
    eval(compile(prefix,probe_path,'exec'),namespace,namespace)
    load=namespace['load_fixed']
    # Full native entry is compiled separately, never executed.
    case('full probe parses without executing start',lambda:compile(source,probe_path,'exec'))
    loaded=load(module_path,digest(module_raw),'offline_session_helpers')
    def chinese_constants():
        observations['constants']=[describe(x) for x in loaded['COMMENTS']]
        observations['expectedConstants']=[describe(x) for x in EXPECTED]
        observations['rawByteMojibake']=[x==e.encode('utf-8').decode('latin-1') for x,e in zip(loaded['COMMENTS'],EXPECTED)]
        check(loaded['COMMENTS']==EXPECTED,'Both Chinese constants must match independent Unicode codepoints')
    case('actual loader preserves both Chinese constants',chinese_constants)
    def concatenation():
        actual=u'(* \u539f\u59cb *)\r\n'+loaded['COMMENTS'][0]+u'\r\n'+loaded['COMMENTS'][1]+u'\r\n'
        expected=u'(* \u539f\u59cb *)\r\n'+EXPECTED[0]+u'\r\n'+EXPECTED[1]+u'\r\n'
        observations['concatenation']=describe(actual); observations['expectedConcatenation']=describe(expected)
        check(actual==expected,'Concatenated Chinese text differs from independent expected codepoints')
    case('loaded constants concatenate without changing codepoints',concatenation)
    def real_namespace():
        check(loaded['__name__']=='offline_session_helpers' and loaded['__file__']==module_path,'Namespace identity differs')
        check(loaded['canonical']({'value':EXPECTED[0]})==json.dumps({'value':EXPECTED[0]},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8'),'Real helper global/function resolution differs')
    case('complete real helper keeps filename and global namespace',real_namespace)
    def fixture(name, content):
        path=os.path.join(root,name+'.py')
        with open(path,'wb') as stream: stream.write(content)
        return path,digest(content)
    def namespace_calls():
        content=(u'# -*- coding: utf-8 -*-\r\nVALUE = u"\u4e2d\u6587"\r\n'
                 u'def inner(): return VALUE\r\ndef outer(): return inner() + u"\u7ed3\u679c"\r\n').encode('utf-8')
        path,expected=fixture('namespace',content); result=load(path,expected,'synthetic_named_module')
        check(result['outer']()==u'\u4e2d\u6587\u7ed3\u679c','Cross-function globals/Chinese changed')
        check(result['__name__']=='synthetic_named_module' and result['__file__']==path,'Synthetic namespace differs')
    case('CRLF helper functions share the intended global namespace',namespace_calls)
    def one_read():
        first=b"VALUE = 'verified-buffer'\n"; second=b"VALUE = 'changed-after-read'\n"
        path,expected=fixture('read-once',first); counts=dict(open=0,read=0)
        def tracked_open(requested,mode):
            check(requested==path and mode=='rb','Unexpected module read')
            counts['open']+=1; handle=open(requested,mode)
            class Reader(object):
                def __enter__(self):return self
                def __exit__(self,*ignored):handle.close()
                def read(self):
                    counts['read']+=1; data=handle.read(); handle.close()
                    with open(path,'wb') as replacement: replacement.write(second)
                    return data
            return Reader()
        namespace['open']=tracked_open
        try: result=load(path,expected,'one_buffer')
        finally: del namespace['open']
        observations['singleRead']=dict(counts=counts,value=result['VALUE'],originalSha256=expected,changedFileSha256=digest(raw(path)))
        check(counts==dict(open=1,read=1) and result['VALUE']=='verified-buffer','Hash and compile must use one raw buffer')
    case('hash and compile use the same single read despite subsequent file change',one_read)
    def rejection(kind):
        marker=os.path.join(root,kind+'.executed')
        body=("with open(%r, 'wb') as sentinel: sentinel.write(b'body-ran')\n"%marker).encode('ascii')
        if kind=='invalid-utf8': body+=b"VALUE = u'\xff'\n"
        path,expected=fixture(kind,body)
        if kind=='fingerprint':expected='0'*64
        error=None
        try:load(path,expected,'must_not_execute')
        except Exception as exc:error=exc
        observations[kind]=dict(exceptionType=type(error).__name__ if error else None,bodyExecuted=os.path.exists(marker))
        check(not os.path.exists(marker),'Rejected module body executed')
        if kind=='fingerprint':check(isinstance(error,ValueError) and path in str(error),'Fingerprint mismatch must retain filename')
        else:check(isinstance(error,UnicodeDecodeError),'Malformed UTF-8 must raise strict decoding error')
    for kind in ('fingerprint','invalid-utf8'):
        case(kind+' rejects before module body executes',lambda kind=kind:rejection(kind))
    def compile_filename():
        path,expected=fixture('syntax-error',b'def incomplete(:\n')
        try:load(path,expected,'syntax_failure')
        except SyntaxError as exc:
            check(exc.filename==path,'Original compile filename lost');return
        raise AssertionError('Syntax error accepted')
    case('compile error preserves original module filename',compile_filename)
    def execution_error():
        path,expected=fixture('first-error',b"raise ValueError('first helper error')\n")
        try:load(path,expected,'runtime_failure')
        except ValueError as exc:
            check(str(exc)=='first helper error','First helper exception changed')
            check(path in traceback.format_exc(),'Original traceback filename lost');return
        raise AssertionError('Helper exception suppressed')
    case('first helper execution exception and filename are preserved',execution_error)
    def missing_file():
        path=os.path.join(root,'not-created.py')
        try:load(path,'0'*64,'missing')
        except (IOError,OSError):return
        raise AssertionError('Missing file accepted')
    case('missing module stops loading',missing_file)
    result=dict(passed=all(c['passed'] for c in cases),count=len(cases),cases=cases,observations=observations,
                runtime=sys.version,probePath=probe_path,probeSha256=digest(probe_raw),modulePath=module_path,moduleSha256=digest(module_raw),
                actualLoaderCalled=True,nativeEntryExecuted=False,engineeringCalls=0)
    # Keep generated sentinels for review; no recursive deletion or native files.
    result['syntheticFixtureDirectory']=root
    return json.dumps(result,ensure_ascii=True)

if __name__=='__main__':
    result=run_cases_json(sys.argv[1],sys.argv[2]);print(result)
    if not json.loads(result)['passed']:sys.exit(1)
