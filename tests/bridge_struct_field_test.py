"""Production dispatch with native substitutes, never a real IDE result."""
import unittest,json
from types import SimpleNamespace
import bridge_pou_test as fixture

DUT='2db5746d-d284-4425-9f7f-2663a34b0ebc'
SOURCE='TYPE ST_Config :\r\nSTRUCT\r\n    (* 中文😀 *) Count : DINT := 7;\r\n    Delay : TIME := T#5s; // keep\r\nEND_STRUCT\r\nEND_TYPE\r\n'
class StructField(unittest.TestCase):
    def scenario(self,stage=None,mode='copy',typ='BOOL'):
        f=fixture.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp();f.manager.primary=None
        f.env.update(basestring=str,long=int)
        node=fixture.Node(f.project,'ST_Config',declaration=SOURCE,nativeType=DUT);node.parent=f.app;f.app.children.append(node)
        for x in f.app.children:x.parent=f.app;x.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
        f.project.save()
        inv={'applicationId':f.app.guid,'projectId':'30000000-0000-4000-8000-000000000001','targetKind':'application','projectPath':'test.project','applicationPath':['Application'],
            'coverageComplete':True,'enumerationFailures':[],'resolutionReadFailures':[],
            'tasks':[{'taskId':'40000000-0000-4000-8000-000000000001','path':['Application','Task Configuration','MainTask'],
                'rawFields':{k:'' for k in ['kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task']},
                'watchdog':{k:'' for k in ['enabled','time','time_unit','sensitivity']},'callsComplete':True,'unavailableFields':[],
                'rawCalls':[['PLC_PRG','中文'],['PLC_PRG','None'],['PLC_PRG','']]}],
            'programs':[{'objectId':f.app.children[0].guid,'path':['Application','PLC_PRG']}]}
        f.env['task_inventory']=lambda *a:json.loads(json.dumps(inv))
        before=f.env['read_object'](node,['Application','ST_Config'],f.app.guid)
        state=f.env['struct_field_state'](f.project,{},node,['Application','ST_Config'],f.app.guid)
        guard={'target':state['target'],'version':f.env['sha'](f.env['encode'](f.env['struct_field_state_view'](state)))}
        src=before['declaration'];at=src.index('END_STRUCT');offset=len(src[:at].encode('utf-16-le'))//2;added='    Enable : '+typ+';\n'
        args=dict(applicationId=f.app.guid,projectId=inv['projectId'],objectId=node.guid,objectType='structure',expectedHash=before['contentHash'],
                  expectedSnapshot=f.env['snapshot'](f.project),expectedDiskHash='disk',variableEdit=True,action='add-struct-field',name='Enable',type=typ,
                  declaration=src[:at]+added+src[at:],implementation='',structFieldGuard=guard,structFieldInsertion=dict(startOffset=offset,endOffset=offset,text=added))
        calls={'write':0,'save':0,'open':0,'close':0}
        orig=f.manager.open
        def opened(path,primary):
            calls['open']+=1
            if stage=='reopen-fail' and calls['open']==2:raise RuntimeError('first reopen error')
            p=orig(path,primary);p.path=path
            for x in p.children[0].children:x.parent=p.children[0];x.embedded_object_types=['3b83b776-fb25-43b8-99f2-3c507c9143fc']
            target=next(x for x in p.children[0].children if x.guid==node.guid)
            other=p.children[0].children[0]
            if stage=='before-source':other.textual_implementation.text+='changed'
            if stage=='before-parent':target.parent=other
            raw=target.textual_declaration.replace
            def replace(value):
                calls['write']+=1;raw(value)
                if stage=='partial':raise RuntimeError('first partial mutation')
                if stage=='source-after':other.textual_implementation.text+='changed'
                if stage=='ST-after':other.embedded_object_types=[]
                if stage=='task-after':inv['tasks'][0]['rawCalls'].reverse()
                if stage=='newline-after':target.textual_declaration.text=value.replace('\r\n','\n')
            target.textual_declaration.replace=replace
            save=p.save
            def saved():
                calls['save']+=1
                if stage=='save-fail':raise RuntimeError('first save error')
                save()
            p.save=saved
            def closed():
                calls['close']+=1
                if stage=='cleanup':raise RuntimeError('cleanup error')
            p.close=closed
            if calls['open']==2:
                if stage=='source-reopened':other.textual_implementation.text+='changed'
                if stage=='task-reopened':inv['tasks'][0]['rawCalls'][0][1]='None'
                if stage=='ST-reopened':other.embedded_object_types=[]
                if stage=='directory-reorder':p.children[0].children.reverse()
            return p
        f.manager.open=opened
        def publish(path,value):
            f.published.append((path,json.loads(json.dumps(value))))
            if stage=='publish-before' and path.endswith('struct-field-before.json'):raise RuntimeError('first publication error')
            if stage=='publish-after' and path.endswith('struct-field-immediate.json'):raise RuntimeError('first publication error')
            if stage=='publish-reopened' and path.endswith('struct-field-reopened.json'):raise RuntimeError('first publication error')
        f.env.update(shutil=SimpleNamespace(copyfile=lambda *a:None),file_hash=lambda p:'disk',publish=publish,
                     direct_file_guard=lambda req,state:{'beforeDiskHash':'disk'} if req.get('fileGuard') else None)
        req=dict(f.req,command='change',args=args)
        if mode=='direct':req['fileGuard']={'mode':'direct','expectedDiskHash':'disk'}
        if stage=='bad-offset':args['structFieldInsertion']['startOffset']+=1
        if stage=='missing-guard':del args['structFieldGuard']
        if stage=='old-hash':args['expectedHash']='0'*64
        if stage=='old-disk':args['expectedDiskHash']='old'
        if stage=='wrong-source':args['declaration']+=' // not authorized'
        result=f.env['dispatch'](req)
        return result,calls,f,args
    def test_production_dispatch_success_three_types_both_modes(self):
        for mode in ('copy','direct'):
            for typ in ('BOOL','DINT','TIME'):
                with self.subTest(mode=mode,typ=typ):
                    r,c,f,a=self.scenario(mode=mode,typ=typ);self.assertEqual(r['status'],'succeeded',r)
                    self.assertEqual(c['write'],1);self.assertEqual(c['save'],1);self.assertEqual(c['open'],2)
                    self.assertEqual(r['data']['declaration'],a['declaration'])
                    actual=next(x for x in f.manager.saved[0]['children'] if x['name']=='ST_Config')['declaration']
                    self.assertEqual(actual,SOURCE.replace('END_STRUCT','    Enable : '+typ+';\r\nEND_STRUCT'))
                    self.assertIn('structFieldEvidence',r['data'])
    def test_refusal_before_mutation(self):
        for stage in ('before-source','before-parent','bad-offset','missing-guard','old-hash','old-disk','wrong-source'):
            with self.subTest(stage=stage):
                r,c,f,a=self.scenario(stage);self.assertIn(r['status'],('unsupported','conflict'),r)
                self.assertEqual(c['write'],0);self.assertEqual(c['save'],0)
                self.assertEqual(next(x for x in f.manager.saved[0]['children'] if x['name']=='ST_Config')['declaration'],SOURCE)
    def test_uncertainty_preserves_first_error_and_never_rolls_back(self):
        for mode in ('copy','direct'):
            for stage in ('partial','source-after','ST-after','task-after','newline-after','save-fail','reopen-fail','source-reopened','task-reopened','ST-reopened','publish-before','publish-after','publish-reopened'):
                with self.subTest(stage=stage,mode=mode):
                    r,c,f,a=self.scenario(stage,mode);self.assertEqual(r['status'],'unknown',r)
                    self.assertEqual(c['write'],0 if stage=='publish-before' else 1)
                    self.assertEqual(c['save'],1 if stage in ('save-fail','reopen-fail','source-reopened','task-reopened','ST-reopened','publish-reopened') else 0)
                    self.assertIn('primaryException',r['data']);self.assertFalse(any(x['stage'].startswith('recovery-') for x in r['data']['lifecycle']['events']))
                    self.assertEqual(f.manager.control['removed'],[])
    def test_source_directory_reorder_is_allowed_but_original_snapshots_retained(self):
        r,c,f,a=self.scenario('directory-reorder');self.assertEqual(r['status'],'succeeded',r)
        e=r['data']['structFieldEvidence'];self.assertNotEqual([x['objectId'] for x in e['before']['sources']],[x['objectId'] for x in e['reopened']['sources']])
if __name__=='__main__':unittest.main()
