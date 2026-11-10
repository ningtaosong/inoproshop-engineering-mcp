"""Writable production native bridge with explicit system/object substitutes; not IDE."""
import unittest,uuid
import bridge_properties_test as readonly
class Writable(readonly.Properties):
    def setUp(self):
        super().setUp();self.args.update(propertyMode='read-write',setDeclaration='VAR\nEND_VAR',setImplementation='State := CurrentState;')
    def test_writable_factory_retains_two_native_accessors_and_sources_after_reopen(self):
        r,p=self.create();self.assertEqual(r['status'],'succeeded',r);d=r['data'];self.assertFalse(d['readOnly']);self.assertEqual(len(d['accessorStructure']['accessors']),2);self.assertEqual(d['accessorCleanup']['removalStatus'],'retained');self.assertEqual(self.control['removed'],[]);self.assertEqual(d['setter']['implementation'],self.args['setImplementation']);self.assertNotEqual(d['getter']['objectId'],d['setter']['objectId']);self.assertTrue(d['reopened']);self.assertEqual(self.state['saveAttempts'],1)
    def test_missing_default_set_freezes_without_creating_or_removing_accessors(self):
        self.control['factory_get_only']=True;r,p=self.create();self.assertEqual(r['status'],'unknown');self.assertEqual(self.state['saveAttempts'],0);self.assertEqual(self.control['removed'],[])
    def test_invalid_set_declaration_rejects_before_native_factory(self):
        for text in ['VAR_INPUT\nValue:DINT;\nEND_VAR','VAR\nEND_VAR\nState:=1;','(* unclosed']:
            self.args['setDeclaration']=text;r,p=self.create();self.assertEqual(r['status'],'failed');self.assertEqual(self.control['factory_calls'],0)
    def test_set_change_preserves_get_fb_and_property_sources_by_guid(self):
        r,p=self.create();d=r['data'];a=dict(applicationId=self.app.guid,objectId=d['setter']['objectId'],objectType='property_set',parentId=d['objectId'],fbId=self.fb.guid,expectedHash=d['setter']['contentHash'],expectedPropertyHash=d['contentHash'],expectedAccessorVersion=d['accessorVersion'],expectedSnapshot=d['snapshot'],expectedDiskHash='a'*64,declaration='VAR\nEND_VAR',implementation='State := CurrentState + 1;');self.manager.primary=None
        q=self.e['dispatch'](dict(self.req,command='change',args=a));self.assertEqual(q['status'],'succeeded',q);self.assertEqual(q['data']['relatedSourceEvidence']['before'],q['data']['relatedSourceEvidence']['after']);self.assertEqual(len(q['data']['relatedSourceEvidence']['before']),3);self.assertEqual(self.control['removed'],[])
    def test_set_wrong_owner_role_version_and_native_permissions_refuse(self):
        r,p=self.create();d=r['data'];a=dict(applicationId=self.app.guid,objectId=d['setter']['objectId'],objectType='property_set',parentId=d['objectId'],fbId=self.fb.guid,expectedHash=d['setter']['contentHash'],expectedPropertyHash=d['contentHash'],expectedAccessorVersion=d['accessorVersion'],expectedSnapshot=d['snapshot'],expectedDiskHash='a'*64,declaration='VAR\nEND_VAR',implementation='State := CurrentState + 1;');self.manager.primary=None
        for patch in [dict(objectType='property_get'),dict(parentId=self.fb.guid),dict(fbId=str(uuid.uuid4())),dict(expectedAccessorVersion='f'*64)]:
            q=self.e['dispatch'](dict(self.req,command='change',args=dict(a,**patch)));self.assertIn(q['status'],('unsupported','conflict'),q)
        self.control['deny_permission']=True;q=self.e['dispatch'](dict(self.req,command='change',args=a));self.assertEqual(q['status'],'unsupported',q)
    def test_writable_lifecycle_failures_do_not_remove_accessors(self):
        for stage in ('write','save','close','reopen'):
            self.setUp()
            if stage=='write':self.control['fail_write']=True
            elif stage=='reopen':self.control['fail_reopen']=True
            else:setattr(self.p,stage,lambda:(_ for _ in ()).throw(RuntimeError('uncertain lifecycle')))
            r,p=self.create();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.control['removed'],[])
    def test_wrong_native_accessor_identity_stops_before_any_removal(self):
        for flag in ('wrong_default_parent','wrong_accessor_type','wrong_accessor_language','nonempty_default_set','wrong_property_type'):
            self.setUp();self.control[flag]=True;r,p=self.create();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.control['removed'],[]);self.assertEqual(self.state['saveAttempts'],0)
# Do not inherit the readonly-only cases into this writable suite.
for name in list(readonly.Properties.__dict__):
    if name.startswith('test_') and name not in Writable.__dict__:setattr(Writable,name,None)
if __name__=='__main__':unittest.main()
