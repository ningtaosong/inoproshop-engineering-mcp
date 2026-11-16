"""Production add helper under controlled native doubles; no IDE or user project."""
import ast,hashlib,json,unittest
from pathlib import Path
from types import SimpleNamespace

SOURCE=Path('bridge/library_reference.py').read_text(encoding='utf8')
FUNCTIONS=[node for node in ast.parse(SOURCE).body if isinstance(node,ast.FunctionDef)]

class Native(unittest.TestCase):
 def setUp(self):
  self.calls=[];self.aid='10000000-0000-4000-8000-000000000001';self.mid='40000000-0000-4000-8000-000000000001'
  self.project=SimpleNamespace();self.manager=SimpleNamespace(guid=self.mid,type='adb5cb65-8e1d-4a00-b70a-375ea27582f3',is_libman=True,references=[])
  self.row=dict(identity='a'*64,displayName='Fixture, 1.0 (Vendor)',company='Vendor',title='Fixture',version='1.0',defaultNamespace='FIX',repositoryFile='fixture://library')
  self.native_library=SimpleNamespace(displayname=self.row['displayName'],company='Vendor',title='Fixture',version='1.0',default_namespace='FIX')
  self.before={'scope':{'enumerationComplete':True,'fieldReadComplete':True,'truncated':False,'enumerationFailures':[],'capturedReferences':0,'maxReferences':2000},
               'managers':[{'managerId':self.mid,'enumerationComplete':True,'capturedReferences':0,'unavailableFields':[]}], 'references':[]}
  self.added={'managerId':self.mid,'index':0,'order':0,'rawFields':{'id':'1','name':self.row['displayName'],'namespace':'FIX','is_managed':True,
    'is_placeholder':False,'system_library':False,'optional':False,'qualified_only':False},'unavailableFields':[]}
  self.after={'scope':dict(self.before['scope'],capturedReferences=1),
              'managers':[dict(self.before['managers'][0],capturedReferences=1)],'references':[self.added]}
  def failure(status,code,message,data=None):return {'status':status,'error':{'code':code,'message':message},'summary':message,'data':data}
  def reject(lifecycle,response):lifecycle['rejection']=response;raise ValueError(response['summary'])
  self.env={'file_hash':lambda _: 'disk','library_inventory':lambda p,a:self.before,'library_configuration_version':lambda _: 'refs',
            'lifecycle_reject':reject,'failure':failure,'walk':lambda p:[(self.manager,['Application','Library Manager'],self.aid)],
            'installed_inventory':lambda :({'enumerationComplete':True,'catalogVersion':'cat','entries':[self.row]},{self.row['identity']:[self.native_library]}),
            'librarymanager':SimpleNamespace(get_file_path=lambda _:self.row['repositoryFile']),
            'text':str,'snapshot':lambda p:'snapshot','exception_evidence':lambda e:{'type':type(e).__name__,'message':str(e)},
            'lifecycle_save_reopen':lambda state:self.calls.append('recovery-save'),
            'success':lambda summary,data:(dict(status='succeeded',summary=summary,data=data)),
            'LIB_MANAGER_TYPE':'adb5cb65-8e1d-4a00-b70a-375ea27582f3'}
  exec(compile(ast.Module(body=[node for node in FUNCTIONS if node.name in ('complete_library_inventory','library_reference_add')],type_ignores=[]),'bridge/library_reference.py','exec'),self.env)
  self.args=dict(projectId='p',applicationId=self.aid,managerId=self.mid,expectedDiskHash='disk',expectedReferenceVersion='refs',expectedCatalogVersion='cat',installedIdentity=self.row['identity'],expectedNamespace='FIX',maxReferences=2000)
  self.req=dict(projectPath='fixture.project',checkpointPath='checkpoint.project')
 def test_partial_add_never_reverses_or_saves_direct_and_copy(self):
  for direct in (False,True):
   self.calls.clear();self.manager.references=[]
   def add(lib):self.calls.append('native-add');self.manager.references.append(object());raise RuntimeError('partial native add')
   self.manager.add_library=add
   req=dict(self.req,**({'fileGuard':{'mode':'direct','expectedDiskHash':'disk'}} if direct else {}))
   result,project=self.env['library_reference_add'](self.project,req,self.args,{'saveAttempts':0})
   self.assertIs(project,self.project);self.assertEqual(result['status'],'unknown');self.assertEqual(result['error']['code'],'PARTIAL_LIBRARY_ADD')
   self.assertEqual(self.calls,['native-add']);self.assertEqual(len(self.manager.references),1)
 def test_disk_change_rejected_before_native_add(self):
  self.env['file_hash']=lambda _: 'changed';self.manager.add_library=lambda _:self.calls.append('native-add')
  with self.assertRaises(ValueError):self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':0})
  self.assertEqual(self.calls,[])
 def test_save_failure_after_native_add_preserves_partial_state(self):
  def add(lib):self.calls.append('native-add');self.manager.references.append(SimpleNamespace(name=self.row['displayName'],namespace='FIX',is_managed=True,is_placeholder=False,managed_library=lib))
  self.manager.add_library=add
  self.env['library_inventory']=lambda p,a:self.before if not self.manager.references else self.after
  def fail_save(state):self.calls.append('save-attempt');raise RuntimeError('save result uncertain')
  self.env['lifecycle_save_reopen']=fail_save
  result,project=self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':1})
  self.assertIs(project,self.project);self.assertEqual(result['status'],'unknown');self.assertEqual(self.calls,['native-add','save-attempt'])
  self.assertEqual(len(self.manager.references),1)
 def test_wrong_native_identity_after_add_never_reports_success(self):
  def add(lib):
   self.calls.append('native-add')
   wrong=SimpleNamespace(displayname=self.row['displayName'],company='Vendor',title='Fixture',version='2.0',default_namespace='FIX')
   self.manager.references.append(SimpleNamespace(name=self.row['displayName'],namespace='FIX',is_managed=True,is_placeholder=False,managed_library=wrong))
  self.manager.add_library=add
  result,_=self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':0})
  self.assertEqual(result['status'],'unknown');self.assertEqual(self.calls,['native-add'])
 def test_reopen_enumeration_failure_with_same_rows_is_unknown(self):
  complete=self.after
  incomplete=json.loads(json.dumps(complete));incomplete['scope']['enumerationComplete']=False
  incomplete['scope']['enumerationFailures']=[{'stage':'enumeration','reason':'read failed after reopen'}]
  def add(lib):
   self.calls.append('native-add');self.manager.references.append(SimpleNamespace(name=self.row['displayName'],namespace='FIX',is_managed=True,is_placeholder=False,managed_library=lib))
  self.manager.add_library=add
  reads=[self.before,complete,incomplete]
  self.env['library_inventory']=lambda p,a:reads.pop(0)
  self.env['lifecycle_save_reopen']=lambda state:(self.calls.append('save-reopen') or self.project)
  result,_=self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':1})
  self.assertEqual(result['status'],'unknown',result)
  self.assertEqual(self.calls,['native-add','save-reopen'])
  self.assertEqual(len(self.manager.references),1)
 def test_reopen_other_coverage_failures_keep_partial_state(self):
  for flaw in ('truncated','field','missing-field','contradiction','missing'):
   with self.subTest(flaw=flaw):
    self.calls.clear();self.manager.references=[]
    incomplete=json.loads(json.dumps(self.after))
    if flaw=='truncated':incomplete['scope'].update(truncated=True,enumerationComplete=False)
    elif flaw=='field':
     incomplete['scope']['fieldReadComplete']=False
     incomplete['references'][0]['unavailableFields']=[{'field':'namespace','reason':'native getter denied'}]
    elif flaw=='missing-field':del incomplete['references'][0]['rawFields']['name']
    elif flaw=='contradiction':incomplete['scope']['enumerationFailures']=[{'stage':'enumeration','reason':'read failed'}]
    else:del incomplete['scope']['enumerationComplete']
    def add(lib):
     self.calls.append('native-add');self.manager.references.append(SimpleNamespace(name=self.row['displayName'],namespace='FIX',is_managed=True,is_placeholder=False,managed_library=lib))
    self.manager.add_library=add
    reads=[self.before,self.after,incomplete]
    self.env['library_inventory']=lambda p,a:reads.pop(0)
    self.env['lifecycle_save_reopen']=lambda state:(self.calls.append('save-reopen') or self.project)
    result,_=self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':1})
    self.assertEqual(result['status'],'unknown',result)
    self.assertEqual(self.calls,['native-add','save-reopen'])
    self.assertEqual(len(self.manager.references),1)
 def test_prewrite_incomplete_inventory_never_adds(self):
  before=json.loads(json.dumps(self.before));before['scope']['enumerationComplete']=False
  before['scope']['enumerationFailures']=[{'stage':'enumeration','reason':'native read failed'}]
  self.env['library_inventory']=lambda p,a:before
  self.manager.add_library=lambda lib:self.calls.append('native-add')
  with self.assertRaises(ValueError):self.env['library_reference_add'](self.project,self.req,self.args,{'saveAttempts':0})
  self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
