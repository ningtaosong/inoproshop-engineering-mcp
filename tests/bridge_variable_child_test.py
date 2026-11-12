"""Production native FB child guard with system-interface substitutes, not IDE evidence."""
import ast, unittest
from pathlib import Path

tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
guard=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='variable_child_guard')

class Child:
    def __init__(self,id,name,kind='method'):
        self.guid=id;self.name=name;self.type='f8a58466-d7f6-439f-bbb8-d4600e41d099';self.kind=kind
    def get_name(self):return self.name

class Parent:
    type='6f9dac99-8de1-4efc-8465-68ac443b7d08'
    def __init__(self,children):self.children=children
    def get_children(self,recursive):
        assert recursive is False
        return self.children

class NativeChildGuard(unittest.TestCase):
    def setUp(self):
        self.app='10000000-0000-4000-8000-000000000001'
        self.id='20000000-0000-4000-8000-000000000002'
        self.child=Child('30000000-0000-4000-8000-000000000003','ResetState')
        self.parent=Parent([self.child])
        self.expected={'fbId':self.id,'children':[{'objectId':self.child.guid,'name':self.child.name,'nativeTypeId':self.child.type}]}
        self.env={'locate':lambda project,app,id:(self.parent,['Device','Application','FB'],app),
                  'object_kind':lambda item:'function_block' if item is self.parent else item.kind,
                  'text':str}
        exec(compile(ast.Module(body=[guard],type_ignores=[]),'worker.py','exec'),self.env)
    def probe(self):return self.env['variable_child_guard'](None,self.app,self.expected)
    def test_exact_identity_passes(self):self.assertEqual(self.probe(),self.expected)
    def test_name_guid_or_kind_change_rejected(self):
        for key,value in [('name','Other'),('guid','40000000-0000-4000-8000-000000000004'),('kind','unsupported')]:
            self.setUp();setattr(self.child,key,value);self.assertIsNone(self.probe(),key)
    def test_missing_or_unreadable_children_rejected(self):
        self.parent.children=[];self.assertIsNone(self.probe())
        self.setUp();self.env['locate']=lambda *args:(_ for _ in ()).throw(PermissionError('denied'))
        self.assertIsNone(self.probe())

if __name__=='__main__':unittest.main()
