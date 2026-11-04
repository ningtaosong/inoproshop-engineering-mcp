"""Execute production enum functions against native doubles, never claim real IDE evidence."""
from bridge_pou_test import BridgeCreation, Node
from types import SimpleNamespace
import unittest

class EnumBridge(unittest.TestCase):
    def setUp(self):
        BridgeCreation.setUp(self)
        self.env['scriptengine'].DutType=SimpleNamespace(Structure='Structure',Enumeration='Enumeration')
    def enum_args(self):
        return dict(applicationId=self.app.guid,parentId=self.app.guid,expectedSnapshot=self.before,name='E_State',objectType='enum',declaration='TYPE E_State :\n(Idle := 0, Running := 1, Fault := 2);\nEND_TYPE\n')
    def enum(self,args=None):return self.env['create_declaration'](self.project,self.req,args or self.enum_args())
    def test_enum_factory_exact_kind_empty_base_guid_and_reopened_full_text(self):
        args=self.enum_args();r,p=self.enum(args);self.assertEqual(r['status'],'succeeded',r)
        self.assertEqual(self.manager.control['dut_factory_arguments'],[['E_State','Enumeration','']])
        self.assertEqual(r['data']['objectType'],'enum');self.assertFalse(r['data']['hasImplementation'])
        self.assertEqual(r['data']['declaration'],args['declaration']);self.assertNotIn(r['data']['objectId'],self.before_ids)
        proof=next(v for p,v in self.published if p.endswith('factory.json'));self.assertEqual(proof['arguments'],['E_State','Enumeration',''])
        self.assertEqual(proof['nativeTypeId'],'2db5746d-d284-4425-9f7f-2663a34b0ebc');self.assertIn("{attribute 'strict'}",proof['nativeDeclaration'])
        self.assertEqual(self.env['read_object'](*self.env['locate'](p,self.app.guid,r['data']['objectId']))['declaration'],args['declaration'])
    def test_enum_invalid_request_never_calls_factory_and_structure_is_not_enum(self):
        for decl in ['TYPE Other : (A := 0); END_TYPE','TYPE E_State : (A := 0, a := 1); END_TYPE','TYPE E_State : (A := 32768); END_TYPE','TYPE E_State : (A); END_TYPE',"{attribute 'strict'} TYPE E_State : (A := 0); END_TYPE",'TYPE E_State : (A := 0) INT; END_TYPE']:
            with self.subTest(decl=decl):
                self.setUp();args=self.enum_args();args['declaration']=decl;self.assertEqual(self.enum(args)[0]['error']['code'],'INVALID_DECLARATION');self.assertEqual(self.manager.control['factory_calls'],0)
        self.assertFalse(self.env['declaration_matches']('structure','E_State',self.enum_args()['declaration']))
    def test_enum_wrong_native_type_retains_actual_partial_state(self):
        self.manager.control['wrong_native']=True;r,p=self.enum();self.assertEqual(r['status'],'failed',r);self.assertEqual(r['data']['recovery']['status'],'succeeded')
        self.setUp();original=self.app.create_dut
        def factory(*args):
            node=original(*args);replace=node.textual_declaration.replace
            node.textual_declaration.replace=lambda value:replace(value.replace('Fault := 2','Fault := 3'))
            return node
        self.app.create_dut=factory
        r,p=self.enum();self.assertEqual(r['status'],'failed',r);self.assertIn('readback differs',r['data']['primaryException']['message']);self.assertEqual(r['data']['recovery']['status'],'succeeded')
    def test_enum_reopen_failure_remains_unknown_and_never_saves_twice(self):
        original=self.manager.open
        def broken(*a,**k):raise RuntimeError('enum reopen failure after save')
        self.manager.open=broken
        lifecycle=self.env['lifecycle_state'](self.project,self.req['projectPath'])
        r,p=self.env['create_declaration'](self.project,self.req,self.enum_args(),lifecycle)
        self.assertEqual(r['status'],'unknown',r);self.assertEqual(lifecycle['saveAttempts'],1);self.assertEqual(self.manager.control['removed'],[])
        self.assertIn('enum reopen failure',r['data']['primaryException']['message'])

if __name__=='__main__':unittest.main(verbosity=2)
