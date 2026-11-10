"""Production partial-tree dispatch/version helper; native/system doubles only."""
import ast,copy,hashlib,json,os,re,unittest
from pathlib import Path
from types import SimpleNamespace as S
class PartialVersions(unittest.TestCase):
 def setUp(self):
  self.e=dict(unicode=str,hashlib=hashlib,json=json,os=os,re=re,CONTRACT='1.0.0');tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'));exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'worker-functions','exec'),self.e);exec(Path('bridge/organization.py').read_text(encoding='utf8'),self.e)
  self.a='10000000-0000-4000-8000-000000000001';self.b='10000000-0000-4000-8000-000000000002';self.p=S(path='fixture.project');self.args={'projectId':'fixture','readDiskHash':'hash','maxNodes':20000};self.data={'projectId':'fixture','nodes':[{'index':0,'objectId':self.a,'kind':'application','path':['Application']}],'scope':{'treeComplete':True,'coverageComplete':True,'truncated':False,'enumerationFailures':[]}};self.native={0:S(guid=self.a,is_application=True)}
 def attach(self):return self.e['attach_organization_versions'](self.p,self.data,self.native,self.args)
 def test_normal_version_bound_to_request_project(self):
  seen=[]
  def inv(p,aid,pid):seen.append((aid,pid));return {'version':'a'*64}
  self.e['organization_inventory']=inv;d=self.attach();self.assertEqual(d['organizationVersions'],{self.a:'a'*64});self.assertEqual(seen,[(self.a,'fixture')]);self.assertNotIn('organizationFailures',d)
 def test_partial_tree_preserved_with_independent_version_gap(self):
  self.data['scope'].update(treeComplete=False,coverageComplete=False,enumerationFailures=[{'reason':'unrelated unreadable branch'}]);before=copy.deepcopy(self.data['nodes'])
  def fail(*a):raise PermissionError('Source/version unreadable')
  self.e['organization_inventory']=fail;d=self.attach();self.assertEqual(d['nodes'],before);self.assertFalse(d['scope']['coverageComplete']);self.assertEqual(d['organizationVersions'],{});self.assertEqual(d['organizationFailures'][0]['applicationId'],self.a)
 def test_one_application_failure_does_not_drop_other_application_version(self):
  self.data['nodes'].append({'index':1,'objectId':self.b,'kind':'application','path':['Other']});self.native[1]=S(guid=self.b)
  def inv(p,aid,pid):
   if aid==self.a:raise ValueError('unavailable')
   return {'version':'b'*64}
  self.e['organization_inventory']=inv;d=self.attach();self.assertEqual(d['organizationVersions'],{self.b:'b'*64});self.assertEqual(len(d['organizationFailures']),1);self.assertTrue(d['scope']['coverageComplete'])
 def test_truncated_before_application_never_invents_version(self):
  self.data['nodes']=[];self.native={};self.data['scope']['truncated']=True;self.e['organization_inventory']=lambda *a:self.fail('No uncaptured identity may be queried');d=self.attach();self.assertEqual(d['organizationVersions'],{});self.assertTrue(d['scope']['truncated'])
 def test_missing_application_guid_is_explicit_gap(self):
  self.data['nodes'][0]['objectId']=None;self.e['organization_inventory']=lambda *a:self.fail('Missing identity must not be guessed');d=self.attach();self.assertEqual(d['organizationVersions'],{});self.assertEqual(d['organizationFailures'][0]['applicationId'],None)
 def test_production_dispatch_keeps_readonly_partial_result_on_extra_walk_failure(self):
  def broken(*a):raise ValueError('Unrelated branch is unreadable')
  def opened(state,*a):state['project']=self.p;return self.p
  def closed(state,*a):state['project']=None
  self.data['scope'].update(coverageComplete=False,treeComplete=False,enumerationFailures=[{'reason':'Unrelated branch is unreadable'}]);self.e.update(projects=S(primary=None),file_hash=lambda p:'hash',direct_file_guard=lambda *a:None,lifecycle_open=opened,lifecycle_close=closed,native_structure=lambda *a:(self.data,self.native),walk=broken)
  r=self.e['dispatch']({'command':'structure','projectPath':self.p.path,'args':self.args});self.assertEqual(r['status'],'succeeded',r);self.assertEqual(len(r['data']['nodes']),1);self.assertFalse(r['data']['scope']['coverageComplete']);self.assertEqual(r['data']['organizationVersions'],{});self.assertTrue(r['data']['organizationFailures']);self.assertTrue(r['data']['readOnlyEvidence']['unchanged'])
if __name__=='__main__':unittest.main()
