"""Production dispatch with native substitutes; no IDE or engineering project."""
import unittest
from types import SimpleNamespace
import bridge_pou_test as fixtures

GVL = 'ffbfa93a-b94d-45fc-a329-229860183b1d'
DUT = '2db5746d-d284-4425-9f7f-2663a34b0ebc'
SOURCE = 'VAR_GLOBAL\r\n // 中文😀 Config2 Enable\r\n Delay : TIME (* 保留中文😀 *) ;\r\nEND_VAR\r\n'
TYPE = 'TYPE ST_EditConfig :\nSTRUCT\n Enable : BOOL;\n DelayTime : TIME;\n Count : DINT;\nEND_STRUCT\nEND_TYPE'

class InitializerInsertion(unittest.TestCase):
    def scenario(self, stage=None, mode='copy', scope='gvl'):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        f.manager.primary=None
        source=SOURCE if scope=='gvl' else scope.upper()+' GVL_Edit'+(' : DINT' if scope=='function' else '')+'\r\n'+SOURCE.replace('VAR_GLOBAL','VAR',1)
        implementation='// 中文😀 raw\r\n' if scope!='gvl' else None
        g=fixtures.Node(f.project,'GVL_Edit',declaration=source,implementation=implementation,nativeType=GVL if scope=='gvl' else '6f9dac99-8de1-4efc-8465-68ac443b7d08')
        g.parent=f.app;g.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
        d=fixtures.Node(f.project,'ST_EditConfig',declaration=TYPE,nativeType=DUT)
        f.app.children.extend([g,d]);f.project.save()
        before=f.env['read_object'](g,['Application','GVL_Edit'],f.app.guid)
        dut=f.env['read_object'](d,['Application','ST_EditConfig'],f.app.guid)
        src=before['declaration'];at=src.index(';')
        offset=len(src[:at].encode('utf-16-le'))//2
        text=' := T#8s';decl=src[:at]+text+src[at:]
        guard=f.env['initializer_target_evidence'](f.project,g,['Application','GVL_Edit'],f.app.guid)
        args=dict(applicationId=f.app.guid,objectId=g.guid,objectType=before['objectType'],
                  expectedHash=before['contentHash'],expectedSnapshot=f.env['snapshot'](f.project),
                  expectedDiskHash='disk',declaration=decl,implementation=before['implementation'],variableEdit=True,
                  action='add-initializer',initializerTargetGuard=guard,
                  initializerInsertion=dict(startOffset=offset,endOffset=offset,text=text))
        calls=dict(open=0,write=0,save=0,close=0,checkpoint=0)
        original=f.manager.open
        def opened(path,primary):
            calls['open']+=1
            if stage=='reopen':
                if calls['open']==2:raise RuntimeError('first reopen failure')
            p=original(path,primary);p.path=path
            target=next(x for x in p.children[0].children if x.guid==g.guid)
            target.parent=p.children[0];target.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
            if stage=='missing-ST':target.embedded_object_types=[]
            if stage=='reopened-ST' and calls['open']==2:target.embedded_object_types=[]
            def implementation_write(value):raise RuntimeError('Implementation replace must not be called')
            target.textual_implementation.replace=implementation_write
            rawreplace=target.textual_declaration.replace
            def replace(value):
                calls['write']+=1;rawreplace(value)
                if stage=='partial':raise RuntimeError('first write failure after mutation')
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

    def test_production_success_preserves_raw_crlf_comments_and_astral_text_in_both_modes(self):
        for mode in ('copy','direct'):
            with self.subTest(mode=mode):
                r,c,f,decl=self.scenario(mode=mode)
                self.assertEqual(r['status'],'succeeded',r)
                self.assertEqual(c['write'],1);self.assertEqual(c['save'],1)
                self.assertEqual(c['open'],2)
                self.assertEqual(r['data']['declaration'],decl)
                ev=r['data']['initializerInsertionEvidence']
                self.assertEqual(ev['afterRawHash'],ev['immediateRawHash'])
                self.assertEqual(ev['afterRawHash'],ev['reopenedRawHash'])
                actual=next(x for x in f.manager.saved[0]['children'] if x['name']=='GVL_Edit')['declaration']
                at=SOURCE.index(';');self.assertEqual(actual,SOURCE[:at]+' := T#8s'+SOURCE[at:])
                self.assertEqual(next(x for x in f.manager.saved[0]['children'] if x['name']=='ST_EditConfig')['declaration'],TYPE)

    def test_native_write_boundary_refuses_stale_or_invalid_evidence_without_write_or_save(self):
        for stage in ('stale-target','stale-source','stale-disk','bad-range','missing-guard','wrong-source','boolean-offset'):
            with self.subTest(stage=stage):
                r,c,f,_=self.scenario(stage)
                self.assertIn(r['status'],('conflict','unsupported'),r)
                self.assertEqual(c['write'],0);self.assertEqual(c['save'],0)
                self.assertEqual(next(x for x in f.manager.saved[0]['children'] if x['name']=='GVL_Edit')['declaration'],SOURCE)

    def test_partial_and_evidence_failures_do_not_reverse_or_recover_save(self):
        for mode in ('copy','direct'):
            for stage in ('partial','raw-change','publish-before','publish-after','save','reopen','reopened-raw'):
                with self.subTest(mode=mode,stage=stage):
                    r,c,f,_=self.scenario(stage,mode)
                    self.assertEqual(r['status'],'unknown',r)
                    self.assertEqual(c['write'],0 if stage=='publish-before' else 1,c)
                    self.assertEqual(c['save'],1 if stage in ('save','reopen','reopened-raw') else 0,c)
                    self.assertIn('primaryException',r['data'],r)
                    self.assertFalse(any(x['stage'].startswith('recovery-') for x in r['data']['lifecycle']['events']))
                    self.assertEqual(f.manager.control['removed'],[])

    def test_native_program_function_and_fb_require_st_through_reopen(self):
        for scope in ('program','function','function_block'):
            for mode in ('direct','copy'):
                with self.subTest(scope=scope,mode=mode):
                    r,c,f,decl=self.scenario(mode=mode,scope=scope)
                    self.assertEqual(r['status'],'succeeded',r)
                    self.assertEqual(c['write'],1);self.assertEqual(c['save'],1)
                    saved=next(x for x in f.manager.saved[0]['children'] if x['name']=='GVL_Edit')
                    self.assertEqual(saved['implementation'],'// 中文😀 raw\r\n')
                    ev=r['data']['initializerInsertionEvidence']
                    self.assertEqual(ev['beforeImplementationRawHash'],ev['reopenedImplementationRawHash'])
            for stage in ('missing-ST','ST-after','reopened-ST','impl-after'):
                with self.subTest(scope=scope,stage=stage):
                    r,c,f,decl=self.scenario(stage,scope=scope)
                    if stage=='missing-ST':
                        self.assertNotEqual(r['status'],'succeeded');self.assertEqual(c['write'],0);self.assertEqual(c['save'],0)
                    else:
                        self.assertEqual(r['status'],'unknown',r);self.assertEqual(c['write'],1)
                        self.assertEqual(c['save'],1 if stage=='reopened-ST' else 0)

if __name__=='__main__':unittest.main(verbosity=2)
