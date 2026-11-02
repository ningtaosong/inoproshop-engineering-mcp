"""Production native read functions with API doubles; never treated as real IDE evidence."""
import ast,json,hashlib,os,re,unittest,uuid
from pathlib import Path
from types import SimpleNamespace as S
class Node:
    def __init__(self,name,children=None,device=False):
        self.guid=str(uuid.uuid4());self.type=str(uuid.uuid4());self.name=name;self.children=children or [];self.is_device=device;self.is_application=False;self.is_task=False
    def get_name(self):return self.name
    def get_children(self,recursive):return iter(self.children)
class Param:
    visible_name='Configured parameter';identifier='p1';has_sub_elements=False;param_type='std:WORD';base_type='WORD';value='12'
    @property
    def default_value(self):raise AssertionError('Do not read defaults')
class Native(unittest.TestCase):
    def setUp(self):
        source=ast.parse(Path('bridge/worker.py').read_text(encoding='utf-8'))
        self.env=dict(unicode=str,hashlib=hashlib,json=json,os=os,re=re,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in source.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'worker.py','exec'),self.env)
        self.ident=S(type=4102,id='10f4 0002',version='3.5.11.11');self.device=Node('instance different from model',device=True)
        self.device.get_device_identification=lambda:self.ident;self.device.device_parameters=[];self.device.connectors=[S(connector_id=1,interface='Common.PCI',interface_name='PCI',host_parameters=[Param()])]
        self.project=Node('project',[self.device,Node('unknown')]);self.project.path='sample.project'
        self.env['device_repository']=S(get_device=lambda ident:S(device_id=self.ident,device_info=S(name='AM610 model',vendor='vendor',description='',order_number='???')))
        self.args=dict(projectId=str(uuid.uuid4()),deviceId=self.device.guid,maxParameters=100)
    def test_unknown_non_st_parent_relations_and_branch_failure_preserve_siblings(self):
        broken=Node('unreadable branch');broken.get_children=lambda recursive:(_ for _ in ()).throw(RuntimeError('branch inaccessible'));self.project.children.insert(0,broken)
        tree,_=self.env['native_structure'](self.project,self.args)
        self.assertEqual(len(tree['nodes']),3);self.assertEqual(tree['nodes'][2]['kind'],'unknown');self.assertEqual(tree['nodes'][1]['parentIndex'],None);self.assertFalse(tree['scope']['treeComplete']);self.assertEqual(tree['scope']['enumerationFailures'][0]['path'],['unreadable branch'])
    def test_native_missing_name_or_type_not_invented_and_limit_explicit(self):
        class Bad(Node):
            def get_name(self):raise RuntimeError('name missing')
        self.project.children.append(Bad('missing'));tree,_=self.env['native_structure'](self.project,dict(self.args,maxNodes=2));self.assertTrue(tree['scope']['truncated']);self.assertEqual(len(tree['nodes']),2)
        tree,_=self.env['native_structure'](self.project,self.args);self.assertIsNone(tree['nodes'][-1]['name']);self.assertEqual(tree['nodes'][-1]['path'],[None]);self.assertFalse(tree['nodes'][-1]['pathComplete'])
    def test_description_identity_separate_firmware_and_offline_values_from_getter(self):
        d=self.env['device_inventory'](self.project,self.args)['data'];self.assertEqual(d['deviceInfo']['name'],'AM610 model');self.assertEqual(d['identification']['deviceDescriptionVersion'],'3.5.11.11');self.assertIsNone(d['firmwareVersion']);self.assertFalse(d['completeDeviceConfiguration']);self.assertEqual(d['parameters'][0]['value'],'12');self.assertEqual(d['parameters'][0]['ownerPath'],['instance different from model','connectors','1','host_parameters'])
    def test_parameter_getter_and_connector_failure_remain_visible(self):
        class Bad(Param):
            @property
            def value(self):raise RuntimeError('value denied')
        self.device.device_parameters=[Bad()];self.device.connectors=[S(connector_id=1,interface='PCI',interface_name='PCI')]
        d=self.env['device_inventory'](self.project,self.args)['data'];self.assertIsNone(d['parameters'][0]['value']);self.assertEqual(d['parameters'][0]['unavailableFields'][0]['field'],'value');self.assertFalse(d['scope']['parameterCoverageComplete']);self.assertEqual(len(d['parameterReadFailures']),1)
    def test_compound_elements_truncated_with_exact_parent_indices(self):
        class Compound(Param):
            has_sub_elements=True;value='{12,12}'
            def __iter__(self):return iter([Param(),Param()])
        self.device.device_parameters=[Compound()];d=self.env['device_inventory'](self.project,dict(self.args,maxParameters=2))['data'];self.assertTrue(d['scope']['truncated']);self.assertEqual(len(d['parameters']),2);self.assertEqual(d['parameters'][1]['parentIndex'],0);self.assertEqual(d['parameters'][1]['type'],'WORD')
    def test_wrong_device_or_repository_identity_not_filled_from_name(self):
        r=self.env['device_inventory'](self.project,dict(self.args,deviceId=self.project.children[1].guid));self.assertEqual(r['error']['code'],'NOT_DEVICE')
        self.env['device_repository']=S(get_device=lambda ident:S(device_id=S(type=1,id='wrong',version='0')))
        d=self.env['device_inventory'](self.project,self.args)['data'];self.assertIsNone(d['deviceInfo']['name']);self.assertTrue(d['unavailableFields'])
    def test_object_representation_is_not_an_actual_parameter_value(self):
        class ObjectValue(Param):value=S(identifier='enum-name',value='unverified')
        self.device.device_parameters=[ObjectValue()]
        d=self.env['device_inventory'](self.project,self.args)['data'];self.assertIsNone(d['parameters'][0]['value']);self.assertIn('non-string',d['parameters'][0]['unavailableFields'][0]['reason']);self.assertFalse(d['scope']['parameterCoverageComplete'])
if __name__=='__main__':unittest.main(verbosity=2)
