"""Production task-config functions with native API doubles; never real IDE evidence."""
import ast,copy,hashlib,json,os,re,sys,types,unittest
from pathlib import Path
from types import SimpleNamespace as S

class Task:
    def __init__(self):
        self.guid='task';self.is_task=True;self.actions=[];self.fail_field=None
        self.raw=dict(kind_of_task='Cyclic',interval='t#20ms',interval_unit='ms',priority='1',core_binding='-2',event='',external_event='',event_pou_guid='event-guid',parent_synchron_task='')
    def __getattr__(self,name):return self.raw[name]
    def __setattr__(self,name,value):
        if name in ('priority','interval'):
            if not isinstance(value,str):raise TypeError('Native setter requires str')
            self.actions.append((name,value));self.raw[name]=value
            if self.fail_field==name:raise RuntimeError('Setter may have changed before throwing')
        else:object.__setattr__(self,name,value)

class NativeTask(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
        self.e=dict(unicode=str,long=int,hashlib=hashlib,json=json,os=os,re=re,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'bridge/worker.py','exec'),self.e)
        self.task=Task();self.events=[];self.saved=0;self.stage=None;self.readonly=False;self.bad_read=False;self.disk='disk'
        self.p=S(path='test.project');self.state={'project':self.p}
        self.inv=dict(projectId='project',applicationId='app',projectPath='test.project',targetKind='application',applicationPath=['Application'],tasks=[],programs=[],resolutionReadFailures=[],enumerationFailures=[],coverageComplete=True)
        def inventory(p,a):
            d=copy.deepcopy(self.inv);d['tasks']=[dict(taskId='task',path=['Application','Tasks','MainTask'],rawFields=dict(self.task.raw),watchdog=dict(enabled='False',time='',time_unit='ms',sensitivity='1'),rawCalls=[['PLC_PRG','']],callsComplete=True,unavailableFields=[])]
            if self.bad_read and self.task.actions:d['tasks'][0]['rawCalls']=[['Other','']]
            return d
        self.inventory=inventory
        def reopen(state):
            self.saved+=1
            if self.stage:raise RuntimeError('Injected '+self.stage+' failure')
            return self.p
        self.e.update(task_inventory=inventory,walk=lambda p:iter([(self.task,['Application','Tasks','MainTask'],'app')]),snapshot=lambda p:'ST-unchanged',
            file_hash=lambda p:self.disk,shutil=S(copyfile=lambda *a:self.events.append('checkpoint')),publish=lambda p,v:self.events.append((p,copy.deepcopy(v))),lifecycle_save_reopen=reopen)
        io=types.ModuleType('System.IO');io.File=S(GetAttributes=lambda p:1 if self.readonly else 0);io.FileAttributes=S(ReadOnly=1)
        io.FileStream=lambda *a:S(Dispose=lambda:None);io.FileMode=S(Open=1);io.FileAccess=S(ReadWrite=1);io.FileShare=S(ReadWrite=1)
        self.old={k:sys.modules.get(k) for k in ('System','System.IO')};sys.modules['System']=types.ModuleType('System');sys.modules['System.IO']=io
        self.a=dict(projectId='project',applicationId='app',targetKind='application',taskId='task',expectedDiskHash='disk',expectedTaskVersion=self.e['task_configuration_version'](inventory(self.p,{})))
        self.req=dict(projectPath='test.project',checkpointPath='checkpoint.project',resultPath='ipc/result.json')
    def tearDown(self):
        for k,v in self.old.items():
            if v is None:sys.modules.pop(k,None)
            else:sys.modules[k]=v
    def call(self,**patch):return self.e['task_config_update'](self.p,self.req,dict(self.a,**patch),self.state)[0]
    def test_native_string_units_and_priority_zero_and_preserved_fields(self):
        r=self.call(intervalMs=10,priority=0);self.assertEqual(r['status'],'succeeded',r)
        self.assertEqual(self.task.actions,[('interval','t#10ms'),('priority','0')]);self.assertEqual(self.saved,1)
        self.assertEqual(r['data']['after']['tasks'][0]['rawCalls'],[['PLC_PRG','']]);self.assertEqual(r['data']['after']['tasks'][0]['rawFields']['core_binding'],'-2')
    def test_noop_never_sets_or_saves_or_checkpoints(self):
        r=self.call(intervalMs=20,priority=1);self.assertEqual(r['status'],'succeeded');self.assertFalse(r['data']['changed']);self.assertEqual(self.task.actions,[]);self.assertEqual(self.saved,0);self.assertEqual(self.events,[])
    def test_decimal_native_interval_requires_ms_and_preserves_noop_text(self):
        self.task.raw['interval']='20';self.a['expectedTaskVersion']=self.e['task_configuration_version'](self.inventory(self.p,{}))
        r=self.call(intervalMs=20);self.assertEqual(r['status'],'succeeded');self.assertFalse(r['data']['changed']);self.assertEqual(self.task.actions,[])
        r=self.call(intervalMs=10);self.assertEqual(r['status'],'succeeded');self.assertEqual(self.task.actions,[('interval','t#10ms')])
        for raw,unit in [('20','us'),('20',''),('t#20us','ms'),('20+1','ms'),('20ms','ms')]:self.assertIsNone(self.e['configured_interval_ms'](dict(interval=raw,interval_unit=unit)))
    def test_invalid_patch_and_versions_reject_before_setter(self):
        for patch in [dict(intervalMs=0),dict(priority=32),dict(priority=True),dict(priority='12'),dict(priority=12,calls=[]),dict(priority=12,expectedTaskVersion='old'),dict(priority=12,expectedDiskHash='changed')]:
            with self.subTest(patch=patch):self.assertNotEqual(self.call(**patch)['status'],'succeeded')
        self.assertEqual(self.task.actions,[]);self.assertEqual(self.saved,0)
    def test_readonly_rejects_before_setter(self):
        self.readonly=True;self.assertEqual(self.call(priority=12)['error']['code'],'TASK_PROJECT_READ_ONLY');self.assertEqual(self.task.actions,[])
    def test_partial_second_setter_failure_is_unknown_no_automatic_rollback(self):
        self.task.fail_field='priority';r=self.call(intervalMs=10,priority=12);self.assertEqual(r['status'],'unknown');self.assertEqual(self.saved,0);self.assertFalse(r['data']['automaticRollback']);self.assertEqual(self.task.actions,[('interval','t#10ms'),('priority','12')]);self.assertEqual(len(r['data']['actions']),2)
    def test_preserved_call_change_stops_before_save(self):
        self.bad_read=True;r=self.call(priority=12);self.assertEqual(r['status'],'unknown');self.assertEqual(self.saved,0)
    def test_save_close_reopen_errors_have_one_attempt_and_no_rollback(self):
        for stage in ('save','close','reopen'):
            with self.subTest(stage=stage):
                self.stage=stage;self.task.raw['priority']='1';self.a['expectedTaskVersion']=self.e['task_configuration_version'](self.inventory(self.p,{}));n=self.saved;r=self.call(priority=12);self.assertEqual(r['status'],'unknown');self.assertEqual(self.saved,n+1)
    def test_native_and_typescript_configuration_digest_vector(self):
        # ASCII JSON key order and UTF-8 encoding are shared; native values are strings.
        d=self.inventory(self.p,{});d['tasks'][0]['path']=['应用','任务','主任务']
        self.assertEqual(self.e['task_configuration_version'](d),hashlib.sha256(json.dumps(['task-configuration-v1','project','app',d['tasks'],[]],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf8')).hexdigest())

if __name__=='__main__':unittest.main()
