"""Offline native doubles and archived inputs through the production task_create path."""
import ast
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as S

import bridge_task_create_test as doubles


def native_case(owner):
    case = doubles.TaskCreateTest()
    case.setUp()
    owner.addCleanup(case.doCleanups)
    return case


def archive_replay(case, worker=None):
    if worker:
        publish = case.e['publish']
        tree = ast.parse(Path(worker).read_text(encoding='utf8'))
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)], type_ignores=[]),
                     str(worker), 'exec'), case.e)
        case.e['publish'] = publish
    source = json.loads(Path('tests/fixtures/task-create-inventory-order.json').read_text(encoding='utf8'))
    common = source['before']
    facts = {k: common[k] for k in ('taskConfigurationPath', 'controller', 'program', 'programEmbeddedObjectTypes')}
    inventories = [common['before'], source['afterBind'], source['exceptionPartial']]
    calls = []
    def context(project, args, *unused, **kwargs):
        inv = copy.deepcopy(inventories[len(calls)])
        calls.append(inv)
        observer = kwargs.get('observe')
        if observer:
            observer(inv)
        return inv, case.config, copy.deepcopy(facts)
    case.e['task_create_context'] = context
    case.e['task_inventory'] = lambda *args: copy.deepcopy(source['exceptionPartial'])
    case.e['snapshot'] = lambda p: common['snapshot']
    case.e['lifecycle_save_reopen'] = case.save_reopen
    case.args = dict(source['args'], expectedDiskHash=case.e['file_hash'](str(case.project_file)))
    case.config.guid = case.args['taskConfigurationId']
    case.main.guid = common['before']['tasks'][0]['taskId']
    case.main.name = 'MainTask'
    task_id = next(t['taskId'] for t in source['afterBind']['tasks'] if t['path'][-1] == case.args['name'])
    def factory(name):
        case.factory_calls += 1
        return case.make_task(name, task_id)
    case.config.create_task = factory
    result = case.write()
    return dict(provenance=source['provenance'], status=result['status'], error=result.get('error'),
                factoryCalls=case.factory_calls, bindCalls=case.config.nodes[-1].pous.add_calls,
                saves=case.saves, rawOrders=[[t['path'][-1] for t in i['tasks']] for i in calls],
                originalInputsUnmodified=source==json.loads(Path('tests/fixtures/task-create-inventory-order.json').read_text(encoding='utf8')),
                events=case.events, result=result)


