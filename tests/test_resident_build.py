# -*- coding: utf-8 -*-
"""Offline production-session/adapter coverage. No IDE or engineering file."""
import os,sys,copy,json,unittest,io
sys.path.insert(0,os.path.dirname(__file__))
from test_resident_core import c,Native,APP,OBJ,OTHER,state

def context(s):
    children=dict((k,[]) for k in s['nodes']);children['$project']=[]
    for oid,r in s['nodes'].items():children[r['parentId'] or '$project'].append(oid)
    return dict(scheme='resident-build-context-v1',children=children,devices={})

class BuildNative(Native):
    def __init__(self):
        Native.__init__(self);self.builds=0;self.compiled=[];self.fault=None;self.after_build=None
    def prepare_build(self,aid):
        if aid!=APP:raise c.Rejection('Wrong app')
    def build_context(self,s):return context(s)
    def compile_application(self,aid,publish,gate):
        publish('diagnostics-cleared.json',dict(categories=['compiler']))
        publish('build-call.json',dict(applicationId=aid));gate();self.builds+=1
        self.compiled.append(copy.deepcopy(self.state))
        if self.fault=='throw':raise ValueError('first compiler exception')
        publish('build-returned.json',dict(applicationId=aid))
        if self.after_build:self.after_build(self)
        rows=[dict(severity='error',text=u'本轮语法错误',category='compiler')] if self.fault=='error' else []
        result=dict(applicationId=aid,completed=True,diagnosticsComplete=True,diagnostics=rows,categories=[dict(category='compiler',count=len(rows),endObserved=True)])
        if self.fault=='missing':result['diagnosticsComplete']=False
        publish('compiler-result.json',result);return result

