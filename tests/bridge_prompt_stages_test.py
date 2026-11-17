"""Production worker lifecycle under controlled native UI/thread substitutes; no IDE."""
import ast
import datetime
import importlib.util
import json
import os
import sys
import tempfile
import threading
import types
import unittest
import hashlib
from pathlib import Path

SOURCE=Path('bridge/worker.py')
TREE=ast.parse(SOURCE.read_text(encoding='utf-8'))
NAMES={'lifecycle_state','configure_prompt','lifecycle_open','lifecycle_close',
       'lifecycle_save_reopen','lifecycle_call','native_marker_evidence','exception_evidence'}
FUNCTIONS=ast.Module(body=[n for n in TREE.body if
    isinstance(n,ast.FunctionDef) and n.name in NAMES or
    isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PROMPT_COMMAND_STAGES' for t in n.targets)],
    type_ignores=[])

spec=importlib.util.spec_from_file_location('library_info_prompt',Path('bridge/library_info_prompt.py'))
prompt=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prompt)
prompt.unicode=str

class NativeThread:
    def __init__(self,callback):self.thread=threading.Thread(target=callback,daemon=True)
    def Start(self):self.thread.start()
    def Join(self,millis):
        self.thread.join(millis/1000.0)
        return not self.thread.is_alive()

class Backend:
    def __init__(self):
        self.pid=201;self.birth='2026-11-17T00:00:00Z'
        self.event=threading.Event();self.calls=[];self.visible=True
    def identity_matches(self):return True
    def dialogs(self):
        return [{'handle':41,'body':prompt.MESSAGE,'button':u'确定'}] if self.visible else []
    def confirm(self,dialog):
        self.calls.append(dialog['handle']);self.visible=False;self.event.set()
    def remains(self,handle):return self.visible

class Handle:
    def __init__(self):self.saves=self.closes=0
    def save(self):self.saves+=1
    def close(self):self.closes+=1