class TaskInventoryOrderTest(unittest.TestCase):
    def test_archived_partial_replayed_at_reopen_is_order_only_not_historical_proof(self):
        case = native_case(self)
        report = archive_replay(case)
        self.assertEqual(report['status'], 'succeeded', report.get('error'))
        self.assertEqual((report['factoryCalls'], report['bindCalls'], report['saves']), (1, 1, 1))
        self.assertEqual(report['rawOrders'][-2:], [['MainTask', 'StatusTask'], ['StatusTask', 'MainTask']])
        self.assertTrue(report['originalInputsUnmodified'])

    def test_multiple_old_tasks_can_reenumerate_after_bind_and_reopen(self):
        case = native_case(self)
        case.make_task('Secondary', 'secondary', [['Other', '中文'], ['Third', 'None']])
        case.refresh_version()
        publish = case.e['publish']
        def reorder_after_bind(path, data):
            publish(path, data)
            if Path(path).name == 'task-create-bind-end.json':
                case.config.nodes.reverse()
        case.e['publish'] = reorder_after_bind
        def reopen(state):
            value = case.save_reopen(state)
            case.config.nodes[:] = case.config.nodes[1:] + case.config.nodes[:1]
            return value
        case.e['lifecycle_save_reopen'] = reopen
        r = case.write()
        self.assertEqual(r['status'], 'succeeded', r)
        self.assertEqual((case.factory_calls, case.saves), (1, 1))
        self.assertNotEqual(r['data']['before']['tasks'][0]['taskId'], r['data']['after']['tasks'][0]['taskId'])
        self.assertEqual(next(t for t in r['data']['after']['tasks'] if t['taskId']=='secondary')['rawCalls'],
                         [['Other', '中文'], ['Third', 'None']])

    def mutate_inventory_read(self, case, number, mutate):
        original = case.e['task_inventory']
        counts = []
        def read(*args):
            inventory = copy.deepcopy(original(*args))
            counts.append(None)
            if len(counts) == number:
                mutate(inventory)
            return inventory
        case.e['task_inventory'] = read
        return counts

    def test_identity_coverage_and_missing_fields_reject_before_dispatch(self):
        cases = {
            'duplicate': lambda i:i['tasks'].append(copy.deepcopy(i['tasks'][0])),
            'empty ID': lambda i:i['tasks'][0].update(taskId=''),
            'null ID': lambda i:i['tasks'][0].update(taskId=None),
            'missing ID': lambda i:i['tasks'][0].pop('taskId'),
            'missing path': lambda i:i['tasks'][0].pop('path'),
            'parent changed': lambda i:i['tasks'][0]['path'].__setitem__(-2,'Elsewhere'),
            'missing field': lambda i:i['tasks'][0]['rawFields'].pop('priority'),
            'missing watchdog': lambda i:i['tasks'][0]['watchdog'].pop('enabled'),
            'read failed': lambda i:i['tasks'][0]['unavailableFields'].append({'field':'priority','reason':'failed'}),
            'coverage': lambda i:i.update(coverageComplete=False),
            'calls incomplete': lambda i:i['tasks'][0].update(callsComplete=False),
            'enumeration failure': lambda i:i['enumerationFailures'].append({'reason':'failed'}),
        }
        for label, mutate in cases.items():
            with self.subTest(label=label):
                case = native_case(self)
                self.mutate_inventory_read(case, 1, mutate)
                r = case.write()
                self.assertEqual(r['status'], 'conflict', r)
                self.assertEqual((case.factory_calls, case.saves, case.main.pous.add_calls), (0, 0, 0))
                self.assertEqual(case.e['file_hash'](str(case.project_file)),case.args['expectedDiskHash'])

    def test_preflight_strict_native_calls_distinguish_null_from_text(self):
        for row in ([None,''],['PLC_PRG',None],['PLC_PRG'],'AB'):
            with self.subTest(row=row):
                case=native_case(self)
                case.main.pous[:]=[row]
                case.refresh_version()
                r=case.write()
                self.assertEqual(r['status'],'conflict',r)
                self.assertEqual((case.factory_calls,case.saves),(0,0))
                self.assertEqual(case.e['file_hash'](str(case.project_file)),case.args['expectedDiskHash'])

    def test_preserved_inventory_differences_fail_after_bind_or_reopen(self):
        changes = {
            'remove task': lambda i:i['tasks'].pop(0),
            'extra task': lambda i:i['tasks'].append(dict(copy.deepcopy(i['tasks'][0]),taskId='extra')),
            'duplicate': lambda i:i['tasks'].append(copy.deepcopy(i['tasks'][0])),
            'missing identity': lambda i:i['tasks'][0].pop('taskId'),
            'path': lambda i:i['tasks'][0]['path'].__setitem__(-1,'Renamed'),
            'parent': lambda i:i['tasks'][0]['path'].__setitem__(-2,'WrongParent'),
            'Application': lambda i:i.update(applicationId='other'),
            'project': lambda i:i.update(projectId='other'),
            'project path': lambda i:i.update(projectPath='different'),
            'period': lambda i:i['tasks'][0]['rawFields'].update(interval='t#21ms'),
            'priority': lambda i:i['tasks'][0]['rawFields'].update(priority='2'),
            'watchdog': lambda i:i['tasks'][0]['watchdog'].update(enabled='True'),
            'binding': lambda i:i['tasks'][0]['rawCalls'][0].__setitem__(0,'Different'),
            'comment': lambda i:i['tasks'][0]['rawCalls'][0].__setitem__(1,'中文'),
            'call order': lambda i:i['tasks'][0]['rawCalls'].reverse(),
            'program identity': lambda i:i['programs'][0].update(objectId='other'),
            'program path': lambda i:i['programs'][0]['path'].__setitem__(-1,'Other'),
            'missing fields': lambda i:i['tasks'][0]['rawFields'].pop('priority'),
            'coverage': lambda i:i.update(coverageComplete=False),
            'read failure': lambda i:i['resolutionReadFailures'].append({'reason':'unreadable'}),
            'unexpected field': lambda i:i['tasks'][0].update(futureEvidence='changed'),
            'bool vs string': lambda i:i['tasks'][0]['watchdog'].update(enabled=False),
        }
        for stage, number, saves in [('after-bind',2,0),('reopen',3,1)]:
            for label, mutate in changes.items():
                with self.subTest(stage=stage, change=label):
                    case=native_case(self)
                    case.main.pous[:]=[['PLC_PRG',''],['Second','None']]
                    case.refresh_version()
                    self.mutate_inventory_read(case,number,mutate)
                    r=case.write()
                    self.assertEqual((r['status'],r['error']['code']),('unknown','TASK_CREATE_INCOMPLETE'),r)
                    self.assertEqual((case.factory_calls,case.saves),(1,saves))
                    self.assertFalse(r['data']['automaticRollback'])
                    events=dict(case.events)
                    self.assertIn('task-create-'+stage+'-observed.json',events)
                    record=events['task-create-'+stage+'-verification.json']
                    self.assertEqual(record['status'],'failed')
                    self.assertTrue(record['primaryException'])
                    self.assertNotIn('task-after-reopen.json',events)

    def test_reopened_new_task_default_change_is_detected_and_diff_published(self):
        case=native_case(self)
        self.mutate_inventory_read(case,3,lambda i:i['tasks'][-1]['watchdog'].update(sensitivity='2'))
        r=case.write()
        self.assertEqual(r['status'],'unknown',r)
        record=dict(case.events)['task-create-reopen-verification.json']
        self.assertEqual(record['difference']['path'],['tasks','new','watchdog','sensitivity'])
        self.assertEqual((record['difference']['expected'],record['difference']['actual']),('1','2'))
        self.assertEqual(dict(case.events)['task-create-reopen-observed.json']['tasks'][-1]['watchdog']['sensitivity'],'2')
        # Separate exception-time partial is original, not the actual compared failing input.
        self.assertEqual(r['data']['partial']['tasks'][-1]['watchdog']['sensitivity'],'1')

    def test_unknown_fields_and_types_are_not_dropped_or_collapsed(self):
        case=native_case(self)
        compare=case.e['task_create_difference']
        for a,b in [(None,''),(None,'None'),('', 'None'),(0,False),('1',1),([],{}),
                    ({'extra':None},{}),([['A',''],['B','']],[['B',''],['A','']])]:
            with self.subTest(expected=a,actual=b):
                self.assertIsNotNone(compare(a,b))
        self.assertIsNone(compare({'b':['None',None,'']},{'b':['None',None,'']}))

    def test_version_task_order_stable_but_call_order_not_stable(self):
        case=native_case(self)
        case.make_task('Other','other',[['A','中文'],['B','None']])
        inv=case.e['task_inventory'](case.project,case.args)
        unchanged=copy.deepcopy(inv)
        changed=copy.deepcopy(inv);changed['tasks'].reverse()
        v=case.e['task_configuration_version']
        self.assertEqual(v(inv),v(changed))
        self.assertIsNone(case.e['task_create_difference'](case.e['task_create_inventory_view'](inv),
                                                          case.e['task_create_inventory_view'](changed)))
        changed['tasks'][0]['rawCalls'].reverse()
        self.assertNotEqual(v(inv),v(changed))
        self.assertEqual(inv,unchanged)

    def test_diagnostic_failure_does_not_mask_original_native_language_exception(self):
        case=native_case(self)
        def reopen(state):
            value=case.save_reopen(state);case.program.__class__=doubles.UnreadableProgram
            return value
        case.e['lifecycle_save_reopen']=reopen
        publish=case.e['publish']
        def fail_log(path,data):
            if 'reopen-' in Path(path).name:raise OSError('diagnostic disk failure')
            publish(path,data)
        case.e['publish']=fail_log
        r=case.write()
        self.assertEqual(r['status'],'unknown')
        self.assertIn('Native embedded type read failed',r['data']['primaryException']['message'])
        self.assertEqual(len(r['data']['diagnosticErrors']),2)
        self.assertEqual((case.factory_calls,case.saves),(1,1))

    def test_log_failure_without_other_failure_stops_before_save(self):
        case=native_case(self)
        publish=case.e['publish']
        def fail_log(path,data):
            if Path(path).name=='task-create-after-bind-observed.json':raise OSError('log unavailable')
            publish(path,data)
        case.e['publish']=fail_log
        r=case.write()
        self.assertEqual(r['status'],'unknown')
        self.assertIn('evidence could not be published',r['data']['primaryException']['message'])
        self.assertEqual((case.factory_calls,case.saves),(1,0))

    def test_source_and_st_change_freeze_in_direct_and_legacy_copy_modes(self):
        for direct in (True,False):
            for fault in ('source','native ST'):
                with self.subTest(direct=direct,fault=fault):
                    case=native_case(self)
                    if direct:case.req['fileGuard']={'mode':'direct'}
                    def reopen(state):
                        value=case.save_reopen(state)
                        if fault=='source':case.program.textual_implementation.text='Changed := TRUE;'
                        else:case.program.embedded_object_types=[]
                        return value
                    case.e['lifecycle_save_reopen']=reopen
                    r=case.write()
                    self.assertEqual(r['status'],'unknown',r)
                    self.assertFalse(r['data']['automaticRollback'])
                    self.assertEqual((case.factory_calls,case.saves),(1,1))
                    self.assertEqual(case.project_file.read_bytes(),b'saved native fixture')


if __name__ == '__main__':
    if '--report' in sys.argv:
        worker = sys.argv[sys.argv.index('--worker')+1] if '--worker' in sys.argv else None
        owner = unittest.TestCase()
        case = native_case(owner)
        try:
            report = archive_replay(case, worker)
            report['workerSha256'] = hashlib.sha256(Path(worker or 'bridge/worker.py').read_bytes()).hexdigest()
            Path(sys.argv[sys.argv.index('--report')+1]).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps({k:report[k] for k in ('status','error','factoryCalls','bindCalls','saves','rawOrders')},ensure_ascii=False))
        finally:
            owner.doCleanups()
    else:
        unittest.main()
