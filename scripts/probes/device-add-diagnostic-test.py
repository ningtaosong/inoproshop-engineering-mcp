"""Exercise the read-only stage diagnostics in CPython with native doubles."""
import ast
import unittest
from pathlib import Path
from types import SimpleNamespace as Obj

from device_add_preflight import Journal, ProbeRejected, first_difference, run_primary, verify_preflight


class Diagnostics(unittest.TestCase):
    def test_rejection_code_and_first_meaningful_tree_difference(self):
        journal = Journal(lambda number, event: None)
        initial = [{'guid':'a','path':['Device','Child'],'name':'Child'}]
        current = [dict(initial[0],guid='changed-guid')]
        plan = dict(name='S6bProbeDevice',parentGuid='a',nodes=initial,candidate={'identity':{'id':'candidate'}},
                    readableTasksAndST={'snapshot':'s','tasks':[]})
        def work():
            verify_preflight({'file_hash':lambda path:'seed'},'fixture','seed',None,plan,current,[],
                             {'matches':[]},plan['readableTasksAndST'],journal)
        run_primary(lambda callback:callback(),work,lambda:True,journal)
        failure=journal.primaryFailure
        self.assertEqual(failure['step'],'rejection')
        self.assertEqual(failure['error']['code'],'TREE_CHANGED')
        self.assertEqual(failure['error']['difference'],
                         {'path':'$.nodes[0].guid','expected':'a','actual':'changed-guid','objectPath':['Device','Child']})
        self.assertIn({'step':'rejection','state':'observed','evidence':{'rejection':'TREE_CHANGED'}},journal.events)
        self.assertIn('ProbeRejected',failure['error']['traceback'])
        self.assertIsNone(journal.cleanupError)

    def test_readonly_recheck_still_rejects_raw_task_proxy_guid_drift(self):
        journal=Journal(lambda number,event:None)
        parent=dict(guid='parent',name='Device',path=['Device'],explicit=True)
        task=dict(guid='task',name='MainTask',path=['MainTask'],nativeType='98a2708a-9b18-4f31-82ed-a1465b24fa2d')
        call=dict(guid='first-proxy',name='PLC_PRG',parentGuid='task',path=['MainTask','PLC_PRG'],
                  nativeType='413e2a7d-adb1-4d2c-be29-6ae6e4fab820')
        connector=dict(id=1,role='Parent',interface='Fixture.Bus',explicit=True)
        identity=dict(type='1152',id='fixture',deviceDescriptionVersion='1.0')
        candidate=dict(identity=identity,installedMatches=[identity],module=False,
                       compatibleChildConnectors=[dict(role='Child',interface='Fixture.Bus')])
        planned=[parent,task,call]
        live=[parent,task,dict(call,guid='second-proxy')]
        controls=dict(snapshot='s',tasks=[])
        plan=dict(nodes=planned,parentGuid='parent',index=0,name='S6bProbeDevice',parentConnector=connector,
                  readableTasksAndST=controls,candidate=candidate)
        placement=dict(node=parent,children=[],appendIndex=0,allowedAtAppend=['Fixture.Bus'],
                       nativeMethods={'insert':'signature'},observedConnectors=[connector])
        repo=dict(scope={'truncated':False,'enumerationFailures':[]},matches=[candidate])
        def work():
            verify_preflight({'file_hash':lambda path:'seed'},'fixture','seed',None,plan,
                             live,[placement],repo,controls,journal)
        run_primary(lambda callback:callback(),work,lambda:True,journal)
        self.assertIn({'step':'rejection','state':'observed','evidence':{'rejection':None}},journal.events)
        self.assertEqual(journal.primaryFailure['step'],'raw-tree-comparison')
        self.assertEqual(journal.primaryFailure['error']['code'],'RAW_TREE_CHANGED')
        self.assertEqual(journal.primaryFailure['error']['difference']['path'],'$.nodes[2].guid')

        style=dict(guid='first-style',name='__VisualizationStyle',path=['__VisualizationStyle'])
        planned.append(style)
        live.append(dict(style,guid='second-style'))
        journal=Journal(lambda number,event:None)
        run_primary(lambda callback:callback(),work,lambda:True,journal)
        self.assertEqual(journal.primaryFailure['error']['code'],'TREE_CHANGED')
        self.assertEqual(journal.primaryFailure['error']['difference']['objectPath'],['__VisualizationStyle'])
        context=next(row['evidence'] for row in journal.events if row['step']=='tree-difference-context')
        self.assertEqual(context['rawFirstDifference']['objectPath'],['MainTask','PLC_PRG'])
        self.assertEqual(context['guardFirstDifference']['expected'],'first-style')

    def test_inner_exception_kept_separate_from_wrapper_cleanup_and_log_errors(self):
        def failing_sink(number,row):
            if row['state']=='failed':
                raise OSError('log write failed')
        journal=Journal(failing_sink)
        class NativeError(ValueError):
            clsException=Obj(Message='wrapper .NET detail',StackTrace='Outer stack',
                             InnerException=Obj(Message='binding mismatch',StackTrace='Inner stack'))
        def native():
            raise NativeError('original failure')
        def cleanup():
            raise RuntimeError('close failed')
        def wrapper(callback):
            callback()
            raise ValueError('generic callback failed')
        run_primary(wrapper,lambda:journal.step('native-exact-description-readback',native),cleanup,journal)
        self.assertEqual(journal.primaryFailure['step'],'native-exact-description-readback')
        error=journal.primaryFailure['error']
        self.assertEqual(error['message'],'original failure')
        self.assertEqual(error['dotNetExceptionChain'][1]['message'],'binding mismatch')
        self.assertEqual(error['dotNetExceptionChain'][1]['stackTrace'],'Inner stack')
        self.assertIn('NativeError',error['traceback'])
        self.assertEqual(journal.wrapperError['message'],'generic callback failed')
        self.assertEqual(journal.cleanupError['message'],'close failed')
        self.assertEqual(len(journal.loggingErrors),3)

    def test_difference_checks_presence_and_reports_list_boundary(self):
        self.assertEqual(first_difference([1],[1,2])['path'],'$.length')
        self.assertFalse(first_difference({'name':None},{})['actualPresent'])

    def test_readonly_entry_and_shared_helpers_have_no_native_mutation_calls(self):
        here=Path(__file__).parent
        prohibited={'insert','plug','update','add','save','set_parameter','write_parameter','build','login','run'}
        for filename in ('device-add-readonly.py','device_add_preflight.py'):
            tree=ast.parse((here/filename).read_text(encoding='utf-8'))
            # sys.path.insert and set.add are ordinary Python container calls.
            calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
                   and n.func.attr in prohibited and ast.unparse(n.func.value)!='sys.path']
            self.assertEqual(calls,[],filename)


if __name__=='__main__':
    unittest.main(verbosity=2)
