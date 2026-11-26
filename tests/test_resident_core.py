# -*- coding: utf-8 -*-
"""Product-core substitutes only. No scriptengine, IDE, project, save or compile."""
import os,sys,copy,json,unittest
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','bridge'))
import resident_core as c
APP='10000000-0000-4000-8000-000000000001';OBJ='20000000-0000-4000-8000-000000000001';OTHER='20000000-0000-4000-8000-000000000002'
def state():
 def row(oid,name,parent,typ,d=None,i=None):return dict(objectId=oid,path=['Application',name] if parent else ['Application'],parentId=parent,nativeTypeId=typ,applicationId=APP,declaration=d,implementation=i,embeddedObjectTypes=[c.ST] if i is not None else [])
 return dict(projectPath='test.project',projectHandle=0,thread=1,applications=[APP],openedProjects={'0':dict(handle=0,path='test.project',library=False,primary=True)},nodes={APP:row(APP,'Application',None,APP),OBJ:row(OBJ,'Logic',APP,c.POU,'PROGRAM Logic\r\nVAR\r\nx: DINT;\r\nEND_VAR','x := 1; // 中文'),OTHER:row(OTHER,'Keep',APP,c.POU,'PROGRAM Keep\nVAR\nEND_VAR','// keep')})
class Native(object):
 def __init__(self):self.state=state();self.writes=0;self.reads=0;self.hook=None;self.fail_write=False;self.saves=0;self.closed=False
 def snapshot(self):
  self.reads+=1
  if self.closed:raise c.Conflict('User closed original handle')
  if self.hook:self.hook(self)
  return copy.deepcopy(self.state)
 def replace_implementation(self,oid,value):
  self.writes+=1;self.state['nodes'][oid]['implementation']=value
  if self.fail_write:raise ValueError('first native write fault')
