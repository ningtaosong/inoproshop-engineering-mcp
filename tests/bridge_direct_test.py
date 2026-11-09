"""Production direct-file guard and no-rollback behavior, with native API doubles."""
import ast,hashlib,json,os,re,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
import bridge_pou_test as fixtures

class DirectGuard(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.file=Path(self.temp.name)/'direct.project';self.file.write_bytes(b'original')
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
        self.env=dict(unicode=str,hashlib=hashlib,json=json,re=re,os=os,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'bridge/worker.py','exec'),self.env)
        self.probes=[];self.env['direct_exclusive_probe']=lambda p:self.probes.append(p)
        self.req=dict(projectPath=str(self.file),fileGuard=dict(mode='direct',expectedDiskHash=hashlib.sha256(b'original').hexdigest()))
        self.state=self.env['lifecycle_state'](project_path=str(self.file))
    def test_exact_file_hash_and_probe_evidence(self):
        e=self.env['direct_file_guard'](self.req,self.state)
        self.assertEqual(e['beforeDiskHash'],self.req['fileGuard']['expectedDiskHash']);self.assertEqual(self.probes,[str(self.file)])
    def test_native_marker_denies_before_probe(self):
        marker=Path(str(self.file)+'.~u');marker.write_text('unsaved external owner')
        with self.assertRaises(ValueError):self.env['direct_file_guard'](self.req,self.state)
        self.assertEqual(self.state['rejection']['error']['code'],'PROJECT_BUSY');self.assertEqual(self.probes,[]);self.assertTrue(marker.exists())
    def test_native_exclusive_handle_failure_denies(self):
        def busy(p):raise OSError('sharing violation')
        self.env['direct_exclusive_probe']=busy
        with self.assertRaises(ValueError):self.env['direct_file_guard'](self.req,self.state)
        self.assertEqual(self.state['rejection']['error']['code'],'PROJECT_BUSY');self.assertEqual(self.file.read_bytes(),b'original')
    def test_changed_disk_denied_without_mutation(self):
        self.file.write_bytes(b'external')
        with self.assertRaises(ValueError):self.env['direct_file_guard'](self.req,self.state)
        self.assertEqual(self.state['rejection']['error']['code'],'PROJECT_FILE_CHANGED');self.assertEqual(self.file.read_bytes(),b'external')
    def test_unowned_primary_is_not_closed_or_replaced(self):
        self.env.update(projects=SimpleNamespace(primary=object()))
        r=self.env['dispatch'](dict(self.req,command='inspect',args={}))
        self.assertEqual(r['error']['code'],'UNOWNED_PROJECT');self.assertEqual(r['data']['lifecycle']['saveAttempts'],0)
    def test_direct_partial_change_never_rolls_back_even_before_save(self):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        obj=f.app.children[0];before=f.env['read_object'](obj,['Application','PLC_PRG'],f.app.guid)
        calls={'declaration':0,'save':0,'checkpoint':0}
        original=obj.textual_declaration.replace
        def declared(text):calls['declaration']+=1;original(text)
        def failing(text):raise RuntimeError('implementation setter failed')
        obj.textual_declaration.replace=declared;obj.textual_implementation.replace=failing
        def opened(p,primary):f.project.path=p;return f.project
        f.manager.primary=None;f.manager.open=opened;f.project.close=lambda:None
        def save():calls['save']+=1
        f.project.save=save
        def checkpoint(*a):calls['checkpoint']+=1
        f.env.update(shutil=SimpleNamespace(copyfile=checkpoint),file_hash=lambda p:'h',direct_file_guard=lambda r,s:dict(beforeDiskHash='h'))
        req=dict(f.req,command='change',fileGuard=dict(mode='direct',expectedDiskHash='h'),args=dict(applicationId=f.app.guid,objectId=obj.guid,expectedHash=before['contentHash'],declaration=before['declaration']+'\n// partial',implementation='new'))
        r=f.env['dispatch'](req)
        self.assertEqual(r['status'],'unknown');self.assertEqual(r['error']['code'],'PARTIAL_WRITE');self.assertEqual(calls,dict(declaration=1,save=0,checkpoint=1))

if __name__=='__main__':unittest.main(verbosity=2)
