"""Production functions/dispatch with native doubles only; never submit negative input to IDE."""
import json,unittest
from pathlib import Path
from types import SimpleNamespace
import bridge_pou_test as fixtures

CASES=json.loads(Path('tests/fixtures/declaration-lexing.json').read_text(encoding='utf8'))

class DeclarationLexing(unittest.TestCase):
    def fixture(self):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        f.env['scriptengine'].DutType=SimpleNamespace(Structure='Structure',Enumeration='Enumeration',Alias='Alias')
        return f
    def test_shared_read_write_bounds_and_old_types(self):
        f=self.fixture()
        for c in CASES:
            with self.subTest(case=c['id']):
                self.assertEqual(f.env['declaration_matches'](c['kind'],c['name'],c['text']),c['read'])
                self.assertEqual(f.env['declaration_matches'](c['kind'],c['name'],c['text'],True),c['write'])
                if c['kind']=='array':
                    bounds=c.get('bounds')
                    self.assertEqual(f.env['array_bounds'](c['name'],c['text']),None if bounds is None else (bounds['lower'],bounds['upper']))
    def test_rejected_creation_never_calls_native_factory(self):
        for c in CASES:
            if c['kind']!='array' or c['write']:continue
            with self.subTest(case=c['id']):
                f=self.fixture();before=f.project.manager.saved
                args=dict(applicationId=f.app.guid,parentId=f.app.guid,expectedSnapshot=f.before,name='T_Values',objectType='array',declaration=c['text'])
                r,p=f.env['create_declaration'](f.project,f.req,args)
                self.assertEqual(r['error']['code'],'INVALID_DECLARATION');self.assertEqual(f.manager.control['factory_calls'],0)
                self.assertEqual(f.manager.saved,before)
    def test_rejected_change_never_replaces_saves_or_changes_original(self):
        for c in CASES:
            if c['kind']!='array' or c['write']:continue
            with self.subTest(case=c['id']):
                f=self.fixture();original="TYPE T_Values : ARRAY [1..3] OF DINT; END_TYPE"
                node=fixtures.Node(f.project,'T_Values',declaration=original,nativeType='2db5746d-d284-4425-9f7f-2663a34b0ebc');f.app.children.append(node);f.project.save()
                native_open=f.manager.open;counts={'replace':0,'save':0}
                def opened(*a,**kw):
                    p=native_open(*a,**kw);p.path=a[0]
                    def save():counts['save']+=1;raise AssertionError('invalid input must not save')
                    p.save=save
                    for item,names,aid in f.env['walk'](p):
                        if item.get_name()=='T_Values':
                            def replace(v):counts['replace']+=1;raise AssertionError('invalid input must not replace')
                            item.textual_declaration.replace=replace
                    return p
                f.manager.primary=None;f.manager.open=opened;f.env['shutil']=SimpleNamespace(copyfile=lambda *a:None)
                before=f.env['read_object'](node,['Application','T_Values'],f.app.guid)
                req=dict(f.req,command='change',args=dict(applicationId=f.app.guid,objectId=node.guid,objectType='array',expectedHash=before['contentHash'],declaration=c['text']))
                r=f.env['dispatch'](req)
                self.assertEqual(r['error']['code'],'OBJECT_TYPE_MISMATCH',r);self.assertEqual(counts,{'replace':0,'save':0})
                self.assertEqual(f.manager.saved[0]['children'][-1]['declaration'],original)
    def test_unsupported_full_text_is_not_recognized_as_readable_array(self):
        f=self.fixture()
        for c in CASES:
            if c['kind']!='array':continue
            with self.subTest(case=c['id']):
                n=fixtures.Node(f.project,'T_Values',declaration=c['text'],nativeType='2db5746d-d284-4425-9f7f-2663a34b0ebc')
                self.assertEqual(f.env['object_kind'](n),'array' if c['read'] else None)
                self.assertEqual(f.env['read_object'](n,['Application','T_Values'],f.app.guid)['declaration'],c['text'])
    def test_legal_comment_text_survives_alias_factory_save_and_reopen(self):
        f=self.fixture();c=next(c for c in CASES if c['id']=='comment-quotes-markers')
        args=dict(applicationId=f.app.guid,parentId=f.app.guid,expectedSnapshot=f.before,name='T_Values',objectType='array',declaration=c['text'])
        r,p=f.env['create_declaration'](f.project,f.req,args)
        self.assertEqual(r['status'],'succeeded',r);self.assertEqual(r['data']['declaration'],c['text'])
        self.assertEqual(f.manager.control['dut_factory_arguments'],[['T_Values','Alias','ARRAY [1..3] OF DINT']])

if __name__=='__main__':unittest.main(verbosity=2)
