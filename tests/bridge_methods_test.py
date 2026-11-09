"""Production Method functions with native-object substitutes, not IDE evidence."""
import ast,hashlib,json,os,re,unittest
from pathlib import Path
from types import SimpleNamespace
from bridge_pou_test import Node,Project,Manager

METHOD='f8a58466-d7f6-439f-bbb8-d4600e41d099'
class Methods(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf-8'));module=ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[])
        self.e=dict(unicode=str,hashlib=hashlib,json=json,re=re,os=os,CONTRACT='1.0.0');exec(compile(module,'bridge/worker.py','exec'),self.e)
        self.manager=Manager();self.control=self.manager.control;self.p=Project(self.manager);self.app=self.p.children[0]
        self.fb=Node(self.p,'FB_State',declaration='FUNCTION_BLOCK FB_State\nVAR\n State:DINT:=7;\nEND_VAR',implementation='');self.app.children.append(self.fb)
        def attach(p):
            def visit(node,parent):
                node.parent=parent
                node.embedded_object_types=["3b83b776-fb25-43b8-99f2-3c507c9143fc"]
                for x in node.children:visit(x,node)
            for x in p.children:visit(x,p)
            p.user_management=SimpleNamespace(get_object_permission=lambda item,kind:SimpleNamespace(check_permission=lambda prompt:False if self.control.get('deny_permission') else True))
            return p
        self.attach=attach;attach(self.p);self.p.save()
        original_open=self.manager.open
        def reopen(path,primary):
            if self.control.get('fail_reopen'):raise RuntimeError('reopen uncertain')
            return attach(original_open(path,primary))
        self.manager.open=reopen
        def factory(node,name,ret,lang):
            self.control['factory_calls']+=1;self.control['factory_args']=[name,ret,lang]
            native='6f9dac99-8de1-4efc-8465-68ac443b7d08' if self.control.get('wrong_type') else METHOD
            result=Node(node.project,name,declaration='METHOD '+name+(' : '+('INT' if self.control.get('wrong_return') else ret) if ret else '')+'\nVAR_INPUT\nEND_VAR',implementation='',nativeType=native);result.parent=node;result.embedded_object_types=[] if self.control.get("wrong_language") else ["3b83b776-fb25-43b8-99f2-3c507c9143fc"];node.children.append(result);return result
        Node.create_method=factory
        self.published=[];self.e.update(projects=self.manager,publish=lambda p,v:self.published.append((p,v)),file_hash=lambda p:'a'*64,
          method_file_writable=lambda p:None,scriptengine=SimpleNamespace(ImplementationLanguages=SimpleNamespace(st='ST'),ObjectPermissionKind=SimpleNamespace(Modify='Modify',AddRemoveChildren='AddRemoveChildren')))
        self.req=dict(projectPath='test.project',checkpointPath='checkpoint.project',resultPath='operation/result.json')
        self.state=self.e['lifecycle_state'](self.p,'test.project');self.args=self.arguments('ReadState','DINT')
    def arguments(self,name,ret):
        return dict(applicationId=self.app.guid,parentId=self.fb.guid,name=name,access='PUBLIC',returnType=ret,expectedSnapshot=self.e['snapshot'](self.p),expectedDiskHash='a'*64,expectedParentHash=self.e['content_hash'](self.fb.textual_declaration.text,''),declaration='METHOD PUBLIC '+name+(' : DINT' if ret=='DINT' else '')+'\nVAR_INPUT\nEND_VAR',implementation=name+' := State;' if ret=='DINT' else 'State := 0;')
    def run_create(self):return self.e['create_method'](self.p,self.req,self.args,self.state)
    def test_void_and_dint_factory_parameters_identity_parent_and_reopen(self):
        for name,ret in [('ResetState','void'),('ReadState','DINT')]:
            self.setUp();self.args=self.arguments(name,ret);before=self.e['snapshot'](self.p);result,p=self.run_create();self.assertEqual(result['status'],'succeeded',result)
            d=result['data'];self.assertEqual(self.control['factory_args'],[name,'' if ret=='void' else 'DINT','ST']);self.assertEqual(d['parentId'],self.fb.guid);self.assertEqual(d['nativeTypeId'],METHOD);self.assertTrue(d['reopened']);self.assertEqual(self.state['saveAttempts'],1);self.assertNotEqual(before,d['snapshot']);self.assertFalse(self.control['removed'])
    def test_invalid_header_parent_scope_and_versions_never_call_factory(self):
        for patch in [dict(declaration='METHOD PUBLIC Wrong : DINT'),dict(parentId=self.app.guid),dict(applicationId='other-app'),dict(expectedSnapshot='f'*64),dict(expectedParentHash='f'*64),dict(expectedDiskHash='f'*64)]:
            a=dict(self.args);self.args.update(patch);r,p=self.run_create();self.assertIn(r['status'],('failed','unsupported','conflict'));self.assertEqual(self.control['factory_calls'],0);self.args=a
    def test_unknown_or_non_st_parent_and_method_are_never_accepted(self):
        self.fb.embedded_object_types=[]
        r,p=self.run_create();self.assertEqual(r['status'],'unsupported');self.assertEqual(self.control['factory_calls'],0)
        self.fb.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
        m=self.fb.create_method('ReadState','DINT','ST');m.textual_declaration.replace(self.args['declaration']);m.embedded_object_types=[]
        self.assertIsNone(self.e['object_kind'](m))
    def test_same_parent_case_insensitive_collision_refused(self):
        child=Node(self.p,'readstate',declaration='METHOD PUBLIC readstate : DINT',implementation='',nativeType=METHOD);child.parent=self.fb;self.fb.children.append(child);self.args=self.arguments('ReadState','DINT')
        r,p=self.run_create();self.assertEqual(r['error']['code'],'METHOD_EXISTS');self.assertEqual(self.control['factory_calls'],0)
    def test_parent_permission_refused_without_factory_or_permission_mutation(self):
        self.control['deny_permission']=True;r,p=self.run_create();self.assertEqual(r['status'],'unsupported');self.assertEqual(self.control['factory_calls'],0)
    def test_bad_factory_identity_or_return_freezes_without_deleting_new_object(self):
        for flag in ['wrong_type','wrong_return','wrong_language']:
            self.setUp();self.control[flag]=True;r,p=self.run_create();self.assertEqual(r['status'],'unknown');self.assertEqual(self.control['factory_calls'],1);self.assertEqual(len(self.fb.children),1);self.assertFalse(self.control['removed']);self.assertEqual(self.state['saveAttempts'],0)
    def test_partial_implementation_failure_retains_actions_no_rollback(self):
        self.control['fail_write']=True;r,p=self.run_create();self.assertEqual(r['status'],'unknown');self.assertIn('declaration-replaced',r['data']['actions']);self.assertEqual(self.state['saveAttempts'],0);self.assertFalse(self.control['removed']);self.assertEqual(r['data']['recovery']['status'],'not-attempted')
    def test_save_close_and_reopen_failure_not_retried(self):
        for stage in ['save','close','reopen']:
            self.setUp()
            if stage=='reopen':self.control['fail_reopen']=True
            else:
                def fail():raise RuntimeError(stage+' uncertain')
                setattr(self.p,stage,fail)
            r,p=self.run_create();self.assertEqual(r['status'],'unknown');self.assertEqual(self.state['saveAttempts'],1);self.assertFalse(self.control['removed'])
    def test_read_classifier_never_calls_pou_factory_for_method(self):
        m=self.fb.create_method('ReadState','DINT','ST');m.textual_declaration.replace(self.args['declaration']);self.assertEqual(self.e['object_kind'](m),'method');self.assertFalse(self.e['st_object'](m));r=self.e['read_object'](m,['Application','FB_State','ReadState'],self.app.guid);self.assertEqual(r['methodReturnType'],'DINT');self.assertEqual(r['parentId'],self.fb.guid)
    def test_whole_declaration_boundaries_and_unsupported_access_are_rejected(self):
        self.assertTrue(self.e['method_matches']('ReadState','METHOD PUBLIC ReadState : DINT\nVAR\n VAR_InputSetting:VAR_Result;\nEND_VAR','DINT','PUBLIC'))
        valid=self.args['declaration'];self.assertTrue(self.e['method_matches']('ReadState',valid,'DINT','PUBLIC'))
        for s in [valid+'\nMETHOD PUBLIC Extra',valid.replace('PUBLIC','PRIVATE'),valid.replace('DINT','BOOL'),valid+'\nX := 1;',valid+'\n(* unclosed']:
            self.assertFalse(self.e['method_matches']('ReadState',s,'DINT','PUBLIC'),s)
if __name__=='__main__':unittest.main()
