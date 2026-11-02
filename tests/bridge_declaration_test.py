"""Production declaration helpers against controlled native API doubles, not IDE evidence."""
from bridge_pou_test import BridgeCreation, Node
from types import SimpleNamespace
import unittest

class DeclarationBridge(BridgeCreation):
    # Inherit the existing safety tests and run them with the shared generalized creation flow.
    def setUp(self):
        super().setUp()
        self.env['scriptengine'].DutType=SimpleNamespace(Structure='Structure')

    def create_decl(self,kind='structure'):
        name='ST_Config' if kind=='structure' else 'GVL_Config'
        args=dict(self.args,name=name,objectType=kind,
          declaration=('TYPE ST_Config :\nSTRUCT\n Delay : TIME;\nEND_STRUCT\nEND_TYPE\n' if kind=='structure' else 'VAR_GLOBAL\n Delay : TIME := T#5s;\nEND_VAR\n'))
        args.pop('pouType');args.pop('implementation')
        return self.env['create_declaration'](self.project,self.req,args)

    def test_declaration_factory_kind_parent_guid_text_survive_reopen(self):
        for kind in ['gvl','structure']:
            with self.subTest(kind=kind):
                self.setUp()
                r,p=self.create_decl(kind)
                self.assertEqual(r['status'],'succeeded',r)
                self.assertEqual(r['data']['objectType'],kind)
                self.assertFalse(r['data']['hasImplementation'])
                self.assertEqual(r['data']['implementation'],'')
                self.assertNotIn(r['data']['objectId'],self.before_ids)

    def test_native_wrong_kind_is_removed_only_by_new_guid_and_original_restored(self):
        self.manager.control['wrong_native']=True
        r,p=self.create_decl()
        self.assertEqual(r['status'],'failed',r)
        self.assertEqual(r['data']['recovery']['status'],'succeeded')
        self.assertEqual(self.manager.control['removed'],[r['data']['createdObjectId']])

    def test_unknown_factory_failure_freezes_without_deleting_by_name(self):
        self.manager.control['factory_throw_after_create']=True
        r,p=self.create_decl('gvl')
        self.assertEqual(r['status'],'unknown',r)
        self.assertIsNone(r['data']['createdObjectId'])
        self.assertEqual(self.manager.control['removed'],[])

    def test_arbitrary_declarations_enums_unions_aliases_and_nested_locations_not_editable(self):
        for native,decl in [('other','VAR_GLOBAL\nEND_VAR'),('2db5746d-d284-4425-9f7f-2663a34b0ebc','TYPE X : (a,b); END_TYPE'),('2db5746d-d284-4425-9f7f-2663a34b0ebc','TYPE X : UNION x:INT; END_UNION END_TYPE'),('2db5746d-d284-4425-9f7f-2663a34b0ebc','TYPE X : INT; END_TYPE')]:
            n=Node(self.project,'X',declaration=decl,nativeType=native)
            self.app.children.append(n)
            self.assertFalse(self.env['editable'](self.project,n,self.app.guid))
        folder=Node(self.project,'Folder');self.app.children.append(folder)
        n=Node(self.project,'GVL_Nested',declaration='VAR_GLOBAL\nEND_VAR',nativeType='ffbfa93a-b94d-45fc-a329-229860183b1d');folder.children.append(n)
        self.assertFalse(self.env['editable'](self.project,n,self.app.guid))

if __name__=='__main__':unittest.main(verbosity=2)