class Cases(unittest.TestCase):
 def setUp(self):
  self.native=Native();self.disk='a'*64;self.records={};self.failure=None;self.admission_error=None;self.counter=0
  def publish(name,value):
   if name==self.failure:raise IOError('publication '+name)
   self.records[name]=copy.deepcopy(value)
  def admit():
   if self.admission_error:raise c.Conflict(self.admission_error)
  self.session=c.ResidentSession(self.native,lambda:self.disk,publish,admit)
 def call(self,command,args=None):
  self.counter+=1;self.records={};return self.session.handle(dict(command=command,args=dict(applicationId=APP,**(args or {})),operationId=str(self.counter),requestId=str(self.counter),directory='request'))
 def read(self):return self.call('read',dict(objectId=OBJ))
 def change(self,read=None,**more):
  r=(read or self.read())['data'];a=dict(objectId=OBJ,expectedHash=r['contentHash'],expectedResidentVersion=r['residentVersion'],declaration=r['declaration'],implementation='x := 8; // 保持中文');a.update(more);return self.call('change',a)
 def test_many_separate_requests_same_handle(self):
  self.assertEqual(self.call('inspect')['status'],'succeeded')
  for value in range(5):
   r=self.read();v='x := %s; // 中文'%value;self.assertEqual(self.change(r,implementation=v)['status'],'succeeded');self.assertEqual(self.read()['data']['implementation'],v)
  self.assertEqual(self.native.writes,5);self.assertEqual(self.native.saves,0);self.assertFalse(self.native.closed)
 def test_only_authorized_implementation(self):
  before=copy.deepcopy(self.native.state);result=self.change();before['nodes'][OBJ]['implementation']=result['data']['implementation'];self.assertEqual(self.native.state,before);self.assertFalse(result['data']['saved']);self.assertFalse(result['data']['reopened'])
 def test_user_edit_rejects_old_then_new_read(self):
  r=self.read();self.native.state['nodes'][OBJ]['implementation']='x := 4;';rejected=self.change(r);self.assertEqual(rejected['status'],'conflict');self.assertTrue(rejected['data']['recoverableRejection']);self.assertEqual(self.native.writes,0);self.assertEqual(self.change()['status'],'succeeded')
 def test_manual_save_conservatively_stops(self):
  self.read();self.disk='b'*64;r=self.read();self.assertEqual(r['status'],'conflict');self.assertFalse(r['data']['recoverableRejection']);self.assertEqual(self.native.writes,0)
 def test_manual_close_never_reopens(self):
  self.read();self.native.closed=True;self.assertEqual(self.read()['status'],'conflict');self.assertEqual(self.native.writes,0)
 def test_unsupported_read_can_be_followed_by_valid_read(self):
  self.assertTrue(self.call('read',dict(objectId=APP))['data']['recoverableRejection']);self.assertEqual(self.read()['status'],'succeeded')
 def test_declaration_change_rejected(self):self.assertEqual(self.change(declaration='PROGRAM Logic')['status'],'conflict');self.assertEqual(self.native.writes,0)
 def test_st_missing(self):self.native.state['nodes'][OBJ]['embeddedObjectTypes']=[];self.assertEqual(self.read()['status'],'conflict')
 def test_mixed_language_rejected(self):self.native.state['nodes'][OBJ]['embeddedObjectTypes'].append(APP);self.assertEqual(self.read()['status'],'conflict')
 def test_child_pou_rejected(self):self.native.state['nodes'][OTHER]['parentId']=OBJ;self.assertEqual(self.read()['status'],'conflict')
 def test_wrong_native_type(self):self.native.state['nodes'][OBJ]['nativeTypeId']=APP;self.assertEqual(self.read()['status'],'conflict')
 def test_wrong_header(self):self.native.state['nodes'][OBJ]['declaration']='PROGRAM Wrong';self.assertEqual(self.read()['status'],'conflict')
 def test_other_source_changed_before_dispatch(self):
  r=self.read();self.native.state['nodes'][OTHER]['implementation']='changed';self.assertEqual(self.change(r)['status'],'conflict');self.assertEqual(self.native.writes,0)
 def test_change_between_checkpoint_and_dispatch(self):
  r=self.read();self.native.hook=lambda n:n.state['nodes'][OTHER].update(implementation='racing') if n.reads==3 else None
  self.assertEqual(self.change(r)['status'],'conflict');self.assertEqual(self.native.writes,0)
 def test_expired_at_final_gate_zero_write(self):
  self.admission_error='deadline';r=self.change();self.assertEqual(r['status'],'conflict');self.assertFalse(r['data']['recoverableRejection']);self.assertEqual(self.native.writes,0)
 def test_write_exception_sticky_first_error(self):
  self.native.fail_write=True;r=self.change();self.assertEqual(r['status'],'unknown');self.assertIn('first native write fault',r['data']['firstError']['message']);self.assertRaises(c.Conflict,self.read);self.assertEqual(self.native.writes,1);self.assertEqual(self.native.saves,0)
 def test_readback_other_source_change_unknown(self):
  self.native.hook=lambda n:n.state['nodes'][OTHER].update(implementation='bad') if n.reads==4 else None
  self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.native.writes,1)
 def test_checkpoint_publication_fail_zero_write(self):self.failure='checkpoint.json';self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.native.writes,0)
 def test_after_publication_fail_unknown(self):self.failure='after.json';self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.native.writes,1)
 def test_error_publication_keeps_original(self):
  self.native.fail_write=True;self.failure='first-error.json';r=self.change();self.assertIn('first native write fault',r['data']['firstError']['message']);self.assertEqual(len(r['data']['secondaryErrors']),1)
 def test_pagination_requires_same_version(self):
  r=self.call('list',dict(offset=0,limit=1));self.assertEqual(len(r['data']['objects']),1)
  r2=self.call('list',dict(offset=1,limit=1,expectedResidentVersion=r['data']['residentVersion']));self.assertEqual(r2['status'],'succeeded');self.assertIsNone(r2['data']['nextOffset'])
 def test_pagination_stale_rejected(self):
  r=self.call('list',dict(offset=0,limit=1));self.native.state['nodes'][OBJ]['implementation']='other';self.assertEqual(self.call('list',dict(offset=1,limit=1,expectedResidentVersion=r['data']['residentVersion']))['status'],'conflict')
 def test_task_call_order_is_not_sorted(self):
  self.native.state['nodes'][APP]['calls']=[['A','None'],['B','中文']];r=self.read();self.native.state['nodes'][APP]['calls'].reverse();self.assertEqual(self.change(r)['status'],'conflict')
 def test_library_resolution_changes_are_dependencies(self):
  self.native.state['nodes'][APP]['directLibraries']=[{'id':'1','effective_resolution':'v1'}];r=self.read();self.native.state['nodes'][APP]['directLibraries'][0]['effective_resolution']='v2';self.assertEqual(self.change(r)['status'],'conflict')
 def test_null_empty_and_literal_not_coalesced(self):
  for value in [None,'','None']:
   n=state();n['nodes'][APP]['custom']=value
   self.assertNotEqual(c.digest(c.dependencies(n)),c.digest(c.dependencies(state())))
 def test_non_source_observation_kept_but_not_in_dependency(self):
  n=state();extra='30000000-0000-4000-8000-000000000001'
  n['nodes'][extra]=dict(objectId=extra,path=['DeviceUI'],parentId=None,nativeTypeId=extra,applicationId=None,declaration=None,implementation=None,embeddedObjectTypes=[])
  n['openedProjects']['1']=dict(handle=1,path='referenced.library',primary=False,library=True)
  self.assertEqual(c.dependencies(n),c.dependencies(state()));self.assertIn(extra,n['nodes']);self.assertIn('1',n['openedProjects'])


