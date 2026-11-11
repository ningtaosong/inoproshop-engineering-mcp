"""Production native type guard with explicit object substitutes; not an IDE test."""
import ast,unittest
from pathlib import Path

TREE=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
GUARD=next(x for x in TREE.body if isinstance(x,ast.FunctionDef) and x.name=='variable_type_guard')

class NativeMemberGuard(unittest.TestCase):
    def setUp(self):
        self.app='10000000-0000-4000-8000-000000000001'
        self.id='20000000-0000-4000-8000-000000000002'
        self.path=['Device','Application','ST_AlarmConfig']
        self.row=dict(objectId=self.id,applicationId=self.app,path=self.path,
          objectType='structure',nativeTypeId='2db5746d-d284-4425-9f7f-2663a34b0ebc',
          hasImplementation=False,implementation='',contentHash='a'*64)
        self.g=dict(objectId=self.id,applicationId=self.app,path=self.path,contentHash='a'*64)
        self.e={'locate':lambda project,app,id:(object(),self.path,self.app),
                'read_object':lambda item,names,app:self.row}
        exec(compile(ast.Module(body=[GUARD],type_ignores=[]),'worker.py','exec'),self.e)
    def test_identity_and_hash_match(self):
        self.assertEqual(self.e['variable_type_guard'](None,self.app,self.g)['contentHash'],'a'*64)
    def test_changed_hash_parent_or_native_type_rejects(self):
        for change in [dict(contentHash='b'*64),dict(applicationId='other'),dict(path=['other']),
                       dict(objectType='enum'),dict(nativeTypeId='other'),dict(hasImplementation=True)]:
            self.setUp();self.row.update(change)
            self.assertIsNone(self.e['variable_type_guard'](None,self.app,self.g),change)
    def test_missing_or_unreadable_type_is_uncertain(self):
        self.e['locate']=lambda *a:(_ for _ in ()).throw(PermissionError('unavailable'))
        self.assertIsNone(self.e['variable_type_guard'](None,self.app,self.g))

if __name__=='__main__':unittest.main()
