import copy
import unittest
import bridge_task_create_test as native

class CallInventoryOrderTest(unittest.TestCase):
    def case(self,tool):
        c=native.TaskCreateTest();c.setUp();self.addCleanup(c.doCleanups)
        if tool=='replace':c.prepare_replace()
        else:c.main.pous[:]=[['PLC_PRG','中文'],['Another',''],['Third','None']]
        c.other=c.make_task('Secondary','22222222-2222-4222-8222-222222222222',[['Other','保留'],['Last','None']])
        c.refresh_version()
        original=c.main.pous.replace if tool=='replace' else c.main.pous.add
        c.dispatches=0
        def dispatch(*args):
            c.dispatches+=1
            return original(*args)
        setattr(c.main.pous,tool if tool=='replace' else 'add',dispatch)
        return c

    def hook(self,c,stage,change):
        native=c.e['task_inventory'];reads=[0]
        def read(*args,**kw):
            value=native(*args,**kw);reads[0]+=1
            active=(stage=='predispatch' and reads[0]>1 and c.dispatches==0 or
                    stage=='immediate' and c.dispatches==1 and c.saves==0 or
                    stage=='reopened' and c.saves>0)
            if active:change(value)
            return value
        c.e['task_inventory']=read

    def positive(self,tool,stage):
        c=self.case(tool)
        self.hook(c,stage,lambda inv:inv['tasks'].reverse())
        r=getattr(c,tool)()
        self.assertEqual(r['status'],'succeeded',r)
        self.assertEqual((c.dispatches,c.saves),(1,1))
        before=copy.deepcopy(r['data']['before']);after=r['data']['after']
        self.assertEqual([t['taskId'] for t in before['tasks']],
                         ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'])
        target=next(t for t in after['tasks'] if t['taskId']==c.main.guid)
        self.assertEqual(target['rawCalls'],list(c.main.pous))
        self.assertEqual(next(t for t in after['tasks'] if t['taskId']==c.other.guid)['rawCalls'],list(c.other.pous))


    def negative(self,tool,stage,label,mutate):
        c=self.case(tool);disk=c.project_file.read_bytes()
        self.hook(c,stage,mutate)
        r=getattr(c,tool)()
        self.assertEqual(r['status'],'conflict' if stage=='predispatch' else 'unknown',(label,r))
        self.assertEqual(c.dispatches,0 if stage=='predispatch' else 1)
        self.assertEqual(c.saves,1 if stage=='reopened' else 0)
        if stage!='reopened':self.assertEqual(c.project_file.read_bytes(),disk)
        if stage!='predispatch':self.assertIs(r['data']['automaticRollback'],False)
        records=[d for name,d in c.events if name=='task-call-'+('afterAppend' if tool=='append' else 'afterReplace')+'-verification.json'
                 or name=='task-call-'+stage+'-verification.json']
        self.assertTrue(records,(label,c.events))
        self.assertEqual(records[-1]['status'],'failed')
        self.assertTrue(records[-1]['difference'] or records[-1]['primaryException'])
        self.assertIn('inventory',records[-1]['observed'])

    def publication(self,tool,stage,primary_fault=False):
        c=self.case(tool);publish=c.e['publish']
        if primary_fault:
            self.hook(c,stage,lambda inv:inv['tasks'][0]['rawCalls'].reverse())
        native_stage='afterAppend' if tool=='append' else 'afterReplace'
        native_stage=native_stage if stage=='immediate' else stage
        def broken(file,data):
            if 'task-call-'+native_stage+'-' in str(file):raise OSError('injected diagnostic failure')
            publish(file,data)
        c.e['publish']=broken
        r=getattr(c,tool)()
        self.assertEqual(r['status'],'conflict' if stage=='predispatch' else 'unknown',r)
        self.assertEqual(c.dispatches,0 if stage=='predispatch' else 1)
        self.assertEqual(c.saves,1 if stage=='reopened' else 0)
        self.assertTrue(r['data']['diagnosticErrors'])
        message=r['data']['primaryException']['message']
        self.assertIn('differs' if primary_fault else 'published',message)


    def native_facts_failure(self,tool,stage,kind):
        c=self.case(tool);disk=c.project_file.read_bytes()
        def change(inv):
            if kind=='source':c.program.textual_implementation.text='changed source'
            elif kind=='identity':c.program.guid='different'
            elif kind=='read-error':c.program.__class__=native.UnreadableProgram
            elif kind=='snapshot':c.e['snapshot']=lambda p:'changed snapshot'
            else:c.program.embedded_object_types=[]
        self.hook(c,stage,change)
        r=getattr(c,tool)()
        self.assertEqual(r['status'],'conflict' if stage=='predispatch' else 'unknown',r)
        self.assertEqual((c.dispatches,c.saves),(0 if stage=='predispatch' else 1,1 if stage=='reopened' else 0))
        if stage!='reopened':self.assertEqual(c.project_file.read_bytes(),disk)
        self.assertTrue(r['data']['primaryException']['message'])
        self.assertTrue(any(name.endswith('-observed.json') for name,data in c.events))

def row(inv):return inv['tasks'][0]
def other(inv):return inv['tasks'][1]
def setfield(inv,key,value):row(inv)[key]=value
def duplicate(inv):inv['tasks'].append(copy.deepcopy(row(inv)))
def add_task(inv):
    t=copy.deepcopy(row(inv));t['taskId']='33333333-3333-4333-8333-333333333333';inv['tasks'].append(t)
MUTATIONS={
 'target_calls_order':lambda inv:row(inv)['rawCalls'].reverse(),
 'other_calls_order':lambda inv:other(inv)['rawCalls'].reverse(),
 'call_add':lambda inv:row(inv)['rawCalls'].append(['Unexpected','']),
 'call_remove':lambda inv:row(inv)['rawCalls'].pop(),
 'call_name':lambda inv:row(inv)['rawCalls'][0].__setitem__(0,'Changed'),
 'comment':lambda inv:row(inv)['rawCalls'][0].__setitem__(1,'Changed'),
 'native_null':lambda inv:row(inv)['rawCalls'][2].__setitem__(1,None),
 'priority':lambda inv:row(inv)['rawFields'].__setitem__('priority','2'),
 'watchdog':lambda inv:row(inv)['watchdog'].__setitem__('enabled','True'),
 'interval':lambda inv:row(inv)['rawFields'].__setitem__('interval','t#9ms'),
 'task_removed':lambda inv:inv['tasks'].pop(),
 'task_added':add_task, 'task_duplicate':duplicate,
 'missing_id':lambda inv:row(inv).pop('taskId'),
 'zero_id':lambda inv:setfield(inv,'taskId','00000000-0000-0000-0000-000000000000'),
 'invalid_id':lambda inv:setfield(inv,'taskId','not-a-guid'),
 'case_duplicate_id':lambda inv:other(inv).__setitem__('taskId',row(inv)['taskId'].upper()),
 'path':lambda inv:row(inv)['path'].append('wrong'),
 'parent':lambda inv:row(inv)['path'].__setitem__(-2,'wrong'),
 'program_identity':lambda inv:inv['programs'][0].__setitem__('objectId','changed'),
 'missing_field':lambda inv:row(inv)['watchdog'].pop('time'),
 'wrong_type':lambda inv:row(inv)['rawFields'].__setitem__('priority',1),
 'incomplete':lambda inv:inv.__setitem__('coverageComplete',False),
 'read_error':lambda inv:inv['enumerationFailures'].append('read failed'),
 'calls_incomplete':lambda inv:setfield(inv,'callsComplete',False),
 'unavailable':lambda inv:row(inv)['unavailableFields'].append('watchdog'),
 'unknown_field':lambda inv:row(inv).__setitem__('future',[1,None,'None']),
}
for tool in ['append','replace']:
    for stage in ['predispatch','immediate','reopened']:
        for kind in ['source','identity','read-error','snapshot','language']:
            setattr(CallInventoryOrderTest,'test_'+tool+'_'+stage+'_native_'+kind,
                lambda self,t=tool,s=stage,k=kind:self.native_facts_failure(t,s,k))

for tool in ['append','replace']:
    for stage in ['predispatch','immediate','reopened']:
        for label,mutate in MUTATIONS.items():
            setattr(CallInventoryOrderTest,'test_'+tool+'_'+stage+'_'+label,
                    lambda self,t=tool,s=stage,l=label,m=mutate:self.negative(t,s,l,m))
        for primary in [False,True]:
            setattr(CallInventoryOrderTest,'test_'+tool+'_'+stage+'_publish_'+str(primary),
                    lambda self,t=tool,s=stage,p=primary:self.publication(t,s,p))

for tool in ['append','replace']:
    for stage in ['none','predispatch','immediate','reopened']:
        setattr(CallInventoryOrderTest,'test_'+tool+'_'+stage,
                lambda self,t=tool,s=stage:self.positive(t,s))

if __name__=='__main__':unittest.main()