class PublicAdapterCases(unittest.TestCase):
 def setUp(self):
  class Source(object):
   def __init__(self,text):self.text=text
   def replace(self,text):self.text=text
  class Item(object):
   def __init__(self,oid,name,typ,children=None,decl=None,impl=None,app=False):
    self.guid=oid;self.name=name;self.type=typ;self.children=children or [];self.handle=0;self.is_application=app;self.is_task=False
    self.has_textual_declaration=decl is not None;self.has_textual_implementation=impl is not None;self.embedded_object_types=[c.ST] if impl is not None else []
    self.textual_declaration=Source(decl);self.textual_implementation=Source(impl)
   def get_children(self,recursive):return self.children
   def get_name(self):return self.name
  self.item=Item(OBJ,'Logic',c.POU,decl='PROGRAM Logic',impl='x := 1;')
  app=Item(APP,'Application',APP,children=[self.item],app=True)
  class Project(object):
   handle=0;path='test.project';primary=True;library=False
   def get_children(self,recursive):return [app]
  project=Project()
  class Projects(object):
   primary=None;all=[];opens=0
   def open(self,path,primary):self.opens+=1;self.primary=project;self.all=[project];return project
  self.projects=Projects();self.adapter=c.NativeProjectAdapter(self.projects,'test.project',c.same_public_identity,lambda:1)
 def test_public_open_once_and_owned_replace(self):
  a=self.adapter.snapshot();self.adapter.replace_implementation(OBJ,u'x := 2; // \u4e2d\u6587');b=self.adapter.snapshot();self.assertEqual(self.projects.opens,1);self.assertEqual(a['projectHandle'],b['projectHandle']);self.assertEqual(b['nodes'][OBJ]['implementation'],u'x := 2; // \u4e2d\u6587')
 def test_public_closed_handle_never_reopens(self):
  self.adapter.snapshot();self.projects.primary=None;self.projects.all=[];self.assertRaises(c.Conflict,self.adapter.snapshot);self.assertEqual(self.projects.opens,1)
 def test_object_from_other_handle_stops(self):
  self.item.handle=1;self.assertRaises(ValueError,self.adapter.snapshot)
 def test_duplicate_guid_stops_before_replace(self):
  self.adapter.snapshot();self.projects.primary.get_children(False)[0].children.append(self.item);self.assertRaises(ValueError,self.adapter.snapshot);self.assertEqual(self.adapter.attempts['replace'],0)
 def test_native_null_source_is_not_empty(self):
  self.item.textual_implementation.text=None;self.assertRaises(ValueError,self.adapter.snapshot);self.assertEqual(self.adapter.attempts['replace'],0)
 def test_foreign_open_project_rejects(self):
  class Other(object):handle=7;path='other.project';primary=False;library=False
  self.adapter.snapshot();self.projects.all.append(Other());self.assertRaises(c.Conflict,self.adapter.snapshot)

if __name__=='__main__':unittest.main()