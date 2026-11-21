"""Archived inputs plus actual production create/append/replace paths; no IDE."""
import copy,json,unittest
from pathlib import Path
from types import SimpleNamespace as S
import bridge_task_create_test as native
import bridge_task_call_inventory_order_test as calls

class ProgramInventoryTest(unittest.TestCase):
    def case(self,tool):
        c=calls.CallInventoryOrderTest.case(self,tool) if tool!='create' else native.TaskCreateTest()
        if tool=='create':c.setUp();self.addCleanup(c.doCleanups)
        native.Node('PRG_Other','cccccccc-cccc-4ccc-8ccc-cccccccccccc',c.program.type,c.app,
                    has_textual_declaration=True,has_textual_implementation=True,pou_type='program',
                    embedded_object_types=[native.ST_IMPLEMENTATION_TYPE],
                    textual_declaration=S(text='PROGRAM PRG_Other\nVAR\nEND_VAR'),
                    textual_implementation=S(text=''))
        c.refresh_version()
        return c
    def run_case(self,c,tool):return c.write() if tool=='create' else getattr(c,tool)()
    def hook(self,c,tool,stage,change):
        read=c.e['task_inventory'];n=[0]
        def sample(*a,**kw):
            v=read(*a,**kw);n[0]+=1
            dispatched=c.factory_calls if tool=='create' else c.dispatches
            active=(stage=='initial' and n[0]==1 or
                    stage=='predispatch' and n[0]>1 and dispatched==0 or
                    stage=='immediate' and dispatched==1 and c.saves==0 or
                    stage=='reopened' and c.saves>0)
            if active:change(v)
            return v
        c.e['task_inventory']=sample
    def positive(self,tool,stage,which):
        c=self.case(tool);orders=[]
        def reorder(v):
            if which in ('programs','both'):v['programs'].reverse()
            if which in ('tasks','both'):v['tasks'].reverse()
            orders.append(copy.deepcopy(v))
        self.hook(c,tool,stage,reorder)
        r=self.run_case(c,tool)
        self.assertEqual(r['status'],'succeeded',r)
        self.assertEqual((c.factory_calls if tool=='create' else c.dispatches,c.saves),(1,1))
        self.assertTrue(orders)
        self.assertEqual(next(t for t in r['data']['after']['tasks'] if t['taskId']==c.main.guid)['rawCalls'],list(c.main.pous))
    def negative(self,tool,stage,kind,mutate):
        c=self.case(tool);before=c.project_file.read_bytes()
        self.hook(c,tool,stage,mutate)
        r=self.run_case(c,tool)
        pre=stage in ('initial','predispatch')
        self.assertEqual(r['status'],'conflict' if pre else 'unknown',(kind,r))
        self.assertEqual(c.factory_calls if tool=='create' else c.dispatches,0 if pre else 1)
        self.assertEqual(c.saves,1 if stage=='reopened' else 0)
        if stage!='reopened':self.assertEqual(c.project_file.read_bytes(),before)
        if not pre:
            self.assertFalse(r['data']['automaticRollback'])
            self.assertTrue(r['data']['primaryException'])
            self.assertTrue(any('observed' in n for n,_ in c.events))
    def test_archive_both_production_comparisons(self):
        c=self.case('append')
        v=json.loads(Path('tests/fixtures/task-program-inventory-order.json').read_text(encoding='utf8'))
        original=copy.deepcopy(v)
        for name in ['task_call_inventory_view','task_create_inventory_view']:
            self.assertIsNone(c.e['task_create_difference'](c.e[name](v['before']),c.e[name](v['after'])))
        self.assertEqual(original,v)
        self.assertEqual(c.e['task_configuration_version'](v['before']),c.e['task_configuration_version'](v['after']))

def program(v):return v['programs'][-1]
changes={
 'removed':lambda v:v['programs'].pop(),
 'added':lambda v:v['programs'].append(dict(copy.deepcopy(program(v)),objectId='dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
 'duplicate':lambda v:v['programs'].append(copy.deepcopy(program(v))),
 'case_duplicate':lambda v:v['programs'].append(dict(copy.deepcopy(program(v)),objectId=program(v)['objectId'].upper())),
 'missing_id':lambda v:program(v).pop('objectId'),
 'null_id':lambda v:program(v).update(objectId=None),
 'invalid_id':lambda v:program(v).update(objectId='not-native'),
 'zero_id':lambda v:program(v).update(objectId='00000000-0000-0000-0000-000000000000'),
 'path':lambda v:program(v)['path'].append('different'),
 'missing_path':lambda v:program(v).pop('path'),
 'new_field':lambda v:program(v).update(future=[None,'','None']),
 'wrong_path_type':lambda v:program(v).update(path='path'),
 'missing_catalog':lambda v:v.pop('programs'),
}
invalid_initial={'duplicate','case_duplicate','missing_id','null_id','invalid_id','zero_id','missing_path','wrong_path_type','missing_catalog'}
for tool in ['create','append','replace']:
    for stage in ['immediate','reopened']+([] if tool=='create' else ['predispatch']):
        for which in ['programs','tasks','both']:
            setattr(ProgramInventoryTest,'test_'+tool+'_'+stage+'_'+which,
                    lambda self,t=tool,s=stage,w=which:self.positive(t,s,w))
        for name,mutate in changes.items():
            setattr(ProgramInventoryTest,'test_'+tool+'_'+stage+'_reject_'+name,
                    lambda self,t=tool,s=stage,n=name,m=mutate:self.negative(t,s,n,m))
    for name in invalid_initial:
        setattr(ProgramInventoryTest,'test_'+tool+'_initial_reject_'+name,
                lambda self,t=tool,n=name,m=changes[name]:self.negative(t,'initial',n,m))
if __name__=='__main__':unittest.main()