class BridgePromptStages(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.project=os.path.join(self.temp.name,'sample.project')
        self.ipc=os.path.join(self.temp.name,'ipc','op-test')
        os.makedirs(self.ipc)
        os.makedirs(os.path.join(self.temp.name,'operations'))
        self.write_operation('running')
        self.events=[];self.backends=[];self.handles=[];self.open_count=0
        self.old_modules={name:sys.modules.get(name) for name in ('System','System.Threading','library_info_prompt')}
        self.addCleanup(self.restore_modules)
        system=types.ModuleType('System');system.__path__=[]
        sub=types.ModuleType('System.Threading');sub.Thread=NativeThread;sub.ThreadStart=lambda cb:cb
        sys.modules.update({'System':system,'System.Threading':sub,'library_info_prompt':prompt})
        def backend_factory():
            result=Backend();self.backends.append(result);return result
        prompt.WindowsDialogBackend=backend_factory
        def native_open(path,primary=True):
            self.open_count+=1
            backend=self.backends[-1] if self.backends else None
            if backend and not backend.event.wait(2):raise RuntimeError('native open remained blocked')
            handle=Handle();self.handles.append(handle);return handle
        self.env={'os':os,'datetime':datetime,'threading':threading,'unicode':str,'text':str,
                  'projects':types.SimpleNamespace(open=native_open),
                  'library_info_prompt':prompt,'phase_event':lambda stage,status:self.events.append((stage,status)),
                  'publish':lambda path,row:self.events.append(row),
                  'failure':lambda status,code,message:{'status':status,'error':{'code':code,'message':message}},
                  'json':json,'sha':lambda value:hashlib.sha256(value.encode('utf8')).hexdigest(),
                  'encode':lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True),
                  '_phase_directory':self.ipc,'_phase_operation_id':'op-test'}
        exec(compile(FUNCTIONS,str(SOURCE),'exec'),self.env)

    def write_operation(self,status):
        value={'operationId':'op-test','status':status,'bridge':{'directory':self.ipc}}
        serialized=json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True)
        record={'schemaVersion':1,'checksum':hashlib.sha256(serialized.encode('utf8')).hexdigest(),'value':value}
        with open(os.path.join(self.temp.name,'operations','op-test.json'),'w') as stream:json.dump(record,stream)

    def restore_modules(self):
        for name,previous in self.old_modules.items():
            if previous is None:sys.modules.pop(name,None)
            else:sys.modules[name]=previous

    def configure(self,command,stages):
        state=self.env['lifecycle_state'](project_path=self.project)
        req={'command':command,'fileGuard':{'mode':'direct'},'promptPolicy':'library-info-open-stages-v2',
             'promptStages':stages,'promptDeadlineUtc':(datetime.datetime.utcnow()+datetime.timedelta(seconds=5)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')}
        self.assertIsNone(self.env['configure_prompt'](state,req))
        return state

    def test_save_reopen_observes_both_stages_once_without_competing_threads(self):
        state=self.configure('resolve_placeholder',['initial-open','reopen'])
        self.env['lifecycle_open'](state,self.project)
        self.env['lifecycle_save_reopen'](state)
        self.env['lifecycle_close'](state,'final-cleanup')
        self.assertEqual(self.open_count,2)
        self.assertEqual([x.calls for x in self.backends],[[41],[41]])
        self.assertEqual(state['promptConfirmedStages'],{'initial-open','reopen'})
        self.assertEqual([x['stage'] for x in self.events if isinstance(x,dict) and x['action']=='confirmation-sent'],
                         ['initial-open','reopen'])
        self.assertEqual([x['stage'] for x in self.events if isinstance(x,dict) and x['action']=='observer-stopped'],
                         ['initial-open','reopen'])
        self.assertEqual(self.handles[0].saves,1)
        self.assertEqual([x.closes for x in self.handles],[1,1])
        with self.assertRaisesRegex(ValueError,'refusing another observer'):
            self.env['lifecycle_open'](state,self.project,'reopen')
        self.assertEqual(self.open_count,2)

    def test_mismatched_or_unowned_scope_rejects_before_native_open(self):
        for command,stages,mode in [('catalog',['initial-open'],'direct'),
                                    ('read',['initial-open','reopen'],'direct'),
                                    ('read',['initial-open'],'copy')]:
            state=self.env['lifecycle_state'](project_path=self.project)
            result=self.env['configure_prompt'](state,{'command':command,'fileGuard':{'mode':mode},
                 'promptPolicy':'library-info-open-stages-v2','promptStages':stages,
                 'promptDeadlineUtc':'2026-11-17T00:00:00.000Z'})
            self.assertEqual(result['error']['code'],'PROMPT_SCOPE')
        self.assertEqual(self.open_count,0)

    def test_expired_deadline_does_not_confirm(self):
        state=self.env['lifecycle_state'](project_path=self.project)
        req={'command':'inspect','fileGuard':{'mode':'direct'},'promptPolicy':'library-info-open-stages-v2',
             'promptStages':['initial-open'],'promptDeadlineUtc':'2000-01-01T00:00:00.000Z'}
        self.assertIsNone(self.env['configure_prompt'](state,req))
        with self.assertRaisesRegex(RuntimeError,'remained blocked'):
            self.env['lifecycle_open'](state,self.project)
        self.assertEqual(self.backends[0].calls,[])
        self.assertEqual(self.open_count,1)

    def test_unknown_operation_stops_before_confirmation(self):
        self.write_operation('unknown')
        state=self.configure('inspect',['initial-open'])
        with self.assertRaisesRegex(RuntimeError,'remained blocked'):
            self.env['lifecycle_open'](state,self.project)
        self.assertEqual(self.backends[0].calls,[])
        self.assertIn('operation-not-running',[x['action'] for x in self.events if isinstance(x,dict)])

    def test_unconfirmed_observer_shutdown_stops_following_open(self):
        class UnjoinedThread:
            def __init__(self,callback):self.IsBackground=False
            def Start(self):pass
            def Join(self,millis):return False
        sys.modules['System.Threading'].Thread=UnjoinedThread
        self.env['projects'].open=lambda path,primary=True:Handle()
        state=self.configure('save',['initial-open','reopen'])
        with self.assertRaisesRegex(ValueError,'did not stop'):
            self.env['lifecycle_open'](state,self.project)
        self.assertTrue(state['promptObserverUnconfirmed'])
        self.assertTrue(state['closeUnconfirmed'])
        self.assertIsNotNone(state['project'])
        self.assertIn('observer-stop-unconfirmed',[x['action'] for x in self.events if isinstance(x,dict)])
        with self.assertRaisesRegex(ValueError,'Refusing to replace an owned open project'):
            self.env['lifecycle_open'](state,self.project,'reopen')
        self.env['lifecycle_close'](state,'final-cleanup')

if __name__=='__main__':unittest.main()
