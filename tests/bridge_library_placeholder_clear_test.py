"""Production clear function and guards with offline native API doubles; never an IDE."""
import ast,copy,json,hashlib,os,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace

APP='10000000-0000-4000-8000-000000000001'
MID='40000000-0000-4000-8000-000000000001'
OBJ='20000000-0000-4000-8000-000000000001'
ROOT='50000000-0000-4000-8000-000000000001'
PREFIX=['Device','Plc Logic','Application']

class Native(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.file=Path(self.temp.name)/'fixture.project';self.file.write_bytes(b'prepared fixture')
  self.out={};self.calls=[];self.fault=None;self.captures=0;self.override='CAA Mathematics, 3.5.7.0 (CAA Technical Workgroup)'
  self.effective=None;self.info='device resolution';self.reopened=False
  self.env={'basestring':str,'unicode':str,'text':str,'os':os,'re':__import__('re'),'copy':copy,
   'encode':lambda x:json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')),
   'sha':lambda s:hashlib.sha256(s.encode('utf8')).hexdigest(),
   'file_hash':lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest(),
   'exception_evidence':lambda e:{'type':type(e).__name__,'message':str(e)},
   'failure':lambda status,code,message,data=None:dict(status=status,error=dict(code=code,message=message),data=data),
   'success':lambda summary,data:dict(status='succeeded',summary=summary,data=data)}
  exec(compile(Path('bridge/library_reference.py').read_text(encoding='utf8'),'bridge/library_reference.py','exec'),self.env)
  names={'task_append_call_row','task_create_task_set','task_program_identity_set','task_create_inventory_view','task_call_inventory_view','task_create_difference'}
  tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
  exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'bridge/worker.py','exec'),self.env)
  exec(compile(Path('bridge/library_placeholder_clear.py').read_text(encoding='utf8'),'bridge/library_placeholder_clear.py','exec'),self.env)
  self.real_capture=self.env['clear_capture']
  self.native=SimpleNamespace(id='3880672626',set_redirection=self.set_redirection)
  self.args=dict(projectId=APP,applicationId=APP,managerId=MID,placeholderReferenceId=self.native.id,
   expectedDiskHash=self.env['file_hash'](self.file),expectedExplicitRedirection=self.override,expectedSourceSnapshot='a'*64,maxReferences=2000)
  self.req=dict(projectPath=str(self.file),checkpointPath=str(Path(self.temp.name)/'checkpoint.project'),resultPath=str(Path(self.temp.name)/'result.json'),operationId=APP,requestId='clear-once')
  self.project=SimpleNamespace(path=str(self.file));self.lifecycle={'saveAttempts':0}
  self.env.update(clear_capture=self.capture,publish=self.publish,lifecycle_save_reopen=self.save_reopen)
  before=self.state();self.args.update(expectedReferenceVersion=before['library']['configurationVersion'],expectedPlaceholderVersion=before['library']['placeholderConfigurationVersion'])
 def publish(self,file,value):
  if self.fault=='publication' and 'immediate' in file:raise OSError('first publish error')
  self.out[Path(file).name]=copy.deepcopy(value)
 def set_redirection(self,value):
  self.calls.append(('set_redirection',value));self.override=value
  if self.fault=='setter':raise RuntimeError('first native setter error')
 def save_reopen(self,lifecycle):
  self.calls.append(('save',));lifecycle['saveAttempts']+=1
  if self.fault=='save':raise RuntimeError('first save error')
  self.file.write_bytes(b'clear saved');self.reopened=True;return self.project
 def state(self):
  redirected=self.override is not None
  f=dict(id=self.native.id,name='#CAA Mathematics',namespace='MATH',is_placeholder=True,is_managed=False,system_library=False,
   optional=False,qualified_only=False,placeholder_name='CAA Mathematics',default_resolution=self.env['CLEAR_DEFAULT'],
   effective_resolution=self.override if redirected else self.effective,resolution_info='application override' if redirected else self.info,
   resolver_guid=ROOT,is_redirected=redirected,explicit_redirection=self.override)
  p=PREFIX+['Library Manager'];row=dict(index=0,parentIndex=None,managerId=MID,managerPath=p,order=0,path=p+['references','0'],
   rawFields=f,unavailableFields=[],resolutionStatus='effective-resolution-reported' if f['effective_resolution'] else 'unknown',
   resolutionBasis='native',installedStatus='not-queried')
  lib=dict(projectId=APP,applicationId=APP,targetKind='application',projectPath=str(self.file),applicationPath=PREFIX,
   managers=[dict(managerId=MID,path=p,nativeTypeId=self.env['LIB_MANAGER_TYPE'],enumerationComplete=True,capturedReferences=1,unavailableFields=[])],references=[row],
   scope=dict(enumerationComplete=True,fieldReadComplete=True,truncated=False,enumerationFailures=[],capturedReferences=1,maxReferences=2000),
   referenceVersionScheme=self.env['LIB_CONFIG_SCHEME'],placeholderVersionScheme=self.env['LIB_PLACEHOLDER_SCHEME'])
  lib['configurationVersion']=self.env['library_configuration_version'](lib);lib['placeholderConfigurationVersion']=self.env['placeholder_configuration_version'](lib)
  tasks=[]
  for i in (1,2):
   tasks.append(dict(taskId='60000000-0000-4000-8000-00000000000'+str(i),path=PREFIX+['Task Configuration','Task'+str(i)],
    rawFields=dict(kind_of_task='Cyclic',priority='1',interval='20',interval_unit='ms',event_pou_guid=OBJ,event='',external_event='',core_binding='-2',parent_synchron_task=''),
    watchdog=dict(enabled='False',time='',time_unit='ms',sensitivity='1'),rawCalls=[['Main','中文'],['Main',''],['Main','None']],callsComplete=True,unavailableFields=[]))
  task=dict(projectId=APP,applicationId=APP,projectPath=str(self.file),applicationPath=PREFIX,tasks=tasks,
   programs=[dict(objectId=OBJ,path=PREFIX+['Main'])],enumerationFailures=[],resolutionReadFailures=[],coverageComplete=True)
  return dict(library=lib,tasks={APP:task},sources=[dict(objectId=OBJ,path=PREFIX+['Main'],declaration='PROGRAM Main\nVAR\nEND_VAR',implementation='// 保留')],
   snapshot='a'*64,nativeScope=dict(ideVersion='1.9.1.6',controller=dict(type=4102,id='10f4 0002',version='3.5.11.11'),
   deviceObjectId=ROOT,devicePath=['Device'],applicationId=APP,applicationPath=PREFIX,managerId=MID))
 def capture(self,project,args):
  self.captures+=1;s=self.state()
  if self.captures==2 and self.fault=='prewrite-source':s['sources'][0]['implementation']='changed'
  if self.calls:
   f=s['library']['references'][0]['rawFields']
   if self.fault=='missing':del f['effective_resolution']
   if self.fault=='invalid-type':f['effective_resolution']=False
   if self.fault=='extra':f['new_unexpected']='field'
   if self.fault=='namespace':f['namespace']='changed'
   if self.fault=='source':s['sources'][0]['implementation']='changed'
   if self.fault=='call':s['tasks'][APP]['tasks'][0]['rawCalls'].reverse()
   if self.fault=='task-id':s['tasks'][APP]['tasks'][1]['taskId']=s['tasks'][APP]['tasks'][0]['taskId']
   if self.fault=='coverage':s['library']['scope']['fieldReadComplete']=False
   if self.fault=='reopen' and self.reopened:f['effective_resolution']='different after reopen'
  return s,None,[self.native]
 def run_clear(self):return self.env['library_placeholder_clear'](self.project,self.req,self.args,self.lifecycle)[0]
 def test_success_null_not_missing(self):
  r=self.run_clear();self.assertEqual(r['status'],'succeeded',r);self.assertEqual(self.calls,[('set_redirection',None),('save',)])
  self.assertEqual(r['data']['resolution']['status'],'native-unresolved');self.assertIsNone(r['data']['resolution']['effectiveResolution'])
 def test_empty_literal_and_reported_resolution_distinct(self):
  for value,state in [('', 'empty-text'),('None','literal-None'),(self.env['CLEAR_DEFAULT'],'text'),('other reported resolution','text')]:
   with self.subTest(value=value):
    self.setUp();self.effective=value;r=self.run_clear();self.assertEqual(r['status'],'succeeded',r);self.assertEqual(r['data']['resolution']['valueState'],state)
 def test_partial_first_error_no_recovery(self):
  for fault in ['setter','missing','invalid-type','extra','namespace','source','call','task-id','coverage','publication','save','reopen']:
   with self.subTest(fault=fault):
    self.setUp();self.fault=fault;before=self.file.read_bytes();r=self.run_clear();self.assertEqual(r['status'],'unknown',r)
    self.assertEqual(self.calls.count(('set_redirection',None)),1);self.assertEqual(self.calls.count(('save',)),int(fault in ('save','reopen')))
    if fault not in ('reopen',):self.assertEqual(self.file.read_bytes(),before)
    self.assertEqual(r['data']['recovery'],'not-attempted');self.assertIn('primaryException',r['data'])
 def test_write_before_conflicts_zero_set_save(self):
  for mutate in [lambda:setattr(self,'fault','prewrite-source'),lambda:self.args.update(expectedDiskHash='b'*64),
     lambda:self.args.update(expectedReferenceVersion='b'*64),lambda:self.args.update(expectedPlaceholderVersion='b'*64),
     lambda:self.args.update(placeholderReferenceId='other'),lambda:self.args.update(expectedSourceSnapshot='b'*64),lambda:setattr(self,'override',None)]:
   with self.subTest(mutate=mutate):
    self.setUp();mutate();before=self.file.read_bytes();r=self.run_clear();self.assertEqual(r['status'],'conflict',r)
    self.assertEqual(self.calls,[]);self.assertEqual(self.file.read_bytes(),before)
 def test_synthetic_task_order_and_clear_fields(self):
  # Self-contained synthetic versions below exercise production compare. Actual
  # archived normal-resolution equality is retained under its original probe.
  before=self.state();self.override=None;after=self.state()
  self.assertIsNotNone(self.env['clear_compare'](before,after,self.args,True))
  after['tasks'][APP]['tasks'].reverse();self.env['clear_compare'](before,after,self.args,True)
  after['tasks'][APP]['tasks'][0]['rawCalls'].reverse()
  with self.assertRaises(ValueError):self.env['clear_compare'](before,after,self.args,True)

 def native_capture_setup(self):
  row=self.state()['library']['references'][0]['rawFields'];native=SimpleNamespace(**row)
  native.get_redirection=lambda:native.explicit_redirection
  app=SimpleNamespace(guid=APP,type='a'*36,is_application=True)
  device=SimpleNamespace(guid=ROOT,type='b'*36,is_device=True,get_device_identification=lambda:SimpleNamespace(type=4102,id='10f4 0002',version='3.5.11.11'))
  manager=SimpleNamespace(guid=MID,type=self.env['LIB_MANAGER_TYPE'],is_libman=True,references=[native])
  pou=SimpleNamespace(guid=OBJ,type='6f9dac99-8de1-4efc-8465-68ac443b7d08',has_textual_declaration=True,has_textual_implementation=True,
   textual_declaration=SimpleNamespace(text='PROGRAM Main\nVAR\nEND_VAR'),textual_implementation=SimpleNamespace(text='// 保留'),
   embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc'])
  rows=[(device,['Device'],None),(app,PREFIX,APP),(manager,PREFIX+['Library Manager'],APP),(pou,PREFIX+['Main'],APP)]
  self.env.update(task_replace_ide_version=lambda:'1.9.1.6',walk=lambda p:rows,
   library_inventory=lambda p,a:self.state()['library'],task_inventory=lambda p,a,c:self.state()['tasks'][APP],snapshot=lambda p:'a'*64)
  return native,rows
 def test_production_capture_scope_and_raw_types(self):
  native,rows=self.native_capture_setup();s,m,refs=self.real_capture(self.project,self.args)
  self.assertEqual(s['nativeScope']['controller']['type'],4102);self.assertEqual(refs,[native])
  for field,value in [('effective_resolution',False),('resolution_info',12),('explicit_redirection',None),('name',None)]:
   with self.subTest(field=field):
    native,rows=self.native_capture_setup();setattr(native,field,value)
    with self.assertRaises(ValueError):self.real_capture(self.project,self.args)
 def test_production_capture_getter_failure_and_scope_reject(self):
  native,rows=self.native_capture_setup()
  def fail():raise RuntimeError('getter failed before dispatch')
  native.get_redirection=fail
  with self.assertRaisesRegex(RuntimeError,'getter failed'):self.real_capture(self.project,self.args)
  self.assertEqual(self.calls,[])
  native,rows=self.native_capture_setup();self.env['task_replace_ide_version']=lambda:'other'
  with self.assertRaises(ValueError):self.real_capture(self.project,self.args)
  self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main(verbosity=2)
