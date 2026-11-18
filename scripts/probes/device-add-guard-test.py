"""Local selector refusal and readback evidence checks; does not boot an IDE."""
import ast
import copy
import unittest
from pathlib import Path

script = Path(__file__).with_name('device-add-native.py')
module = ast.parse(script.read_text(encoding='utf-8'))
keep = [entry for entry in module.body
        if isinstance(entry, ast.FunctionDef) and entry.name in ('rejection','assess_after','comparable')]
functions = {}
exec(compile(ast.Module(body=keep, type_ignores=[]),str(script),'exec'),functions)

class Guard(unittest.TestCase):
    def setUp(self):
        self.connector=dict(role='Parent',explicit=True,interface='Fixture.Bus')
        self.nodes=[dict(guid='parent',name='Connector',explicit=True,parentGuid='cpu',connector=self.connector,path=['cpu','Connector'])]
        self.place=[dict(node=self.nodes[0],children=[],appendIndex=0,allowedAtAppend=['Fixture.Bus'],nativeMethods={'insert':'signature'},observedConnectors=[self.connector])]
        item=dict(identity=dict(type='1',id='x',deviceDescriptionVersion='v'),
                  module=False,installedMatches=[{'source':'known'}],compatibleChildConnectors=[{'interface':'Fixture.Bus','role':'Child'}])
        self.repo=dict(scope=dict(truncated=False,enumerationFailures=[]),matches=[item])
        self.plan=dict(nodes=copy.deepcopy(self.nodes),candidate=copy.deepcopy(item),parentGuid='parent',index=0,name='S6bProbeDevice',parentConnector=self.connector)
    def check(self): return functions['rejection'](self.plan,self.nodes,self.place,self.repo)
    def test_matching_empty_connector(self):
        self.assertIsNone(self.check())
    def test_multiple_native_descriptions(self):
        self.repo['matches'].append(self.repo['matches'][0])
        self.assertEqual(self.check(),'IDENTITY_UNCONFIRMED')
    def test_parent_interface_different(self):
        self.place[0]['allowedAtAppend']=['Other.Bus']
        self.assertEqual(self.check(),'PARENT_INCOMPATIBLE')
    def test_occupied_slot(self):
        self.place[0]['children']=[{'guid':'occupied'}]
        self.assertEqual(self.check(),'POSITION_OCCUPIED_OR_UNCONFIRMED')
    def test_conflicting_instance_name_ignores_case(self):
        self.nodes.append({'guid':'duplicate','name':'s6bprobedevice'})
        self.plan['nodes']=copy.deepcopy(self.nodes)
        self.assertEqual(self.check(),'NAME_CONFLICT')
    def test_tree_changed(self):
        self.nodes.append({'guid':'another','name':'Another node'})
        self.assertEqual(self.check(),'TREE_CHANGED')
    def test_implicit_connector_requires_verified_child_occupancy(self):
        self.nodes[0]['device']=True
        self.nodes[0]['explicit']=False
        self.connector['explicit']=False
        old=dict(guid='other',name='Before',device=True,explicit=False,parentGuid='parent',path=['cpu','Connector','Before'])
        self.nodes.append(old)
        self.plan['nodes']=copy.deepcopy(self.nodes)
        self.plan['index']=1
        self.place[0]['appendIndex']=1
        self.place[0]['children']=[old]
        self.place.append(dict(node=old,observedConnectors=[{'role':'Child','interface':'Different.Bus'}]))
        self.assertIsNone(self.check())
        self.place[1]['observedConnectors'][0]['interface']='Fixture.Bus'
        self.assertEqual(self.check(),'POSITION_OCCUPIED_OR_UNCONFIRMED')
    def test_readback_refuses_unexplained_sibling(self):
        new=dict(guid='new',device=True,parentGuid='parent',name=self.plan['name'],identity=self.plan['candidate']['identity'],index=0)
        child=dict(guid='automatic',parentGuid='new')
        result=functions['assess_after'](self.plan,self.nodes,self.nodes+[new,child],'new')
        self.assertEqual(result['generatedDescendants'],[child])
        with self.assertRaisesRegex(ValueError,'outside inserted subtree'):
            functions['assess_after'](self.plan,self.nodes,self.nodes+[new,dict(guid='extra',parentGuid='parent')],'new')

if __name__=='__main__':
    unittest.main(verbosity=2)