class BuildCases(unittest.TestCase):
    def setUp(self):
        self.n=BuildNative();self.disk='a'*64;self.records={};self.counter=0;self.pubfault=None;self.gatefault=None
        def publish(name,v):
            if name==self.pubfault:raise IOError('publish '+name)
            self.records[name]=copy.deepcopy(v)
        def gate():
            if self.gatefault:raise c.Conflict(self.gatefault)
        self.n.on_save=lambda:setattr(self,'disk',c.digest(self.n.state))
        self.s=c.ResidentSession(self.n,lambda:self.disk,publish,gate,lambda ready:dict(scheme=ready['scheme'],requestHash=ready['requestHash'],readyHash=c.digest(ready),beforeDisk=ready['beforeDisk']))
    def call(self,command,**args):
        self.counter+=1;return self.s.handle(dict(command=command,args=dict(applicationId=APP,**args),operationId=str(self.counter),requestId=str(self.counter),directory='offline',savePolicy='resident-confirmed-change-save-v1',initialDisk=dict(diskHash=self.disk,fileIdentity='test')))
    def read(self):return self.call('read',objectId=OBJ)
    def build(self,version=None):return self.call('build',expectedResidentVersion=version or self.read()['data']['residentVersion'])
    def change(self,text):
        r=self.read()['data'];return self.call('change',objectId=OBJ,declaration=r['declaration'],implementation=text,expectedHash=r['contentHash'],expectedResidentVersion=r['residentVersion'])
    def test_edit_save_build_read_edit_uses_current_memory(self):
        self.change('x := 7; // 未保存');before=self.read()['data'];r=self.build(before['residentVersion'])
        self.assertEqual(r['status'],'succeeded',r);self.assertEqual(r['data']['buildInputResidentVersion'],before['residentVersion'])
        self.assertEqual(self.n.compiled[0]['nodes'][OBJ]['implementation'],'x := 7; // 未保存')
        self.assertEqual(r['data']['builtSourceVersion'],c.build_source_version(self.n.compiled[0],APP))
        self.assertEqual(self.read()['data']['implementation'],'x := 7; // 未保存')
        self.assertEqual(self.change('x := 8;')['status'],'succeeded');self.assertEqual(self.n.builds,1);self.assertEqual(self.n.saves,2);self.assertFalse(self.n.closed)
        for k in ('saveCalls','closeCalls','exitCalls'):self.assertEqual(r['data'][k],0)
    def test_compiler_error_is_completed_and_can_be_corrected(self):
        self.n.fault='error';r=self.build();self.assertEqual(r['status'],'succeeded');self.assertFalse(r['data']['buildPassed']);self.assertEqual(r['data']['errorCount'],1)
        self.assertIsNone(self.s.poison);self.assertEqual(self.change('x := 8;')['status'],'succeeded');self.n.fault=None;self.assertTrue(self.build()['data']['buildPassed'])
    def test_stale_or_missing_version_zero_build(self):
        for version in [None,'b'*64]:
            r=self.call('build',expectedResidentVersion=version);self.assertEqual(r['status'],'conflict');self.assertTrue(r['data']['recoverableRejection'])
        self.assertEqual(self.n.builds,0);self.assertEqual(self.n.saves,0)
    def test_change_during_predispatch_zero_build(self):
        r=self.read();self.n.hook=lambda n:n.state['nodes'][OTHER].update(implementation='changed') if n.reads==3 else None
        self.assertEqual(self.build(r['data']['residentVersion'])['status'],'conflict');self.assertEqual(self.n.builds,0)
    def test_change_during_clearing_stops_at_final_gate(self):
        prior=self.s.publish
        def publish(name,value):
            prior(name,value)
            if name=='diagnostics-cleared.json':self.n.state['nodes'][OBJ]['implementation']='external change'
        self.s.publish=publish;r=self.build();self.assertEqual(r['status'],'unknown');self.assertEqual(self.n.builds,0);self.assertEqual(self.n.saves,0);self.assertIn('build-input.json',self.records);self.assertRaises(c.Conflict,self.read)
    def test_invocation_and_diagnostic_failures_freeze(self):
        for fault in ['throw','missing']:
            self.setUp();self.n.fault=fault;r=self.build();self.assertEqual(r['status'],'unknown',r);self.assertRaises(c.Conflict,self.read);self.assertEqual(self.n.builds,1);self.assertEqual(self.n.saves,0)
    def test_changed_source_library_task_or_unknown_field_freezes(self):
        for key,value in [('implementation','bad'),('directLibraries',[]),('calls',[['Keep','None']]),('extra',None)]:
            self.setUp();self.n.after_build=lambda n:n.state['nodes'][OTHER].update({key:value});r=self.build();self.assertEqual(r['status'],'unknown');self.assertIn('Compiler changed existing node',r['data']['firstError']['message']);self.assertRaises(c.Conflict,self.read)
    def test_disk_changed_after_build_is_unknown(self):
        def mutate(n):self.disk='b'*64
        self.n.after_build=mutate;self.assertEqual(self.build()['status'],'unknown');self.assertEqual(self.n.saves,0)
    def test_publication_failure_retains_first_error(self):
        for file in ['build-context-before.json','checkpoint.json','dispatch.json','build-input.json','compiler-result.json','build-after-state.json','after.json','verification.json']:
            self.setUp();self.pubfault=file;r=self.build();self.assertEqual(r['status'],'unknown',r);self.assertEqual(r['data']['firstError']['message'],'publish '+file);self.assertEqual(self.n.saves,0);self.assertRaises(c.Conflict,self.read)
    def test_diagnostic_null_empty_unknown_and_counts(self):
        base=dict(applicationId=APP,completed=True,diagnosticsComplete=True,diagnostics=[],categories=[dict(category='c',count=0,endObserved=True)])
        self.assertTrue(c.checked_diagnostics(base,APP)['buildPassed'])
        for mutation in [lambda d:d.update(categories=[]),lambda d:d['categories'][0].update(count=1),lambda d:d.update(diagnostics=None),lambda d:d.update(applicationId=OBJ),lambda d:d.update(diagnostics=[dict(severity='unknown',text='x',category='c')])]:
            d=copy.deepcopy(base);mutation(d);self.assertRaises((ValueError,TypeError),c.checked_diagnostics,d,APP)
    def test_existing_sibling_reorder_is_not_permitted(self):
        before=state();pre=context(before);post=copy.deepcopy(pre);post['children'][APP].reverse()
        self.assertRaises(ValueError,c.build_conservation,before,before,pre,post)
    def test_background_libraries_not_direct_references_may_load(self):
        r=self.read()
        def add(n):
            if n.reads==3:n.state['openedProjects']['7']=dict(handle=7,path='background.library',primary=False,library=True)
        self.n.hook=add;self.assertEqual(self.build(r['data']['residentVersion'])['status'],'succeeded')
    def test_historical_native_derived_tree_and_precise_counterexamples(self):
        with io.open(os.path.join(os.path.dirname(__file__),'fixtures','resident-build-derived-native.json'),encoding='utf-8') as f:fixture=json.load(f)
        a=fixture['before'];b=fixture['after'];derived='04d1db87-e030-46c5-9073-df66a1b4f522';root='bae96937-5e0e-48a6-8b2a-2ca00576a271'
        self.assertEqual(c.build_conservation(a['state'],b['state'],a['context'],b['context'])['addedDeviceIds'],[derived])
        for change in [lambda s,x:s['nodes'][derived].update(nativeTypeId=APP),lambda s,x:x['devices'][derived]['identity'].update(version='wrong'),lambda s,x:x['devices'][derived]['connectors'][0].update(role='Parent'),lambda s,x:x['children'][root].reverse(),lambda s,x:x['children'][root].append(derived),lambda s,x:s['nodes'][root].update(extra=True),lambda s,x:x['devices'].pop(root),lambda s,x:x.update(extra=True)]:
            new=copy.deepcopy(b);change(new['state'],new['context']);self.assertRaises((ValueError,KeyError),c.build_conservation,a['state'],new['state'],a['context'],new['context'])

