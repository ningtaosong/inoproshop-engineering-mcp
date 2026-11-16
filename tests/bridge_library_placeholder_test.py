"""Production placeholder writer with native API doubles; no IDE/project mutation."""
import ast,unittest
from pathlib import Path
from types import SimpleNamespace

source=Path('bridge/library_reference.py').read_text(encoding='utf8')
tree=ast.parse(source)
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in
           ('complete_library_inventory','complete_placeholder_inventory','unresolved_native_resolution','library_placeholder_resolve')]

class Placeholder:
 def __init__(self,calls):self.id='native-1';self.is_placeholder=True;self.system_library=False;self.redirection=None;self.calls=calls;self.fail=False
 def set_redirection(self,value):
  self.calls.append('set');self.redirection=value
  if self.fail:raise RuntimeError('native setter uncertain')

class Native(unittest.TestCase):
 def setUp(self):
  self.calls=[];self.project=SimpleNamespace();self.ref=Placeholder(self.calls)
  self.aid='10000000-0000-4000-8000-000000000001'
  self.mid='40000000-0000-4000-8000-000000000001'
  self.manager=SimpleNamespace(guid=self.mid,type='adb5cb65-8e1d-4a00-b70a-375ea27582f3',is_libman=True,references=[self.ref])
  self.row={'identity':'a'*64,'displayName':'Fixture, 1.0 (Vendor)','company':'Vendor','title':'Fixture',
            'version':'1.0','defaultNamespace':'FIX','repositoryFile':'fixture://library'}
  def inventory(project,args):
   redirected=self.ref.redirection is not None
   fields={'id':'native-1','name':'#Demo','namespace':'FIX','is_placeholder':True,'is_managed':False,
           'system_library':False,'optional':False,'qualified_only':False,'placeholder_name':'Demo',
           'default_resolution':self.row['displayName'],'effective_resolution':self.ref.redirection or 'None',
           'resolution_info':'Native application override' if redirected else 'None','resolver_guid':'resolver',
           'is_redirected':redirected,'explicit_redirection':self.ref.redirection}
   record={'managerId':self.mid,'index':0,'order':0,'rawFields':fields,'unavailableFields':[]}
   return {'scope':{'enumerationComplete':True,'fieldReadComplete':True,'truncated':False,
            'enumerationFailures':[],'capturedReferences':1,'maxReferences':2000},
           'managers':[{'managerId':self.mid,'enumerationComplete':True,'capturedReferences':1,'unavailableFields':[]}],
           'references':[record],'configurationVersion':'refs-new' if redirected else 'refs-old',
           'placeholderConfigurationVersion':'placeholder-new' if redirected else 'placeholder-old'}
  def reject(state,response):state['rejection']=response;raise ValueError(response['summary'])
  def failure(status,code,message,data=None):return {'status':status,'error':{'code':code,'message':message},'summary':message,'data':data}
  self.env={'file_hash':lambda _: 'disk','library_inventory':inventory,'lifecycle_reject':reject,'failure':failure,
            'walk':lambda p:[(self.manager,['Application','Library Manager'],self.aid)],
            'installed_inventory':lambda :({'enumerationComplete':True,'catalogVersion':'cat','entries':[self.row]},
                                            {self.row['identity']:[object()]}),
            'text':str,'snapshot':lambda p:'snapshot','exception_evidence':lambda e:{'type':type(e).__name__,'message':str(e)},
            'lifecycle_save_reopen':lambda state:(self.calls.append('save-reopen') or self.project),
            'success':lambda summary,data:dict(status='succeeded',summary=summary,data=data),
            'LIB_MANAGER_TYPE':'adb5cb65-8e1d-4a00-b70a-375ea27582f3'}
  exec(compile(ast.Module(body=functions,type_ignores=[]),'bridge/library_reference.py','exec'),self.env)
  self.args={'projectId':'p','applicationId':self.aid,'managerId':self.mid,'placeholderReferenceId':'native-1',
             'expectedDiskHash':'disk','expectedReferenceVersion':'refs-old','expectedPlaceholderVersion':'placeholder-old',
             'expectedExplicitRedirection':None,'expectedCatalogVersion':'cat','installedIdentity':self.row['identity'],
             'maxReferences':2000}
  self.req={'projectPath':'fixture.project','checkpointPath':'checkpoint.project'}
 def run_write(self,direct=False):
  req=dict(self.req,**({'fileGuard':{'mode':'direct','expectedDiskHash':'disk'}} if direct else {}))
  return self.env['library_placeholder_resolve'](self.project,req,self.args,{'saveAttempts':0})[0]
 def test_native_success_and_no_op(self):
  result=self.run_write();self.assertEqual(result['status'],'succeeded',result);self.assertEqual(self.calls,['set','save-reopen'])
  self.calls.clear();self.args.update(expectedReferenceVersion='refs-new',expectedPlaceholderVersion='placeholder-new',
                        expectedExplicitRedirection=self.row['displayName'])
  result=self.run_write();self.assertEqual(result['status'],'succeeded');self.assertTrue(result['data']['noOp']);self.assertEqual(self.calls,[])
 def test_partial_set_never_reverses_or_saves(self):
  for direct in (False,True):
   self.calls.clear();self.ref.redirection=None;self.ref.fail=True
   result=self.run_write(direct);self.assertEqual(result['status'],'unknown');self.assertEqual(self.calls,['set'])
   self.assertEqual(self.ref.redirection,self.row['displayName'])
 def test_save_failure_keeps_original_exception(self):
  def fail(state):self.calls.append('save-reopen');raise RuntimeError('save uncertain')
  self.env['lifecycle_save_reopen']=fail
  result=self.run_write();self.assertEqual(result['status'],'unknown');self.assertEqual(self.calls,['set','save-reopen'])
  self.assertEqual(result['data']['primaryException']['message'],'save uncertain')
 def test_ownership_and_disk_reject_before_set(self):
  self.ref.system_library=True
  with self.assertRaises(ValueError):self.run_write()
  self.assertEqual(self.calls,[])
  self.ref.system_library=False;self.env['file_hash']=lambda _: 'changed'
  with self.assertRaises(ValueError):self.run_write()
  self.assertEqual(self.calls,[])
 def test_missing_explicit_field_rejects_before_set(self):
  base=self.env['library_inventory']
  def incomplete(project,args):
   inventory=base(project,args)
   del inventory['references'][0]['rawFields']['explicit_redirection']
   return inventory
  self.env['library_inventory']=incomplete
  with self.assertRaises(ValueError):self.run_write()
  self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
