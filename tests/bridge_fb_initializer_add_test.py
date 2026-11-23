"""Production dispatch with native substitutes; no IDE or engineering project."""
import unittest
from types import SimpleNamespace
import bridge_pou_test as fixtures

GVL = 'ffbfa93a-b94d-45fc-a329-229860183b1d'
DUT = '2db5746d-d284-4425-9f7f-2663a34b0ebc'
SOURCE = 'VAR_GLOBAL\r\n // 中文😀 Config2 Enable\r\n Delay : TIME (* 保留中文😀 *) ;\r\nEND_VAR\r\n'
TYPE = 'TYPE ST_EditConfig :\nSTRUCT\n Enable : BOOL;\n DelayTime : TIME;\n Count : DINT;\nEND_STRUCT\nEND_TYPE'

class InterfaceInsertion(unittest.TestCase):
    def scenario(self, stage=None, mode='copy', scope='function_block', section='VAR_INPUT'):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        f.manager.primary=None
        source=SOURCE if scope=='gvl' else scope.upper()+' GVL_Edit'+(' : DINT' if scope=='function' else '')+'\r\n'+SOURCE.replace('VAR_GLOBAL','VAR',1)
        source=source.replace('VAR\r\n',section+'\r\n',1)
        implementation='// 中文😀 raw\r\n' if scope!='gvl' else None
        g=fixtures.Node(f.project,'GVL_Edit',declaration=source,implementation=implementation,nativeType=GVL if scope=='gvl' else '6f9dac99-8de1-4efc-8465-68ac443b7d08')
        g.parent=f.app;g.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
        d=fixtures.Node(f.project,'ST_EditConfig',declaration=TYPE,nativeType=DUT)
        f.app.children.extend([g,d])
        m=fixtures.Node(f.project,'ReadCount',declaration='METHOD PUBLIC ReadCount : DINT\r\nVAR\r\nEND_VAR',implementation='ReadCount := 7;',nativeType='f8a58466-d7f6-439f-bbb8-d4600e41d099')
        prop=fixtures.Node(f.project,'Value',declaration='PROPERTY PUBLIC Value : DINT',nativeType='5a3b8626-d3e9-4f37-98b5-66420063d91e')
        for role in ('Get','Set'):
            prop.children.append(fixtures.Node(f.project,role,declaration='VAR\r\nEND_VAR',implementation='Value := 7;' if role=='Get' else '// keep',nativeType='792f2eb6-721e-4e64-ba20-bc98351056db'))
        g.children=[m,prop]
        def wire(node,parent):
            node.parent=parent;node.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc'] if node.has_textual_implementation else []
            for x in node.children:wire(x,node)
        wire(g,f.app);f.project.save()
        before=f.env['read_object'](g,['Application','GVL_Edit'],f.app.guid)
        dut=f.env['read_object'](d,['Application','ST_EditConfig'],f.app.guid)
        src=before['declaration'];at=src.index(';')
        offset=len(src[:at].encode('utf-16-le'))//2
        text=' := T#8s';decl=src[:at]+text+src[at:]
        guard=f.env['initializer_target_evidence'](f.project,g,['Application','GVL_Edit'],f.app.guid,section)
        args=dict(applicationId=f.app.guid,objectId=g.guid,objectType=before['objectType'],
                  expectedHash=before['contentHash'],expectedSnapshot=f.env['snapshot'](f.project),
                  expectedDiskHash='disk',declaration=decl,implementation=before['implementation'],variableEdit=True,
                  action='add-initializer',section=section,initializerTargetGuard=guard,
                  initializerInsertion=dict(startOffset=offset,endOffset=offset,text=text))
        calls=dict(open=0,write=0,save=0,close=0,checkpoint=0)
        original=f.manager.open
        def opened(path,primary):
            calls['open']+=1
            if stage=='reopen':
                if calls['open']==2:raise RuntimeError('first reopen failure')
            p=original(path,primary);p.path=path
            target=next(x for x in p.children[0].children if x.guid==g.guid)
            wire(target,p.children[0])
            if stage=='bad-parent':target.children[0].parent=p.children[0]
            if stage=='duplicate-child':target.children.append(target.children[0])
            if stage=='unsupported-child':target.children[0].type='00000000-0000-4000-8000-000000000000'
            if stage=='reopened-child' and calls['open']==2:target.children[0].textual_implementation.text+=' changed'
            if stage=='missing-ST':target.embedded_object_types=[]
            if stage=='reopened-ST' and calls['open']==2:target.embedded_object_types=[]
            def implementation_write(value):raise RuntimeError('Implementation replace must not be called')
            target.textual_implementation.replace=implementation_write
            rawreplace=target.textual_declaration.replace
            def replace(value):
                calls['write']+=1;rawreplace(value)
                if stage=='partial':raise RuntimeError('first write failure after mutation')
                if stage=='child-after':target.children[0].textual_implementation.text+=' changed'
                if stage=='impl-after':target.textual_implementation.text+='changed'
                if stage=='ST-after':target.embedded_object_types=[]
                if stage=='raw-change':target.textual_declaration.text=value.replace('\r\n','\n')
                if stage=='unused-dut-after':
                    next(x for x in p.children[0].children if x.guid==d.guid).textual_declaration.text+=' // change'
            target.textual_declaration.replace=replace
            save=p.save
            def saved():
                calls['save']+=1
                if stage=='save':raise RuntimeError('first save failure')
                save()
            def closed():
                calls['close']+=1
                if stage=='cleanup':raise RuntimeError('cleanup failure')
            p.save=saved;p.close=closed
            if stage=='reopened-raw' and calls['open']==2:target.textual_declaration.text=target.textual_declaration.text.replace('\r\n','\n')
            if stage=='unused-reopened-dut' and calls['open']==2:
                next(x for x in p.children[0].children if x.guid==d.guid).textual_declaration.text+=' // change'
            return p
        f.manager.open=opened
        def publish(path,value):
            f.published.append((path,value))
            if stage=='publish-before' and path.endswith('initializer-insertion-plan.json'):raise RuntimeError('first evidence publication failure')
            if stage=='publish-after' and path.endswith('initializer-insertion-immediate.json'):raise RuntimeError('first evidence publication failure')
        f.env.update(long=int,shutil=SimpleNamespace(copyfile=lambda *a:calls.__setitem__('checkpoint',calls['checkpoint']+1)),
                     file_hash=lambda p:'disk',publish=publish,
                     direct_file_guard=lambda req,state:{'beforeDiskHash':'disk'} if req.get('fileGuard') else None)
        req=dict(f.req,command='change',args=args)
        if mode=='direct':req['fileGuard']={'mode':'direct','expectedDiskHash':'disk'}
        if stage=='stale-target':args['initializerTargetGuard']['parentId']='0'*36
        if stage=='stale-source':args['expectedHash']='0'*64
        if stage=='stale-disk':args['expectedDiskHash']='old'
        if stage=='bad-range':args['initializerInsertion']['startOffset']+=1
        if stage=='missing-guard':del args['initializerInsertion']
        if stage=='wrong-source':args['declaration']+='// unauthorized'
        if stage=='boolean-offset':args['initializerInsertion']['startOffset']=True
        r=f.env['dispatch'](req)
        return r,calls,f,decl


    def test_success_both_sections_and_modes_with_method_property_get_set(self):
        for mode in ('copy','direct'):
            for section in ('VAR_INPUT','VAR_OUTPUT'):
                with self.subTest(mode=mode,section=section):
                    r,c,f,decl=self.scenario(mode=mode,section=section)
                    self.assertEqual(r['status'],'succeeded',r);self.assertEqual(c['write'],1);self.assertEqual(c['save'],1)
                    self.assertEqual(r['data']['declaration'],decl)
                    e=r['data']['initializerTargetReadback'];self.assertEqual(len(e['before']['interfaceChildren']['rows']),4)
                    self.assertEqual(e['before'],e['immediate']);self.assertEqual(e['before'],e['reopened'])
    def test_zero_write_on_invalid_native_evidence(self):
        for stage in ('bad-parent','duplicate-child','unsupported-child','missing-ST','stale-target','stale-source','stale-disk','bad-range','missing-guard'):
            with self.subTest(stage=stage):
                r,c,f,_=self.scenario(stage)
                self.assertIn(r['status'],('unsupported','conflict'),r);self.assertEqual(c['write'],0);self.assertEqual(c['save'],0)
    def test_first_failure_and_no_recovery_in_direct_and_copy(self):
        for mode in ('copy','direct'):
            for stage in ('partial','publish-before','publish-after','child-after','reopened-child','ST-after','reopened-ST','raw-change','save','reopen','reopened-raw'):
                with self.subTest(mode=mode,stage=stage):
                    r,c,f,_=self.scenario(stage,mode)
                    self.assertEqual(r['status'],'unknown',r);self.assertIn('primaryException',r['data'])
                    self.assertEqual(c['write'],0 if stage=='publish-before' else 1)
                    self.assertEqual(c['save'],1 if stage in ('reopened-child','reopened-ST','save','reopen','reopened-raw') else 0)
                    self.assertFalse(any(x['stage'].startswith('recovery-') for x in r['data']['lifecycle']['events']))
                    self.assertEqual(f.manager.control['removed'],[])
if __name__=='__main__':unittest.main(verbosity=2)