class NativeCompileCases(unittest.TestCase):
    def setUp(self):
        self.records={};self.calls=0;self.disk='a';self.error=None
        outer=self
        class App(object):
            def build(self):outer.calls+=1
        class Message(object):severity='Warning';text=u'中文诊断';line=1
        class System(object):
            def get_message_categories(self):return ['old'] if outer.calls==0 else ['old','new']
            def clear_messages(self,k):
                if outer.error=='clear':raise ValueError('clear error')
            def get_message_objects(self,k):
                if outer.error=='collect':raise ValueError('collect error')
                return [] if k=='old' else [Message()]
        self.a=object.__new__(c.NativeProjectAdapter);self.a._owned=lambda:None;self.a.system=System();self.a.objects={APP:App()};self.a.attempts=dict(build=0)
    def publish(self,n,v):self.records[n]=copy.deepcopy(v)
    def test_public_build_reenumerates_and_preserves_diagnostics(self):
        result=self.a.compile_application(APP,self.publish,lambda:None)
        self.assertEqual(self.calls,1);self.assertEqual(result['diagnostics'][0]['text'],u'中文诊断');self.assertEqual(c.checked_diagnostics(result,APP)['warningCount'],1)
        self.assertTrue(self.a.compile_progress['returned'])
    def test_gate_after_clearing_and_publication_prevents_native_build(self):
        def reject():
            self.assertIn('diagnostics-cleared.json',self.records);self.assertIn('build-call.json',self.records)
            raise c.Conflict('expired / stop / disk / lease changed')
        self.assertRaises(c.Conflict,self.a.compile_application,APP,self.publish,reject);self.assertEqual(self.calls,0);self.assertFalse(self.a.compile_progress['invoked'])
    def test_clear_and_collect_failures_are_not_false_success(self):
        for fault,expected in [('clear',0),('collect',1)]:
            self.setUp();self.error=fault;self.assertRaises(ValueError,self.a.compile_application,APP,self.publish,lambda:None);self.assertEqual(self.calls,expected)

if __name__=='__main__':unittest.main()
