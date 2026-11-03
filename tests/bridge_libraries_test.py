"""Production reader with native API doubles, not real IDE evidence."""
import ast,json,hashlib,os,re,unittest,uuid
from pathlib import Path
from types import SimpleNamespace as S

class Node:
    def __init__(self,name,children=None):
        self.guid=str(uuid.uuid4());self.type=str(uuid.uuid4());self.name=name
        self.children=children or [];self.is_application=False
    def get_name(self):return self.name
    def get_children(self,recursive):
        assert recursive is False
        return iter(self.children)

class Ref:
    id=1;name='Chinese library, 1.0 (vendor)';namespace='中文';is_managed=True
    is_placeholder=False;system_library=False;optional=False;qualified_only=False
    @property
    def dependencies(self):raise AssertionError('Must not recursively enumerate dependencies')
    def __getattr__(self,name):raise AssertionError('Unverified/forbidden getter: '+name)

class Placeholder(Ref):
    is_placeholder=True;placeholder_name='配置';default_resolution='库, * (厂商)'
    effective_resolution='库, 2.0 (厂商)';resolution_info='设备解析';resolver_guid=str(uuid.uuid4());is_redirected=False

class Native(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
        self.env=dict(unicode=str,hashlib=hashlib,json=json,os=os,re=re,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'worker.py','exec'),self.env)
        self.manager=Node('任意管理器名称');self.manager.type='adb5cb65-8e1d-4a00-b70a-375ea27582f3'
        self.manager.is_libman=True;self.manager.references=[Ref(),Placeholder()]
        self.app=Node('Application',[self.manager]);self.app.is_application=True
        self.other=Node('Other',[Node('库管理器')]);self.other.is_application=True
        self.project=Node('root',[self.app,self.other]);self.project.path='fixture.project'
        self.args=dict(projectId=str(uuid.uuid4()),applicationId=self.app.guid,targetKind='application',maxReferences=100)
    def read(self,**a):return self.env['library_inventory'](self.project,dict(self.args,**a))
    def test_verified_native_identity_not_display_name_and_direct_only(self):
        r=self.read();self.assertEqual(len(r['managers']),1);self.assertEqual(len(r['references']),2)
        self.assertEqual(r['references'][0]['resolutionStatus'],'unknown')
        f=r['references'][1]['rawFields'];self.assertEqual(f['default_resolution'],'库, * (厂商)');self.assertEqual(f['effective_resolution'],'库, 2.0 (厂商)')
        self.assertNotIn('version',f);self.assertNotIn('vendor',f);self.assertEqual(r['references'][0]['installedStatus'],'not-queried')
        self.assertTrue(r['scope']['enumerationComplete']);self.assertTrue(r['scope']['fieldReadComplete'])
    def test_empty_resolution_or_getter_exception_not_called_missing(self):
        class Missing(Placeholder):
            @property
            def effective_resolution(self):raise RuntimeError('unavailable, not proof of missing library')
        self.manager.references=[Missing(),Placeholder()];self.manager.references[1].effective_resolution=''
        r=self.read();self.assertTrue(r['scope']['enumerationComplete']);self.assertFalse(r['scope']['fieldReadComplete'])
        self.assertEqual([v['resolutionStatus'] for v in r['references']],['unknown','unknown'])
        self.assertIsNone(r['references'][0]['rawFields']['effective_resolution']);self.assertEqual(r['references'][1]['rawFields']['effective_resolution'],'')
    def test_partial_iterator_and_multiple_managers_keep_coverage_and_owner(self):
        def broken():
            yield Ref()
            raise RuntimeError('individual reference enumeration failed')
        self.manager.references=broken()
        other=Node('second manager');other.type=self.manager.type;other.is_libman=True;other.references=[Placeholder()];self.app.children.append(other)
        r=self.read();self.assertEqual(len(r['managers']),2);self.assertFalse(r['scope']['enumerationComplete']);self.assertEqual(len(r['references']),2)
        for row in r['references']:self.assertEqual(row['path'][:-2],row['managerPath'])
    def test_limit_and_exact_end_distinguish_truncation(self):
        self.assertTrue(self.read(maxReferences=1)['scope']['truncated'])
        r=self.read(maxReferences=2);self.assertFalse(r['scope']['truncated']);self.assertTrue(r['scope']['enumerationComplete'])
    def test_unknown_marker_not_empty_complete(self):
        self.manager.is_libman=False;r=self.read();self.assertFalse(r['scope']['enumerationComplete']);self.assertTrue(r['managers'][0]['unavailableFields'])

if __name__=='__main__':unittest.main(verbosity=2)
