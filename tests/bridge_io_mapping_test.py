"""Offline evidence rules using a read-only connector double, never IDE results."""
import copy,sys,unittest
from pathlib import Path
from types import SimpleNamespace as S
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from io_channels import channels_for,val
from io_inventory import combine, inventory, scalar

class Element:
    visible_name='label'; unit='';bit_size=1;base_type='BOOL';is_mappable_io=True
    def __init__(self,name,children=()):
        self.identifier=name;self.children=children;self.has_sub_elements=bool(children)
        self.io_mapping=S(Id=-1,variable=None,default_variable=None,maps_to_existing_variable=True,
                          mapping_creates_variable=False,automatic_iec_address=True,manual_iec_address='')
    def __iter__(self):return iter(self.children)

class Evidence(unittest.TestCase):
    def setUp(self):
        self.bit=Element('leaf')
        p=Element('parent',[self.bit]);p.id=13;p.name='Input';p.channel_type='Input';p.param_type='struct';p.type_string='Bits';p.iec_type=''
        p.get_device_object=lambda:S(guid='owner')
        self.port=S(host_parameters=[p])
    def read(self,entries,modify=lambda s:None,cap=99):
        s=channels_for(self.port,'owner',['device'],max_items=cap);modify(s)
        rows=[dict(deviceGuid='owner',connectorId=2,parameterId=13,elementPath=r['elementIdentifiers'],
            identifier=r['identifier']['value'],direction='Input',rawMappings=entries if r['elementIdentifiers'] else []) for r in s['channels']]
        xml=None if entries is None else dict(rows=rows,exportSha256='test')
        return combine(s,xml,'missing export' if xml is None else None,{'guid':'owner'},{})
    def test_empty_missing_multi_and_contradiction(self):
        self.assertEqual(self.read([])['channels'][1]['mappingCount'],0)
        self.assertIsNone(self.read(None)['channels'][1]['mappingCount'])
        m=self.bit.io_mapping;m.variable='None';m.default_variable=''
        entry=dict(variable='None',id=-1,defaultVariable='',createVariable=False)
        for records in ([entry],[entry,dict(entry,variable='Other')]):
            row=self.read(records)['channels'][1]
            self.assertEqual(row['mappingCount'],len(records));self.assertEqual(row['channelKey']['memberPath'],['leaf'])
        self.assertIsNone(self.read([dict(entry,variable='')])['channels'][1]['mappingCount'])
        m.variable=''
        self.assertEqual(self.read([dict(entry,variable='')])['channels'][1]['getter']['variable'],'')
    def test_field_error_unknown_type_duplicate_and_truncated(self):
        self.bit.base_type=object()
        del self.bit.io_mapping.variable
        row=self.read([])['channels'][1];self.assertEqual(row['getter']['variable']['state'],'error')
        self.assertIsNone(row['mappingCount'])
        self.port.host_parameters*=2
        r=self.read([]);self.assertFalse(r['coverage']['mappingListsComplete'])
        self.assertTrue(all(x['mappingCount'] is None for x in r['channels']))
        self.assertTrue(self.read([],cap=1)['coverage']['truncated'])
    def test_unknown_scalar_type_and_large_net_value(self):
        class Box:
            def GetType(self):return S(FullName='System.Int64')
            def __str__(self):return '9007199254740993'
        self.assertEqual(scalar(val(Box))['decimal'],'9007199254740993')
        self.assertEqual(val(object)['state'],'error')
    def test_unsupported_before_export(self):
        project=S(get_children=lambda _:[])
        f=lambda status,code,msg,*extra:code
        self.assertEqual(inventory(project,{},'', '9',None,f),'IO_IDE_VERSION')
        self.assertEqual(inventory(project,{},'', '1.9.1.6',None,f),'IO_DEVICE_SCOPE')
