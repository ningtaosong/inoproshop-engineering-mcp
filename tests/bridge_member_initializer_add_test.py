"""Production dispatch with native substitutes; no IDE or engineering project."""
import unittest
from types import SimpleNamespace
import bridge_pou_test as fixtures

GVL = 'ffbfa93a-b94d-45fc-a329-229860183b1d'
DUT = '2db5746d-d284-4425-9f7f-2663a34b0ebc'
SOURCE = 'VAR_GLOBAL\r\n // 中文😀 Config2 Enable\r\n Config2 : ST_EditConfig := (\r\n DelayTime := T#5s, Count := 7 // 原注释\r\n );\r\nEND_VAR\r\n'
TYPE = 'TYPE ST_EditConfig :\nSTRUCT\n Enable : BOOL;\n DelayTime : TIME;\n Count : DINT;\nEND_STRUCT\nEND_TYPE'

class MemberInsertion(unittest.TestCase):
    def scenario(self, stage=None, mode='copy'):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        f.manager.primary=None
        g=fixtures.Node(f.project,'GVL_Edit',declaration=SOURCE,nativeType=GVL)
        d=fixtures.Node(f.project,'ST_EditConfig',declaration=TYPE,nativeType=DUT)
        f.app.children.extend([g,d]);f.project.save()
        before=f.env['read_object'](g,['Application','GVL_Edit'],f.app.guid)
        dut=f.env['read_object'](d,['Application','ST_EditConfig'],f.app.guid)
        src=before['declaration'];at=src.index(');')
        offset=len(src[:at].encode('utf-16-le'))//2
        text=', Enable := TRUE';decl=src[:at]+text+src[at:]
        guard={k:dut[k] for k in ('objectId','applicationId','path','contentHash')}
        args=dict(applicationId=f.app.guid,objectId=g.guid,objectType='gvl',
                  expectedHash=before['contentHash'],expectedSnapshot=f.env['snapshot'](f.project),
                  expectedDiskHash='disk',declaration=decl,implementation='',variableEdit=True,
                  action='add-member-initializer',variableTypeGuard=guard,
                  memberInsertion=dict(startOffset=offset,endOffset=offset,text=text))
        calls=dict(open=0,write=0,save=0,close=0,checkpoint=0)
        original=f.manager.open
        def opened(path,primary):
            calls['open']+=1
            if stage=='reopen': 
                if calls['open']==2:raise RuntimeError('first reopen failure')
            p=original(path,primary);p.path=path
            target=next(x for x in p.children[0].children if x.guid==g.guid)
            rawreplace=target.textual_declaration.replace
            def replace(value):
                calls['write']+=1;rawreplace(value)
                if stage=='partial':raise RuntimeError('first write failure after mutation')
                if stage=='raw-change':target.textual_declaration.text=value.replace('\r\n','\n')
                if stage=='dut-after':
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
            if stage=='reopened-dut' and calls['open']==2:
                next(x for x in p.children[0].children if x.guid==d.guid).textual_declaration.text+=' // change'
            return p
        f.manager.open=opened
        def publish(path,value):
            f.published.append((path,value))
            if stage=='publish-before' and path.endswith('member-insertion-plan.json'):raise RuntimeError('first evidence publication failure')
            if stage=='publish-after' and path.endswith('member-insertion-immediate.json'):raise RuntimeError('first evidence publication failure')
        f.env.update(long=int,shutil=SimpleNamespace(copyfile=lambda *a:calls.__setitem__('checkpoint',calls['checkpoint']+1)),
                     file_hash=lambda p:'disk',publish=publish,
                     direct_file_guard=lambda req,state:{'beforeDiskHash':'disk'} if req.get('fileGuard') else None)
        req=dict(f.req,command='change',args=args)
        if mode=='direct':req['fileGuard']={'mode':'direct','expectedDiskHash':'disk'}
        if stage=='stale-dut':args['variableTypeGuard']['contentHash']='0'*64
        if stage=='stale-source':args['expectedHash']='0'*64
        if stage=='stale-disk':args['expectedDiskHash']='old'
        if stage=='bad-range':args['memberInsertion']['startOffset']+=1
        if stage=='missing-guard':del args['memberInsertion']
        if stage=='wrong-source':args['declaration']+='// unauthorized'
        if stage=='boolean-offset':args['memberInsertion']['startOffset']=True
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
                ev=r['data']['memberInsertionEvidence']
                self.assertEqual(ev['afterRawHash'],ev['immediateRawHash'])
                self.assertEqual(ev['afterRawHash'],ev['reopenedRawHash'])
                actual=next(x for x in f.manager.saved[0]['children'] if x['name']=='GVL_Edit')['declaration']
                at=SOURCE.index(');');self.assertEqual(actual,SOURCE[:at]+', Enable := TRUE'+SOURCE[at:])
                self.assertEqual(next(x for x in f.manager.saved[0]['children'] if x['name']=='ST_EditConfig')['declaration'],TYPE)

    def test_native_write_boundary_refuses_stale_or_invalid_evidence_without_write_or_save(self):
        for stage in ('stale-dut','stale-source','stale-disk','bad-range','missing-guard','wrong-source','boolean-offset'):
            with self.subTest(stage=stage):
                r,c,f,_=self.scenario(stage)
                self.assertIn(r['status'],('conflict','unsupported'),r)
                self.assertEqual(c['write'],0);self.assertEqual(c['save'],0)
                self.assertEqual(next(x for x in f.manager.saved[0]['children'] if x['name']=='GVL_Edit')['declaration'],SOURCE)

    def test_partial_and_evidence_failures_do_not_reverse_or_recover_save(self):
        for mode in ('copy','direct'):
            for stage in ('partial','raw-change','dut-after','publish-before','publish-after','save','reopen','reopened-raw','reopened-dut'):
                with self.subTest(mode=mode,stage=stage):
                    r,c,f,_=self.scenario(stage,mode)
                    self.assertEqual(r['status'],'unknown',r)
                    self.assertEqual(c['write'],0 if stage=='publish-before' else 1,c)
                    self.assertEqual(c['save'],1 if stage in ('save','reopen','reopened-raw','reopened-dut') else 0,c)
                    self.assertIn('primaryException',r['data'],r)
                    self.assertFalse(any(x['stage'].startswith('recovery-') for x in r['data']['lifecycle']['events']))
                    self.assertEqual(f.manager.control['removed'],[])

if __name__=='__main__':unittest.main(verbosity=2)
