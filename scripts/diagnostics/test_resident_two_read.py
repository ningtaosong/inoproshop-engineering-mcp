# -*- coding: utf-8 -*-
"""Audited definitions/substitutes only; no OEM entry or project is executed."""
import os
import sys
import ast
import json
import hashlib
import datetime
import traceback
import tempfile
import shutil


def definitions():
    file = os.path.join(os.path.dirname(__file__), 'resident_two_read_probe.py')
    with open(file, 'rb') as stream:
        tree = ast.parse(stream.read(), file)
    tree.body = [item for item in tree.body if isinstance(item, (ast.FunctionDef, ast.ClassDef))]
    scope = dict(os=os,sys=sys,json=json,hashlib=hashlib,datetime=datetime,traceback=traceback,
                 _root=None,_binding={},_ordinal=0,_first_error=None,_secondary_errors=[],_controller=None,
                 BLOCKED=(('ScriptEngine.plugin','_3S.CoDeSys.ScriptEngine.ScriptExecutor','Execute'),))
    try:scope['unicode']=unicode
    except NameError:scope['unicode']=str
    eval(compile(tree,file+':definitions-only','exec'),scope,scope)
    return scope


def run_cases_json():
    cases=[]
    def check(value):
        if not value:raise AssertionError('Expectation failed')
    def case(name,fn):
        try:fn();cases.append(dict(name=name,passed=True))
        except Exception:cases.append(dict(name=name,passed=False,error=traceback.format_exc()))
    def rejects(fn):
        try:fn()
        except (ValueError,IOError):return
        raise AssertionError('Expected rejection')
    root=tempfile.mkdtemp(prefix='two-read-offline-')
    try:
        n=definitions();n['_root']=root
        intent=dict(requestIds=['first','second'],launchId='launch',scriptSha256='s'*64)
        value=dict(schemaVersion=1,command='empty-project-status',sequence=1,requestId='first',launchId='launch',scriptSha256='s'*64,previousResultSha256=None)
        case('first fixed request',lambda:check(n['request_view'](value,intent,1,None)==value))
        for key,bad in [('command','prepare'),('sequence',True),('sequence',2),('requestId','other'),('launchId','other'),('scriptSha256','changed'),('schemaVersion',True),('previousResultSha256','wrong')]:
            case('reject '+key+' '+str(bad),lambda k=key,b=bad:rejects(lambda:n['request_view'](dict(value,**{k:b}),intent,1,None)))
        case('reject extra field',lambda:rejects(lambda:n['request_view'](dict(value,code='no evaluation'),intent,1,None)))
        case('duplicate JSON field',lambda:rejects(lambda:json.loads('{"a":1,"a":2}',object_pairs_hook=n['unique_pairs'])))
        n['publish']('chinese.json',dict(text=u'中文结果'))
        case('UTF-8 result roundtrip',lambda:check(n['read_json'](os.path.join(root,'chinese.json'))==dict(text=u'中文结果')))
        case('immutable publication',lambda:rejects(lambda:n['publish']('chinese.json',dict(text=u'新值'))))
        with open(os.path.join(root,'large.json'),'wb') as f:f.write(b' ' * 16385)
        case('request size bounded',lambda:rejects(lambda:n['read_json'](os.path.join(root,'large.json'))))
        state=dict(thread=1,mainHandle='12',frameIdentity=dict(path='frame',mvid='m',type='main'),startupFramesPresent=False)
        for key,bad in [('thread',2),('mainHandle','13'),('frameIdentity',dict(path='other'))]:
            case('native identity '+key,lambda k=key,b=bad:rejects(lambda:n['stable_identity'](state,dict(state,**{k:b}))))
        case('same native context',lambda:n['stable_identity'](state,dict(state)))
        def receiver(failure=None):
            d=os.path.join(root,'r'+str(len(cases)));os.mkdir(d)
            s=definitions();s['_root']=d;s['_binding']=dict(pid=1,startId='start')
            p=s['TwoReadProbe'](intent);s['_controller']=p;p.first_state=state;p.admission=lambda:None
            calls=[]
            def read():
                calls.append('read')
                if failure=='native':raise ValueError('first native error')
                return dict(state,startupFramesPresent=(failure=='startup'))
            p.on_primary=read
            s['publish']('request-1.json',value)
            if failure=='publication':s['publish']=lambda name,value:(_ for _ in ()).throw(IOError('publish failed'))
            if failure=='result-publication':
                original=s['publish']
                def broken_result(name,value):
                    if name.startswith('result-'):raise IOError('result publication failed')
                    return original(name,value)
                s['publish']=broken_result
            if failure=='stop':p.admission=lambda:(_ for _ in ()).throw(ValueError('stopped'))
            if failure:
                try:p.service_request(1)
                except Exception as error:s['fail']('receiver',error)
                else:raise AssertionError('Failure accepted')
                check(p.completed==0 and s['_first_error'] is not None)
                check(len(calls)==(0 if failure in ('stop','publication') else 1))
                first=s['_first_error'];s['fail']('secondary',ValueError('later'));check(s['_first_error']==first)
                return
            p.service_request(1)
            rejects(lambda:p.service_request(1))
            second=dict(value,sequence=2,requestId='second',previousResultSha256=p.prior_hash)
            s['publish']('request-2.json',second);p.service_request(2)
            check(p.completed==2 and len(calls)==2)
            rejects(lambda:p.service_request(3))
            check(s['read_json'](os.path.join(d,'result-2.json'))['request']['previousResultSha256']==s['sha_file'](os.path.join(d,'result-1.json')))
        case('actual receiver definitions two ordered independent results',receiver)
        for failure in ('native','startup','publication','result-publication','stop'):
            case('receiver stops preserves first '+failure,lambda f=failure:receiver(f))
        def callback_failure():
            s=definitions();p=s['TwoReadProbe'](intent)
            class System(object):
                def execute_on_primary_thread(self,fn):fn()
            s['system']=System()
            p.capture=lambda:(_ for _ in ()).throw(ValueError('original callback'))
            rejects(p.on_primary);check('original callback' in p.callback_error['traceback'])
        case('native callback exception origin retained',callback_failure)
        def initialization_error(recorder=False):
            s=definitions();d=os.path.join(root,'init'+str(len(cases)));os.mkdir(d);s['_root']=d
            p=s['TwoReadProbe'](intent);s['_controller']=p
            class Current(object):ManagedThreadId=1
            class Thread(object):CurrentThread=Current()
            s['Thread']=Thread
            p.capture=lambda:(_ for _ in ()).throw(ValueError('original initialization failure'))
            if recorder:s['record']=lambda *args,**kwargs:(_ for _ in ()).throw(IOError('recorder failed first'))
            p.initialize() # must not throw into the OEM primary-thread wrapper
            check(not p.initialization_complete and p.background is None and s['_first_error'] is not None)
            message='recorder failed first' if recorder else 'original initialization failure'
            check(message in p.callback_error['traceback'] and message in s['_first_error']['message'])
            first=s['_first_error'];s['fail']('outer',ValueError('native wrapper'));check(first==s['_first_error'])
        case('initialization callback preserves original before native wrapper',initialization_error)
        case('initialization recorder failure stops receiver',lambda:initialization_error(True))
        def clr_chain_fake(broken=False,cycle=False):
            class Native(object):
                Message='outer';StackTrace='stack';InnerException=None
                def GetType(self):
                    class Kind(object):FullName='PublicException'
                    return Kind()
                def ToString(self):
                    if broken:raise ValueError('evidence read failed')
                    return self.Message+' -> inner'
            error=ValueError('original');error.clsException=Native();inner=Native();inner.Message='inner'
            error.clsException.InnerException=error.clsException if cycle else inner
            v=n['exception_detail'](error)
            check(v['message']=='original' and bool(v['evidenceErrors'])==(broken or cycle))
            if not cycle:check([x['message'] for x in v['clrChain']]==['outer','inner'])
        case('public CLR chain retained',clr_chain_fake)
        case('CLR detail failure does not replace first exception',lambda:clr_chain_fake(broken=True))
        case('CLR cyclic chain bounded and marked incomplete',lambda:clr_chain_fake(cycle=True))
        def admission(expired=False,foreign=False,stop=False):
            s=definitions();d=os.path.join(root,'a'+str(len(cases)));os.mkdir(d);s['_root']=d
            p=s['TwoReadProbe'](intent)
            s['publish']('native-admission.json',dict(launchId='wrong' if foreign else 'launch',scriptSha256='s'*64,
                deadlineUtc=(datetime.datetime.utcnow()+datetime.timedelta(seconds=-1 if expired else 60)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')))
            if stop:s['publish']('observer-stop.json',dict(reason='timeout'))
            if expired or foreign or stop:rejects(p.admission)
            else:p.admission()
        case('fixed admission',admission)
        case('expired admission',lambda:admission(expired=True))
        case('foreign admission',lambda:admission(foreign=True))
        case('parent stops admission',lambda:admission(stop=True))
        def capture_test(change=None):
            class Obj(object):
                def __init__(self,**items):self.__dict__.update(items)
            s=definitions();p=s['TwoReadProbe'](dict(intent,frameIdentity=dict(path='frame',mvid='m',type='_3S.CoDeSys.Frame.MainForm')))
            p.primary_thread=1
            assembly=Obj(Location='frame',ManifestModule=Obj(ModuleVersionId='m'))
            kind=Obj(FullName='_3S.CoDeSys.Frame.MainForm',Assembly=assembly)
            main=Obj(GetType=lambda:kind,IsDisposed=False,InvokeRequired=False,Enabled=True,Visible=True,Modal=False,Handle=Obj(ToInt64=lambda:12))
            auxiliary=Obj(GetType=lambda:Obj(FullName='OtherNonmodal'),Visible=False,Modal=False)
            forms=[main,auxiliary]
            method=Obj(Name='Callback',DeclaringType=Obj(FullName='Public'),Module=Obj(Assembly=Obj(GetName=lambda:Obj(Name='public'))))
            s.update(Thread=Obj(CurrentThread=Obj(ManagedThreadId=1)),system=Obj(ui_present=True),projects=Obj(primary=None,all=[]),Application=Obj(OpenForms=forms),StackTrace=lambda ignored:Obj(GetFrames=lambda:[Obj(GetMethod=lambda:method)]))
            if change=='modal':auxiliary.Visible=True;auxiliary.Modal=True
            if change=='duplicate-main':forms.append(main)
            if change=='project':s['projects'].primary=Obj()
            if change=='disabled':main.Enabled=False
            if change=='thread':s['Thread'].CurrentThread.ManagedThreadId=2
            if change=='frame':assembly.Location='changed'
            if change=='startup':
                method.Name='Execute';method.DeclaringType.FullName='_3S.CoDeSys.ScriptEngine.ScriptExecutor';method.Module.Assembly.GetName=lambda:Obj(Name='ScriptEngine.plugin')
            if change in ('modal','duplicate-main','project','disabled','thread','frame'):rejects(p.capture)
            else:
                result=p.capture();check(len(result['forms'])==2 and result['startupFramesPresent']==(change=='startup'))
        case('actual capture allows extra nonmodal hidden form',capture_test)
        for change in ('modal','duplicate-main','project','disabled','thread','frame','startup'):
            case('actual capture '+change,lambda c=change:capture_test(c))
        def no_business():
            file=os.path.join(os.path.dirname(__file__),'resident_two_read_probe.py')
            with open(file,'rb') as f:tree=ast.parse(f.read())
            called=[x.func.attr for x in ast.walk(tree) if isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute)]
            check(not set(called).intersection(('save','create','compile','set_redirection','execute','exit','Close','kill')))
            check(not any(isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and isinstance(x.func.value,ast.Name) and x.func.value.id=='projects' for x in ast.walk(tree)))
        case('native source has no engineering or exit methods',no_business)
        def same_publisher():
            def method(file):
                with open(os.path.join(os.path.dirname(__file__),file),'rb') as stream:tree=ast.parse(stream.read())
                return ast.dump(next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='publish'))
            check(method('native_idle_probe.py')==method('resident_two_read_probe.py'))
        case('publisher AST unchanged from existing IronPython evidence writer',same_publisher)
        if sys.platform=='cli':
            def clr_delegate():
                from System.Threading import Thread,ThreadStart
                called=[];delegate=ThreadStart(lambda:called.append('bound'))
                delegate.Invoke();check(called==['bound'])
                t=Thread(delegate);t.IsBackground=True
                check(t.IsBackground) # never start the thread/IDE in this binding test
            case('installed CLR background delegate binding',clr_delegate)
            def actual_clr_chain():
                from System import InvalidOperationException, Exception as ClrException
                try:raise InvalidOperationException('native outer',ClrException('native inner'))
                except Exception as error:
                    detail=n['exception_detail'](error)
                    check(detail['clrChainComplete'] and len(detail['clrChain'])>=2)
                    check(detail['clrChain'][0]['message']=='native outer' and detail['clrChain'][1]['message']=='native inner')
            case('installed CLR actual inner exception chain',actual_clr_chain)
    finally:shutil.rmtree(root)
    return json.dumps(dict(passed=all(c['passed'] for c in cases),count=len(cases),cases=cases,nativeHostStarted=False,nativeEntryExecuted=False,projectOperations=0))


if __name__=='__main__':
    result=run_cases_json();print(result)
    if not json.loads(result)['passed']:sys.exit(1)
