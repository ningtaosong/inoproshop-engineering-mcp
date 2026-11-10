"""Production Property functions against explicit substitutes; not real IDE evidence."""
import os,re,unittest,uuid
from types import SimpleNamespace
import bridge_methods_test as methods
from bridge_pou_test import Node

PROPERTY='5a3b8626-d3e9-4f37-98b5-66420063d91e'
ACCESSOR='792f2eb6-721e-4e64-ba20-bc98351056db'
ST='3b83b776-fb25-43b8-99f2-3c507c9143fc'
class Properties(unittest.TestCase):
    arguments=methods.Methods.arguments
    def setUp(self):
        methods.Methods.setUp(self)
        def factory(node,name,ret,language):
            self.control['factory_calls']+=1;self.control['property_args']=[name,ret,language]
            if self.control.get('return_existing_property'):return node.children[0]
            prop=Node(node.project,name,declaration='PROPERTY '+name+' : '+ret,nativeType=PROPERTY);prop.parent=node;prop.embedded_object_types=[];node.children.append(prop)
            for n in (['Get'] if self.control.get('factory_get_only') else ['Set','Get']):
                child=Node(node.project,n,declaration='VAR\nEND_VAR\n',implementation='',nativeType=ACCESSOR);child.parent=prop;child.embedded_object_types=[ST];prop.children.append(child)
                if n=='Set' and self.control.get('nonempty_default_set'):child.textual_implementation.text='UserCode := 1;'
                if n=='Set' and self.control.get('wrong_default_parent'):child.parent=node
                if n=='Get' and self.control.get('wrong_accessor_type'):child.type=PROPERTY
                if n=='Get' and self.control.get('wrong_accessor_language'):child.embedded_object_types=[]
            if self.control.get('wrong_property_type'):prop.type=ACCESSOR
            if self.control.get('factory_throw_after_create'):raise RuntimeError('factory did not return identity')
            return prop
        Node.create_property=factory
        self.copies=[];self.e.update(shutil=SimpleNamespace(copyfile=lambda a,b:self.copies.append((a,b))),sys=__import__('sys'),traceback=__import__('traceback'))
        self.args=self.request()
    def request(self):
        return dict(applicationId=self.app.guid,parentId=self.fb.guid,name='CurrentState',access='PUBLIC',propertyType='DINT',expectedSnapshot=self.e['snapshot'](self.p),expectedDiskHash='a'*64,expectedParentHash=self.e['content_hash'](self.fb.textual_declaration.text,''),declaration='PROPERTY PUBLIC CurrentState : DINT',getDeclaration='VAR\nEND_VAR',getImplementation='CurrentState := State;')
    def create(self):return self.e['create_property'](self.p,self.req,self.args,self.state)
    def test_factory_only_new_default_set_removed_and_structure_persists(self):
        before=self.e['snapshot'](self.p);r,p=self.create();self.assertEqual(r['status'],'succeeded',r);d=r['data'];self.assertEqual(self.control['property_args'],['CurrentState','DINT','ST']);self.assertEqual(d['nativeTypeId'],PROPERTY);self.assertEqual(d['getter']['nativeTypeId'],ACCESSOR)
        self.assertEqual(self.control['removed'],[d['accessorCleanup']['removedSetId']]);self.assertTrue(d['readOnly']);self.assertEqual(d['accessorStructure']['accessors'][0]['name'],'Get');self.assertEqual(len(d['accessorStructure']['accessors']),1);self.assertNotEqual(before,d['snapshot']);self.assertEqual(d['getter']['propertyId'],d['objectId']);self.assertEqual(d['getter']['fbId'],self.fb.guid);self.assertEqual(self.state['saveAttempts'],1)
    def test_native_factory_can_already_return_get_only_without_any_remove(self):
        self.control['factory_get_only']=True;r,p=self.create();self.assertEqual(r['status'],'succeeded',r);self.assertIsNone(r['data']['accessorCleanup']['removedSetId']);self.assertEqual(self.control['removed'],[])
    def test_fixed_dispatch_admits_property_and_real_checkpoint_path(self):
        self.manager.primary=None;r=self.e['dispatch'](dict(self.req,command='create_property',args=self.args));self.assertEqual(r['status'],'succeeded',r);self.assertEqual(len(self.copies),1);self.assertFalse(r['data']['lifecycle']['ownedHandleRemaining'])
    def test_bad_parent_header_and_versions_never_call_factory(self):
        for patch in [dict(parentId=self.app.guid),dict(applicationId=str(uuid.uuid4())),dict(declaration='PROPERTY PUBLIC Wrong : DINT'),dict(declaration='PROPERTY PRIVATE CurrentState : DINT'),dict(declaration='PROPERTY PUBLIC CurrentState : BOOL'),dict(getDeclaration='VAR_INPUT\nX:DINT;\nEND_VAR'),dict(expectedSnapshot='f'*64),dict(expectedParentHash='f'*64),dict(expectedDiskHash='f'*64)]:
            self.setUp();self.args.update(patch);r,p=self.create();self.assertIn(r['status'],('failed','conflict','unsupported'));self.assertEqual(self.control['factory_calls'],0)
    def test_permissions_and_readonly_file_refuse_before_factory(self):
        for mode in ('permission','file'):
            self.setUp()
            if mode=='permission':self.control['deny_permission']=True
            else:self.e['method_file_writable']=lambda p:(_ for _ in ()).throw(ValueError('File read-only'))
            r,p=self.create();self.assertEqual(r['status'],'unsupported');self.assertEqual(self.control['factory_calls'],0)
    def test_existing_same_name_is_never_converted_or_cleaned(self):
        existing=self.fb.create_property('CurrentState','DINT','ST');self.control['factory_calls']=0;self.args=self.request();r,p=self.create();self.assertEqual(r['error']['code'],'PROPERTY_EXISTS');self.assertEqual(self.control['factory_calls'],0);self.assertEqual(self.control['removed'],[]);self.assertEqual(len(existing.children),2)
    def test_nonempty_or_wrong_default_identity_preserved_unknown(self):
        for flag in ('nonempty_default_set','wrong_default_parent','wrong_property_type','wrong_accessor_type','wrong_accessor_language','factory_throw_after_create'):
            self.setUp();self.control[flag]=True;r,p=self.create();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.state['saveAttempts'],0);self.assertEqual(self.control['removed'],[]);self.assertEqual(len(self.fb.children),1)
    def test_factory_returning_existing_different_property_cannot_delete_its_set(self):
        existing=self.fb.create_property('Keep','DINT','ST');before=[str(x.guid) for x in existing.children];self.control['return_existing_property']=True;self.args=self.request();r,p=self.create();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.control['removed'],[]);self.assertEqual([str(x.guid) for x in existing.children],before)
    def test_remove_partial_write_save_close_and_reopen_failures_unknown_no_rollback(self):
        for stage in ('remove','write','save','close','reopen'):
            self.setUp()
            if stage=='remove':self.control['fail_remove']=True
            elif stage=='write':self.control['fail_write']=True
            elif stage=='reopen':self.control['fail_reopen']=True
            else:setattr(self.p,stage,lambda:(_ for _ in ()).throw(RuntimeError('uncertain lifecycle')))
            r,p=self.create();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.control['factory_calls'],1);self.assertEqual(r['data']['recovery']['status'],'not-attempted');self.assertEqual(len(self.control['removed']),1)
            if stage=='remove':
                self.assertEqual(r['data']['accessorCleanup']['removalStatus'],'attempted');self.assertEqual(r['data']['accessorCleanup']['removedSetId'],self.control['removed'][0]);self.assertTrue(any(path.endswith('accessor-removal-intent.json') for path,data in self.published))
    def test_existing_writable_or_wrong_parent_accessor_not_supported(self):
        prop=self.fb.create_property('CurrentState','DINT','ST');prop.textual_declaration.replace(self.args['declaration']);self.assertIsNone(self.e['object_kind'](prop));self.assertTrue(all(self.e['object_kind'](x) is None for x in prop.children))
        prop.children=[x for x in prop.children if x.name=='Get'];getter=prop.children[0];self.assertEqual(self.e['object_kind'](getter),'property_get');getter.parent=self.fb;self.assertIsNone(self.e['object_kind'](getter));self.assertEqual(self.control['removed'],[])
    def test_existing_writable_property_list_reports_property_gap_and_retains_set(self):
        prop=self.fb.create_property('CurrentState','DINT','ST');prop.textual_declaration.replace(self.args['declaration']);self.p.save();self.manager.primary=None
        result=self.e['dispatch'](dict(self.req,command='list',args=dict(applicationId=self.app.guid,offset=0,limit=200)))
        self.assertEqual(result['status'],'succeeded',result);gaps=result['data']['scope']['unsupportedChildren'];self.assertEqual(len(gaps),3);self.assertTrue(all(x['stage']=='unsupported-property' for x in gaps));self.assertFalse(any(x['objectId']==str(prop.guid) for x in result['data']['objects']));self.assertEqual(self.control['removed'],[])
    def test_get_and_structure_changes_invalidate_snapshot_with_parent_text_unchanged(self):
        r,p=self.create();prop=next(x for x,n,a in self.e['walk'](p) if str(x.guid)==r['data']['objectId']);getter=prop.children[0];before=self.e['snapshot'](p);parent=self.fb.textual_declaration.text;getter.textual_implementation.replace('CurrentState := State + 1;');changed=self.e['snapshot'](p);self.assertNotEqual(before,changed);self.assertEqual(self.fb.textual_declaration.text,parent)
        setter=Node(p,'Set',declaration='',implementation='',nativeType=ACCESSOR);setter.parent=prop;setter.embedded_object_types=[ST];prop.children.append(setter);self.assertNotEqual(changed,self.e['snapshot'](p));self.assertFalse(self.e['property_structure'](prop)['readOnly'])
    def test_get_change_checks_property_structure_and_owner_without_string_assignment_ban(self):
        r,p=self.create();get=r['data']['getter'];self.manager.primary=None
        a=dict(applicationId=self.app.guid,objectId=get['objectId'],objectType='property_get',parentId=get['propertyId'],fbId=get['fbId'],expectedPropertyHash=get['propertyContentHash'],expectedAccessorVersion=get['accessorVersion'],expectedSnapshot=r['data']['snapshot'],expectedDiskHash='a'*64,expectedHash=get['contentHash'],declaration=get['declaration'],implementation='CurrentState := State + 1;')
        bad=dict(a,expectedAccessorVersion='f'*64);q=self.e['dispatch'](dict(self.req,command='change',args=bad));self.assertEqual(q['status'],'conflict',q)
        q=self.e['dispatch'](dict(self.req,command='change',args=a));self.assertEqual(q['status'],'succeeded',q);self.assertEqual(q['data']['implementation'],a['implementation']);self.assertEqual(q['data']['propertyContentHash'],a['expectedPropertyHash'])
    def test_complete_headers_get_locals_and_comments_mirrored_boundaries(self):
        self.assertTrue(self.e['property_header']('(* PUBLIC *) PROPERTY PUBLIC CurrentState : DINT',True));self.assertTrue(self.e['getter_declaration_matches']("VAR\n Text:STRING:='(*;, :=)'; (* ' *)\nEND_VAR"))
        for s in ['VAR_TEMP\nX:DINT;\nEND_VAR','VAR\nEND_VAR\nPROPERTY Other : DINT','(* unclosed','VAR\nEND_VAR\nX:=1;']:self.assertFalse(self.e['getter_declaration_matches'](s),s)
if __name__=='__main__':unittest.main()
