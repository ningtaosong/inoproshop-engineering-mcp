"""Production Alias-array bridge executed against native doubles, not IDE evidence."""
from bridge_pou_test import BridgeCreation, Node
from types import SimpleNamespace
import unittest

class ArrayBridge(unittest.TestCase):
    def setUp(self):
        BridgeCreation.setUp(self)
        self.env['scriptengine'].DutType=SimpleNamespace(Structure='Structure',Enumeration='Enumeration',Alias='Alias')
    def array_args(self,low=1,high=3):
        return dict(applicationId=self.app.guid,parentId=self.app.guid,expectedSnapshot=self.before,name='T_Values',objectType='array',declaration='TYPE T_Values :\nARRAY [%d..%d] OF DINT;\nEND_TYPE\n'%(low,high))
    def create(self,args=None):return self.env['create_declaration'](self.project,self.req,args or self.array_args())
    def test_alias_factory_full_type_parameter_default_and_reopen(self):
        for low,high in [(1,3),(7,7),(0,255)]:
            with self.subTest(bounds=(low,high)):
                self.setUp();args=self.array_args(low,high);r,p=self.create(args)
                self.assertEqual(r['status'],'succeeded',r)
                self.assertEqual(self.manager.control['dut_factory_arguments'],[['T_Values','Alias','ARRAY [%d..%d] OF DINT'%(low,high)]])
                self.assertEqual(r['data']['objectType'],'array');self.assertFalse(r['data']['hasImplementation'])
                self.assertEqual(r['data']['declaration'],args['declaration']);self.assertNotIn(r['data']['objectId'],self.before_ids)
                proof=next(v for p,v in self.published if p.endswith('factory.json'))
                self.assertEqual(proof['nativeTypeId'],'2db5746d-d284-4425-9f7f-2663a34b0ebc')
                self.assertEqual(self.env['array_bounds']('T_Values',proof['nativeDeclaration']),(low,high))
                self.assertEqual(self.env['read_object'](*self.env['locate'](p,self.app.guid,r['data']['objectId']))['declaration'],args['declaration'])
    def test_complete_guard_no_factory_or_cross_kind_conversion(self):
        invalid=['ARRAY [3..1] OF DINT','ARRAY [-1..2] OF DINT','ARRAY [0..256] OF DINT','ARRAY [0+1..3] OF DINT','ARRAY [0..N] OF DINT','ARRAY [0..1,0..1] OF DINT','ARRAY [0..1] OF INT','ARRAY [*] OF DINT','DINT','ARRAY [0..1] OF ARRAY [0..1] OF DINT','ARRAY [0..1] OF DINT := [0,1]']
        texts=['TYPE T_Values : '+t+'; END_TYPE' for t in invalid]+['TYPE Wrong : ARRAY [0..1] OF DINT; END_TYPE', self.array_args()['declaration']+'TYPE Other : DINT; END_TYPE',self.array_args()['declaration']+'x := 1;',"{attribute 'x'} "+self.array_args()['declaration']]
        for text in texts:
            self.setUp();args=self.array_args();args['declaration']=text
            r,p=self.create(args);self.assertEqual(r['error']['code'],'INVALID_DECLARATION',text);self.assertEqual(self.manager.control['factory_calls'],0)
        self.assertFalse(self.env['declaration_matches']('structure','T_Values',self.array_args()['declaration']))
        self.assertFalse(self.env['declaration_matches']('array','T_Values','TYPE T_Values : (A := 0); END_TYPE'))
    def test_wrong_factory_or_readback_and_reopen_unknown(self):
        self.manager.control['wrong_native']=True;r,p=self.create();self.assertEqual(r['status'],'failed',r)
        self.setUp();original=self.app.create_dut
        def wrong(*args):
            node=original(*args);node.textual_declaration.text='TYPE T_Values : ARRAY [0..1] OF DINT; END_TYPE';return node
        self.app.create_dut=wrong;r,p=self.create();self.assertEqual(r['status'],'failed',r);self.assertIn('bounds differ',r['data']['primaryException']['message'])
        self.setUp();original=self.app.create_dut
        def corrupt(*args):
            node=original(*args);replace=node.textual_declaration.replace
            node.textual_declaration.replace=lambda value:replace(value.replace('1..3','1..4'));return node
        self.app.create_dut=corrupt;r,p=self.create();self.assertEqual(r['status'],'failed',r);self.assertIn('readback differs',r['data']['primaryException']['message'])
        self.setUp()
        def fail(*a,**k):raise RuntimeError('array reopen unconfirmed')
        self.manager.open=fail;life=self.env['lifecycle_state'](self.project,self.req['projectPath'])
        r,p=self.env['create_declaration'](self.project,self.req,self.array_args(),life)
        self.assertEqual(r['status'],'unknown',r);self.assertEqual(life['saveAttempts'],1);self.assertEqual(self.manager.control['removed'],[])

if __name__=='__main__':unittest.main(verbosity=2)
