"""Production organization/worker functions with native-system doubles, not IDE evidence."""
import ast,copy,hashlib,json,os,re,shutil,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace as S
from uuid import uuid4
def guid():return str(uuid4())
POU='6f9dac99-8de1-4efc-8465-68ac443b7d08';FOLDER='738bea1e-99bb-4f04-90bb-a7a567e74e3a'
class Node:
 def __init__(self,name,typ,parent=None,decl=None,impl=None):
  self.guid=guid();self.name=name;self.type=typ;self.parent=parent;self.children=[];self.has_textual_declaration=decl is not None;self.has_textual_implementation=impl is not None;self.textual_declaration=S(text=decl);self.textual_implementation=S(text=impl);self.is_folder=typ==FOLDER;self.is_application=False;self.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc'];self.fail=None;self.calls=[]
  if parent:parent.children.append(self)
 def get_name(self):return self.name
 def get_children(self,_):return self.children[:]
 def create_folder(self,name):self.calls.append(('create',name));Node(name,FOLDER,self)
 def move(self,parent,index):
  self.calls.append(('move',parent.guid,index));self.parent.children.remove(self);parent.children.append(self);self.parent=parent
  if self.fail:raise RuntimeError('Native move changed before throwing')
class NativeOrganization(unittest.TestCase):
 def setUp(self):
  tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'));self.e=dict(unicode=str,hashlib=hashlib,json=json,os=os,re=re,shutil=shutil,CONTRACT='1.0.0')
  exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'worker-functions','exec'),self.e);exec(Path('bridge/organization.py').read_text(encoding='utf8'),self.e)
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.file=Path(self.tmp.name)/'fixture.project';self.file.write_text('fixture');self.p=Node('Project',guid());self.app=Node('Application',guid(),self.p);self.app.is_application=True;self.folder=Node('Alarms',FOLDER,self.app);self.fb=Node('FB_Test',POU,self.app,'FUNCTION_BLOCK FB_Test\nVAR\n State:DINT:=7;\nEND_VAR','');self.readonly=False;self.saved=0;self.stage=None;self.records=[];self.disk='disk'
  self.tasks={'projectId':'project','applicationId':self.app.guid,'coverageComplete':True,'tasks':[{'rawCalls':[['PLC_PRG','']]}],'programs':[]}
  def reopen(state):
   self.saved+=1
   if self.stage:raise RuntimeError(self.stage)
   return self.p
  def permission(*a):
   if self.readonly:raise ValueError('Native permission denied')
  self.e.update(method_file_writable=permission,method_write_permission=permission,file_hash=lambda p:self.disk,publish=lambda f,v:self.records.append((f,copy.deepcopy(v))),task_inventory=lambda p,a:copy.deepcopy(self.tasks),lifecycle_save_reopen=reopen)
  self.req=dict(projectPath=str(self.file),checkpointPath=str(Path(self.tmp.name)/'checkpoint.project'),resultPath=str(Path(self.tmp.name)/'result.json'),command='move_object');self.state={'project':self.p};self.a=dict(projectId='project',applicationId=self.app.guid,objectId=self.fb.guid,sourceParentId=self.app.guid,targetParentId=self.folder.guid,expectedDiskHash='disk');self.refresh()
 def refresh(self):self.a['expectedStructureVersion']=self.e['organization_inventory'](self.p,self.app.guid,'project')['version']
 def call(self,**patch):return self.e['organize'](self.p,self.req,dict(self.a,**patch),self.state)[0]
 def test_native_move_guid_source_and_children_preserved(self):
  m=Node('Reset', 'f8a58466-d7f6-439f-bbb8-d4600e41d099',self.fb,'METHOD PUBLIC Reset\nVAR\nEND_VAR','State:=0;');self.refresh();r=self.call();self.assertEqual(r['status'],'succeeded',r);self.assertEqual(self.fb.parent,self.folder);self.assertEqual(m.parent,self.fb);self.assertEqual(r['data']['object']['objectId'],self.fb.guid);self.assertEqual(self.saved,1)
 def test_folder_factory_returns_none_and_empty_folder_preserves_snapshot(self):
  self.req['command']='create_folder';self.a.update(parentId=self.app.guid,name='Motors');r=self.call();self.assertEqual(r['status'],'succeeded',r);self.assertEqual(r['data']['object']['nativeTypeId'],FOLDER);self.assertNotEqual(r['data']['beforeStructure']['version'],r['data']['afterStructure']['version']);self.assertEqual(r['data']['object']['sourceHash'],None)
 def test_same_position_has_no_native_or_checkpoint_or_save(self):
  r=self.call(targetParentId=self.app.guid);self.assertEqual(r['status'],'succeeded');self.assertEqual(r['data']['actions'],[]);self.assertEqual(self.saved,0);self.assertFalse(Path(self.req['checkpointPath']).exists())
 def test_stale_structure_and_disk_no_mutation(self):
  for patch in [{'expectedStructureVersion':'old'},{'expectedDiskHash':'old'}]:self.assertEqual(self.call(**patch)['status'],'conflict')
  self.assertEqual(self.fb.calls,[])
 def test_same_level_collision_does_not_overwrite(self):
  other=Node('FB_Test',POU,self.folder,'FUNCTION_BLOCK FB_Test\nVAR\nEND_VAR','');self.refresh();self.assertEqual(self.call()['error']['code'],'ORGANIZATION_NAME_EXISTS');self.assertEqual(self.fb.parent,self.app);self.assertEqual(other.parent,self.folder)
 def test_wrong_parent_cross_application_and_nested_rejected(self):
  nested=Node('Nested',FOLDER,self.folder);other=Node('OtherApp',guid(),self.p);other.is_application=True;self.refresh()
  for patch in [{'sourceParentId':self.folder.guid},{'targetParentId':other.guid},{'targetParentId':nested.guid}]:self.assertNotEqual(self.call(**patch)['status'],'succeeded')
  self.assertEqual(self.saved,0)
 def test_gvl_system_and_unknown_fb_children_rejected(self):
  for typ,decl in [('ffbfa93a-b94d-45fc-a329-229860183b1d','VAR_GLOBAL\n X:INT;\nEND_VAR'),(guid(),'PROGRAM Fake\nVAR\nEND_VAR')]:
   self.fb.type=typ;self.fb.textual_declaration.text=decl;self.refresh();self.assertEqual(self.call()['status'],'unsupported')
  self.fb.type=POU;self.fb.textual_declaration.text='FUNCTION_BLOCK FB_Test\nVAR\nEND_VAR';Node('Unsupported',guid(),self.fb,'UNKNOWN','');self.refresh();self.assertEqual(self.call()['status'],'unsupported')
 def test_non_st_and_permission_denied_rejected(self):
  self.fb.embedded_object_types=[];self.assertEqual(self.call()['status'],'unsupported');self.fb.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc'];self.readonly=True;self.assertEqual(self.call()['status'],'unsupported');self.assertEqual(self.saved,0)
 def test_partial_move_and_lifecycle_failure_preserve_no_reverse_operation(self):
  self.fb.fail=True;r=self.call();self.assertEqual(r['status'],'unknown');self.assertEqual(self.fb.parent,self.folder);self.assertEqual(len(self.fb.calls),1);self.assertFalse(r['data']['automaticRollback']);self.assertTrue(Path(self.req['checkpointPath']).exists())
 def test_reopen_failure_unknown(self):
  self.stage='close/reopen';r=self.call();self.assertEqual(r['status'],'unknown');self.assertEqual(self.fb.parent,self.folder)
 def test_reopen_structure_or_task_change_unknown(self):
  for change in ['source','task']:
   def reopen(state):
    if change=='source':self.fb.textual_implementation.text='unexpected;'
    else:self.tasks['tasks'][0]['rawCalls']=[['Other','']]
    return self.p
   self.e['lifecycle_save_reopen']=reopen;r=self.call();self.assertEqual(r['status'],'unknown');break
 def test_program_catalog_order_not_task_call_order(self):
  self.tasks['programs']=[{'objectId':'a','path':['Application','A']},{'objectId':'b','path':['Application','B']}]
  def reopen(state):self.tasks['programs'].reverse();return self.p
  self.e['lifecycle_save_reopen']=reopen;r=self.call();self.assertEqual(r['status'],'succeeded',r)
 def test_reopen_task_calls_changed_unknown(self):
  def reopen(state):self.tasks['tasks'][0]['rawCalls']=[['Other','']];return self.p
  self.e['lifecycle_save_reopen']=reopen;r=self.call();self.assertEqual(r['status'],'unknown')
 def test_checkpoint_race_rechecks_structure_before_native_call(self):
  def publish(f,v):Node('Race',FOLDER,self.app)
  self.e['publish']=publish;r=self.call();self.assertEqual(r['status'],'conflict');self.assertEqual(self.fb.calls,[])
 def test_empty_accessor_losing_implementation_cannot_hide_behind_same_text_hash(self):
  prop=Node('CurrentState','5a3b8626-d3e9-4f37-98b5-66420063d91e',self.fb,'PROPERTY PUBLIC CurrentState : DINT',None);getter=Node('Get','792f2eb6-721e-4e64-ba20-bc98351056db',prop,'VAR\nEND_VAR','');self.refresh()
  def reopen(state):getter.has_textual_implementation=False;return self.p
  self.e['lifecycle_save_reopen']=reopen;r=self.call();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.fb.parent,self.folder)
 def test_empty_pou_losing_native_st_marker_is_not_a_successful_move(self):
  def reopen(state):self.fb.embedded_object_types=[];return self.p
  self.e['lifecycle_save_reopen']=reopen;r=self.call();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.fb.parent,self.folder)
 def test_accessor_metadata_checkpoint_race_rejects_before_move(self):
  prop=Node('CurrentState','5a3b8626-d3e9-4f37-98b5-66420063d91e',self.fb,'PROPERTY PUBLIC CurrentState : DINT',None);getter=Node('Get','792f2eb6-721e-4e64-ba20-bc98351056db',prop,'VAR\nEND_VAR','');self.refresh()
  def publish(f,v):getter.embedded_object_types=[]
  self.e['publish']=publish;r=self.call();self.assertNotEqual(r['status'],'succeeded');self.assertEqual(self.fb.calls,[]);self.assertEqual(self.saved,0)
 def test_noop_records_actual_accessor_structure_without_save(self):
  prop=Node('CurrentState','5a3b8626-d3e9-4f37-98b5-66420063d91e',self.fb,'PROPERTY PUBLIC CurrentState : DINT',None);Node('Get','792f2eb6-721e-4e64-ba20-bc98351056db',prop,'VAR\nEND_VAR','');self.refresh();r=self.call(targetParentId=self.app.guid);self.assertEqual(r['status'],'succeeded');self.assertEqual(self.saved,0)
  evidence=next(v for f,v in self.records if f.endswith('organization-subobjects-noop.json'));self.assertEqual(evidence['before'],evidence['after']);self.assertTrue(next(x for x in evidence['after'] if x['objectId']==prop.guid)['accessorStructure']['readOnly'])
if __name__=='__main__':unittest.main()
