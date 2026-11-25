# -*- coding: utf-8 -*-
"""Execute audited definitions with substitutes; NEVER execute native script entry."""
import os
import sys
import ast
import json
import hashlib
import datetime
import traceback
import tempfile
import shutil
import imp
from native_idle_policy import IdlePolicy, BLOCKED_FRAMES


def read_bytes(file):
    with open(file,'rb') as stream:
        return stream.read()


def definitions():
    source = os.path.join(os.path.dirname(__file__), 'native_idle_probe.py')
    tree = ast.parse(read_bytes(source), source)
    tree.body = [x for x in tree.body if isinstance(x, (ast.FunctionDef, ast.ClassDef))]
    # No import, entry Try, or project/native global is executed here.
    scope = dict(os=os, sys=sys, json=json, hashlib=hashlib, datetime=datetime,
                 traceback=traceback, imp=imp, _ordinal=0, _first_error=None,
                 _binding={}, _controller=None, _secondary_errors=[])
    try: scope['unicode'] = unicode
    except NameError: scope['unicode'] = str
    eval(compile(tree, source + ':definitions-only', 'exec'), scope, scope)
    return scope


def run_cases_json():
    records = []
    def case(name, function):
        try:
            function()
            records.append(dict(name=name, passed=True))
        except Exception:
            records.append(dict(name=name, passed=False, error=traceback.format_exc()))
    def check(value):
        if not value: raise AssertionError('Condition not met')
    clear = [dict(assembly='System.Windows.Forms', type='Application', method='OnThreadIdle')]
    def policy(kind='idle', tail=True, busy=False, frames=None, empty=True, same=True, elapsed=1):
        p=IdlePolicy();p.tail_seen=tail
        return p, p.sample(kind,elapsed,busy,clear if frames is None else frames,empty,same)
    case('candidate only after tail on natural Idle',lambda:check(policy()[1]=='candidate'))
    case('timer never dispatches',lambda:check(policy(kind='timer')[1]=='observe'))
    case('tail absent',lambda:check(policy(tail=False)[1]=='observe'))
    case('busy true',lambda:check(policy(busy=True)[1]=='observe'))
    for assembly, type_name, method in BLOCKED_FRAMES:
        case('blocked '+type_name+'.'+method,lambda a=assembly,t=type_name,m=method:check(policy(frames=[dict(assembly=a,type=t,method=m)])[1]=='observe'))
    for name, kwargs in [('empty stack',dict(frames=[])),('unknown OEM type',dict(frames=[dict(assembly='Frame.plugin',method='X')])),('wrong busy type',dict(busy=None)),('unexpected project',dict(empty=False)),('wrong thread',dict(same=False)),('deadline',dict(elapsed=10000))]:
        case(name,lambda k=kwargs:check(policy(**k)[1]=='stopped'))
    def once():
        p=IdlePolicy();p.reserve_dispatch()
        check(p.sample('idle',1,False,clear,True,True)=='stopped')
        try:p.reserve_dispatch()
        except ValueError:return
        raise AssertionError('Second dispatch accepted')
    case('one-shot even if close cancelled',once)
    def first():
        p=IdlePolicy();p.fail('FIRST','a');p.fail('SECOND','b');check(p.first_error['code']=='FIRST')
    case('first failure sticky',first)
    if sys.platform=='cli':
        def dotnet():
            import clr
            clr.AddReference('System.Windows.Forms')
            from System import Boolean, EventHandler
            from System.Reflection import BindingFlags
            from System.IO import MemoryStream
            from System.Windows.Forms import FormClosingEventHandler, FormClosingEventArgs, CloseReason, Application, Form, Timer
            stream=MemoryStream()
            try:
                prop=stream.GetType().GetProperty('CanRead',BindingFlags.Public|BindingFlags.Instance)
                check(prop.GetGetMethod(False).IsPublic)
                value=prop.GetGetMethod(False).Invoke(stream,None)
                check(isinstance(value,(bool,Boolean)) and bool(value))
                rows=[]
                handler=FormClosingEventHandler(lambda sender,args:rows.append(bool(args.Cancel)))
                handler.Invoke(None,FormClosingEventArgs(getattr(CloseReason,'None'),True))
                check(rows==[True])
                idle=EventHandler(lambda sender,args:None)
                Application.add_Idle(idle)
                Application.remove_Idle(idle)
                check(callable(getattr(Form,'add_FormClosing')) and callable(getattr(Form,'add_FormClosed')))
                timer=Timer()
                try:
                    timer.add_Tick(idle);timer.remove_Tick(idle)
                finally:timer.Dispose()
            finally:stream.Close()
        case('actual CLR public Boolean invocation and WinForms delegate binding, no Form creation',dotnet)
    root=tempfile.mkdtemp(prefix='native-idle-offline-')
    ns=definitions();ns['_root']=root
    binding=dict(operationId='op',requestId='request',launchId='launch',requestFingerprint='hash',scriptSha256='script')
    ns['_binding']=binding
    admission=dict(binding=binding,deadlineUtc=(datetime.datetime.utcnow()+datetime.timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M:%S.%fZ'))
    ns['publish']('native-admission.json',admission)
    try:
        def publish():
            item={'text':u'中文：无工程', 'empty':'', 'null':None, 'literal':'None'}
            ns['publish']('unicode.json',item)
            check(json.loads(read_bytes(os.path.join(root,'unicode.json')).decode('utf-8'))==item)
            check(not os.path.exists(os.path.join(root,'unicode.json.publishing')))
        case('actual publisher Chinese JSON exclusive create and readback',publish)
        def duplicate():
            before=read_bytes(os.path.join(root,'unicode.json'))
            try:ns['publish']('unicode.json',{'changed':True})
            except (OSError,IOError):pass
            else:raise AssertionError('Overwritten')
            check(read_bytes(os.path.join(root,'unicode.json'))==before)
        case('duplicate publication refuses overwrite',duplicate)
        def closed():
            # Windows exclusive read/write handle proves actual publishing fd closed.
            if sys.platform=='cli':
                from System.IO import File,FileMode,FileAccess,FileShare
                f=File.Open(os.path.join(root,'unicode.json'),FileMode.Open,FileAccess.ReadWrite,getattr(FileShare,'None'))
                f.Close()
            else:
                with open(os.path.join(root,'unicode.json'),'ab') as stream: stream.flush()
        case('published file descriptor closed',closed)
        def logging_failure():
            n=definitions();n['_root']=os.path.join(root,'missing')
            class BrokenStderr(object):
                def write(self,*args):raise IOError('stderr failure')
                def flush(self):raise IOError('stderr flush failure')
            class System(object):pass
            output=System();output.stderr=BrokenStderr();n['sys']=output
            n['fail']('primary',ValueError('first exception'))
            n['fail']('secondary',ValueError('second exception'))
            check(n['_first_error']['message']=='first exception')
            check(len(n['_secondary_errors'])>=3)
            check(n['_controller'] is None)
        case('publisher plus stderr failure cannot escape or mask first error',logging_failure)
        def stop_marker():
            ns['publish']('observer-stop.json',{'reason':'timeout','binding':binding})
            try:ns['observer_has_stopped']()
            except ValueError:return
            raise AssertionError('Stop marker ignored')
        case('parent timeout stops native admission',stop_marker)
        def unexpected_project():
            class P(object):primary=object();all=[object()]
            class S(object):ui_present=True
            ns['projects']=P();ns['system']=S()
            try:ns['empty_projects']()
            except ValueError:return
            raise AssertionError('Unexpected project accepted')
        case('actual empty-project function refuses restored project',unexpected_project)
        def dispatcher(stop=False,project=False,logger=False,expired=False,wrong_binding=False):
            n=definitions();n['_root']=os.path.join(root,'dispatch-'+str(len(records)));os.mkdir(n['_root'])
            n['_binding']=dict(binding)
            a=dict(admission)
            if expired:a['deadlineUtc']='2000-01-01T00:00:00.000Z'
            if wrong_binding:a['binding']=dict(binding,launchId='foreign')
            n['publish']('native-admission.json',a)
            n['_intent']={'commandGuid':'caa0ef1f-6563-49ae-b0e0-80095fb233ef'}
            calls=[];events=[]
            class Command(object):
                guid=n['_intent']['commandGuid']
                def execute(self,args):calls.append(args)
            class System(object):commands={n['_intent']['commandGuid']:Command()};ui_present=True
            class Projects(object):primary=None;all=[]
            class Current(object):ManagedThreadId=3
            class Thread(object):CurrentThread=Current()
            class Form(object):InvokeRequired=False
            class Array(object):
                def __getitem__(self,t):return lambda x:x
            n.update(system=System(),projects=Projects(),Thread=Thread,Guid=lambda x:x,Array=Array(),String=str)
            obj=object.__new__(n['Probe']);obj.policy=IdlePolicy();obj.form=Form();obj.primary_thread=3
            obj.stop_sampling=lambda:[];n['_controller']=obj
            def record(stage,**fields):
                if logger:raise IOError('record publication failed')
                events.append((stage,fields))
            n['record']=record
            if stop:n['publish']('observer-stop.json',{'reason':'timeout','binding':binding})
            if project:n['projects'].primary=object()
            try:obj.dispatch()
            except Exception as error:n['fail']('dispatch',error)
            if stop or project or logger or expired or wrong_binding:
                check(len(calls)==0 and n['_first_error'] is not None)
            else:
                check(len(calls)==1 and [x[0] for x in events]==['close-dispatch','close-returned'])
                check(json.loads(read_bytes(os.path.join(n['_root'],'result.json')).decode('utf-8'))['requiresIndependentExit'] is True)
                try:obj.dispatch()
                except ValueError:pass
                else:raise AssertionError('Duplicate accepted')
                check(len(calls)==1)
        case('actual dispatch once with immediate empty-project check',dispatcher)
        case('actual dispatch stops on parent timeout',lambda:dispatcher(stop=True))
        case('actual dispatch stops on unexpected project',lambda:dispatcher(project=True))
        case('actual dispatch stops on evidence publication failure',lambda:dispatcher(logger=True))
        case('late entry/Idle cannot reset fixed parent deadline',lambda:dispatcher(expired=True))
        case('foreign parent admission binding rejects',lambda:dispatcher(wrong_binding=True))
    finally:
        shutil.rmtree(root)
    return json.dumps(dict(passed=all(x['passed'] for x in records), count=len(records), cases=records,
                          nativeHostStarted=False, nativeEntryExecuted=False, projectOperations=0))


if __name__=='__main__':
    value=run_cases_json();print(value)
    if not json.loads(value)['passed']:sys.exit(1)
