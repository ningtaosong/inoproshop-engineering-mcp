"""Production task_create and readbacks against native API doubles."""
import ast
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace as S
from unittest.mock import patch


ST_IMPLEMENTATION_TYPE = '3b83b776-fb25-43b8-99f2-3c507c9143fc'


class Node:
    def __init__(self, name, guid, native_type, parent=None, **fields):
        self.name, self.guid, self.type, self.parent = name, guid, native_type, parent
        self.nodes = []
        if parent is not None:
            parent.nodes.append(self)
        self.__dict__.update(fields)

    def get_name(self):
        return self.name

    def get_children(self, recursive):
        return self.nodes


class UnreadableProgram(Node):
    @property
    def embedded_object_types(self):
        raise RuntimeError('Native embedded type read failed')


class Calls(list):
    def __init__(self, rows=(), fail=False):
        super().__init__(rows)
        self.fail = fail
        self.add_calls = 0

    def add(self, name, comment):
        self.add_calls += 1
        self.append([name, comment])
        if self.fail:
            raise RuntimeError('The native bind may have taken effect')


class TaskCreateTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name)
        self.project_file = self.path / 'AM610.project'
        self.project_file.write_bytes(b'unsaved probe fixture')
        tree = ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
        self.e = dict(unicode=str,basestring=str,long=int,hashlib=hashlib,json=json,os=os,re=re,shutil=shutil,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x, ast.FunctionDef)],type_ignores=[]),
                     'bridge/worker.py','exec'), self.e)
        root = self.project = Node(str(self.project_file),'root','project',path=str(self.project_file))
        device = Node('Device','device','device-type',root,is_device=True,
                      get_device_identification=lambda:S(type=4102,id='10f4 0002',version='3.5.11.11'))
        logic = Node('Plc Logic','logic','logic-type',device)
        self.app = Node('Application','app','app-type',logic,is_application=True)
        self.config = Node('Task Configuration','config','task-config-type',self.app,is_task_configuration=True)
        self.main = self.make_task('MainTask','11111111-1111-4111-8111-111111111111',[['PLC_PRG','']])
        self.program = Node('PRG_S8Probe','program','6f9dac99-8de1-4efc-8465-68ac443b7d08',self.app,
                            has_textual_declaration=True,has_textual_implementation=True,language='ST',pou_type='program',
                            embedded_object_types=[ST_IMPLEMENTATION_TYPE.upper()])
        # The call wrapper is not a second PROGRAM, though its displayed name matches.
        Node('PRG_S8Probe','wrapper','413e2a7d-adb1-4d2c-be29-6ae6e4fab820',self.main)
        self.events=[];self.factory_calls=0;self.saves=0;self.fail=False;self.wrong_reopen=False
        def create(name):
            self.factory_calls+=1
            return self.make_task(name,'new',fail=self.fail)
        self.config.create_task=create
        self.program.textual_declaration=S(text='PROGRAM PRG_S8Probe\nVAR\nEND_VAR')
        self.program.textual_implementation=S(text='')
        program_hash=self.e['content_hash'](self.program.textual_declaration.text,'')
        self.e.update(snapshot=lambda p:'source-hash', publish=lambda p,d:self.events.append((Path(p).name,json.loads(json.dumps(d)))),
                      lifecycle_save_reopen=self.save_reopen)
        io=types.ModuleType('System.IO');io.File=S(GetAttributes=lambda f:0);io.FileAttributes=S(ReadOnly=1)
        io.FileStream=lambda *args:S(Dispose=lambda:None);io.FileMode=S(Open=1);io.FileAccess=S(ReadWrite=1);io.FileShare=S(ReadWrite=1)
        modules=patch.dict(sys.modules,{'System':types.ModuleType('System'),'System.IO':io})
        modules.start()
        self.addCleanup(modules.stop)
        self.args=dict(projectId='project',applicationId='app',targetKind='application',name='ProbeTask',intervalMs=50,
                       taskConfigurationId='config',programId='program',expectedProgramHash=program_hash,
                       expectedDiskHash=self.e['file_hash'](str(self.project_file)))
        self.refresh_version()
        self.req=dict(projectPath=str(self.project_file),resultPath=str(self.path/'result.json'),checkpointPath=str(self.path/'checkpoint.project'))

    def make_task(self,name,guid,calls=(),fail=False):
        return Node(name,guid,'task-type',self.config,is_task=True,kind_of_task='Cyclic',priority='1',interval='t#20ms',
                    interval_unit='ms',event_pou_guid='event',event='',external_event='',core_binding='-2',parent_synchron_task='',
                    watchdog=S(enabled=False,time='',time_unit='ms',sensitivity='1'),pous=Calls(calls,fail))

    def refresh_version(self):
        self.args['expectedTaskVersion']=self.e['task_configuration_version'](self.e['task_inventory'](self.project,self.args))

    def save_reopen(self,state):
        self.saves+=1
        self.project_file.write_bytes(b'saved native fixture')
        if self.wrong_reopen:
            self.main.pous.reverse()
            self.main.pous.append(['unexpected',''])
        return self.project

    def write(self, **overrides):
        return self.e['task_create'](self.project,self.req,dict(self.args,**overrides),{'project':self.project})[0]

    def append(self, **overrides):
        args=dict(self.args,taskId=self.main.guid,**overrides)
        return self.e['task_call_append'](self.project,self.req,args,{'project':self.project})[0]

    def prepare_replace(self):
        old=Node('Old','old',self.program.type,self.app,has_textual_declaration=True,
                 has_textual_implementation=True,embedded_object_types=[ST_IMPLEMENTATION_TYPE],
                 textual_declaration=S(text='PROGRAM Old\\nVAR\\nEND_VAR'),textual_implementation=S(text=''))
        self.main.pous[:]=[['First',''],['Middle','中文'],['Old','None']]
        self.main.pous.replace=lambda i,n,c:self.main.pous.__setitem__(i,[n,c])
        self.e['task_replace_ide_version']=lambda:'1.9.1.6'
        self.refresh_version()
        self.args.update(taskId=self.main.guid,oldProgramId='old',expectedOldProgramHash=self.e['content_hash'](old.textual_declaration.text,''),
                         expectedCallOrder=2,expectedCall=['Old','None'],expectedSourceSnapshot='source-hash')
        return old

    def replace(self,**kw):
        return self.e['task_call_replace'](self.project,self.req,dict(self.args,**kw),{'project':self.project})[0]

    def test_replace_last_row_preserves_native_comments_both_programs_and_other_tasks(self):
        self.prepare_replace()
        self.make_task('OtherTask','22222222-2222-4222-8222-222222222222',[['First','keep']])
        self.refresh_version()
        r=self.replace()
        self.assertEqual(r['status'],'succeeded',r)
        self.assertEqual(r['data']['afterReplace'],r['data']['after'])
        self.assertEqual(r['data']['programReads']['afterReplace'],r['data']['programReads']['reopened'])
        self.assertEqual(self.main.pous,[['First',''],['Middle','中文'],['PRG_S8Probe','None']])
        self.assertEqual(self.saves,1)

    def test_replace_preflight_guards_have_zero_native_writes_saves_and_unchanged_disk(self):
        old=self.prepare_replace()
        original=[row[:] for row in self.main.pous]
        def unexpected(*args):self.fail('unexpected native replace')
        self.main.pous.replace=unexpected
        for label,rows,overrides in [
            ('missing',original[:2],{}),('duplicate',original+[['old','other']],{}),
            ('mixed order',original[::-1],{}),('wrong index',original,dict(expectedCallOrder=0)),
            ('different comment',original,dict(expectedCall=['Old',''])),('new already exists',original+[['prg_s8probe','']],{}),
            ('malformed',[['First',None]]+original[1:],{}),('string row',['AB']+original[1:],{}),
            ('native null',[[None,'']]+original[1:],{}),('short row',[['First']]+original[1:],{}),
            ('old==new',original,dict(oldProgramId='program',expectedOldProgramHash=self.args['expectedProgramHash'])),
            ('wrong ID',original,dict(programId='wrapper')),('task version',original,dict(expectedTaskVersion='stale')),
            ('changed old source',original,dict(expectedOldProgramHash='stale')),('changed new source',original,dict(expectedProgramHash='stale')),
            ('snapshot',original,dict(expectedSourceSnapshot='changed')),('disk',original,dict(expectedDiskHash='stale'))]:
            with self.subTest(label=label):
                self.main.pous[:]=rows
                self.refresh_version()
                self.assertEqual(self.replace(**overrides)['status'],'conflict')
        self.main.pous[:]=original
        self.refresh_version()
        for obj in (old,self.program):
            for mode in ('missing','wrong','raises'):
                with self.subTest(program=obj.name,mode=mode):
                    obj.embedded_object_types=[] if mode=='missing' else ['not-st']
                    if mode=='raises':obj.__class__=UnreadableProgram
                    self.assertEqual(self.replace()['status'],'conflict')
                    obj.__class__=Node;obj.embedded_object_types=[ST_IMPLEMENTATION_TYPE]
        duplicate=Node('oLd','duplicate',old.type,self.app,has_textual_declaration=True,textual_declaration=old.textual_declaration)
        self.assertEqual(self.replace()['status'],'conflict')
        self.app.nodes.remove(duplicate)
        self.assertEqual((self.saves,self.events),(0,[]))
        self.assertEqual(self.e['file_hash'](str(self.project_file)),self.args['expectedDiskHash'])

    def test_replace_partial_setters_and_lost_binding_in_both_registration_modes(self):
        self.prepare_replace()
        for direct in (True,False):
            for fault in ('name','comment','after-read','reopen'):
                with self.subTest(direct=direct,fault=fault):
                    self.main.pous[2]=['Old','None']
                    self.program.embedded_object_types=[ST_IMPLEMENTATION_TYPE]
                    self.project_file.write_bytes(b'unsaved probe fixture')
                    self.saves=0;self.events.clear();mutations=[]
                    if direct:self.req['fileGuard']={'mode':'direct'}
                    else:self.req.pop('fileGuard',None)
                    def change(i,name,comment):
                        mutations.append((i,name,comment));self.main.pous[i][0]=name
                        if fault in ('name','comment'):raise RuntimeError('native setter '+fault)
                        if fault=='after-read':self.program.embedded_object_types=[]
                    def reopen(state):
                        value=self.save_reopen(state)
                        self.main.pous[2][1]=None
                        return value
                    self.main.pous.replace=change
                    self.e['lifecycle_save_reopen']=reopen
                    r=self.replace()
                    self.assertEqual(r['status'],'unknown',r)
                    self.assertFalse(r['data']['automaticRollback'])
                    self.assertTrue(r['data']['primaryException'])
                    self.assertEqual(mutations,[(2,'PRG_S8Probe','None')])
                    self.assertEqual(self.saves,int(fault=='reopen'))
                    self.assertTrue(Path(self.req['checkpointPath']).is_file())

    def test_append_preserves_multiple_calls_comments_and_other_tasks(self):
        prefix=[['PLC_PRG',''],['Other','保留中文注释'],['Third','None']]
        self.main.pous[:]=[tuple(row) for row in prefix]
        self.make_task('Secondary','33333333-3333-4333-8333-333333333333',[['Other','unchanged']])
        self.refresh_version()
        result=self.append()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(result['data']['after']['tasks'][0]['rawCalls'],prefix+[['PRG_S8Probe','']])
        self.assertEqual((self.main.pous.add_calls,self.factory_calls,self.saves),(1,0,1))
        self.assertEqual(result['data']['appendedCall'],dict(order=3,programId='program',raw=['PRG_S8Probe','']))
        self.assertEqual(result['data']['afterAppend'],result['data']['after'])

    def test_append_rejects_repeated_target_even_if_qualified(self):
        for existing in ('prg_s8probe','Application.PRG_S8Probe'):
            with self.subTest(existing=existing):
                self.main.pous[:]=[['PLC_PRG',''],[existing,'old']]
                self.refresh_version()
                self.assertEqual(self.append()['error']['code'],'TASK_CALL_EXISTS')
        self.assertEqual((self.main.pous.add_calls,self.saves),(0,0))
        self.assertFalse(Path(self.req['checkpointPath']).exists())

    def test_append_rejects_stale_version_and_wrong_program_without_dispatch_or_save(self):
        for overrides,code in [(dict(expectedTaskVersion='stale'),'TASK_VERSION_CHANGED'),
                               (dict(programId='wrapper'),'TASK_APPEND_IDENTITY_OR_COVERAGE')]:
            with self.subTest(overrides=overrides):
                self.assertEqual(self.append(**overrides)['error']['code'],code)
        self.assertEqual((self.main.pous.add_calls,self.saves),(0,0))
        self.assertEqual(self.events,[])

    def test_append_rejects_ambiguity_missing_st_and_incomplete_call_comment(self):
        duplicate=Node('prg_s8probe','duplicate',self.program.type,self.app,
                       has_textual_declaration=True,textual_declaration=S(text='PROGRAM prg_s8probe\nVAR\nEND_VAR'))
        self.refresh_version()
        self.assertEqual(self.append()['error']['code'],'TASK_APPEND_IDENTITY_OR_COVERAGE')
        self.app.nodes.remove(duplicate)
        previous=self.program.embedded_object_types
        self.program.embedded_object_types=[]
        self.assertEqual(self.append()['error']['code'],'TASK_APPEND_IDENTITY_OR_COVERAGE')
        self.program.embedded_object_types=previous
        self.main.pous[:]=[['PLC_PRG']]
        self.refresh_version()
        self.assertEqual(self.append()['error']['code'],'TASK_APPEND_IDENTITY_OR_COVERAGE')
        self.assertEqual((self.main.pous.add_calls,self.saves),(0,0))
        self.assertEqual(self.events,[])

    def test_append_rejects_raw_null_and_string_rows_before_dispatch(self):
        for row in ([None,''],['PLC_PRG',None],'AB'):
            with self.subTest(row=row):
                self.main.pous[:]=[row]
                # Match the legacy coerced inventory version to isolate the row guard.
                self.refresh_version()
                result=self.append()
                self.assertEqual((result['status'],result['error']['code']),('conflict','TASK_APPEND_IDENTITY_OR_COVERAGE'))
                self.assertEqual((self.main.pous.add_calls,self.saves),(0,0))
                self.assertEqual(self.e['file_hash'](str(self.project_file)),self.args['expectedDiskHash'])
                self.assertEqual(self.events,[])
                self.assertFalse(Path(self.req['checkpointPath']).exists())

    def test_append_rejects_raw_null_on_live_second_read(self):
        class NullOnSecondRead(Calls):
            reads=0

            def __getitem__(self,index):
                self.reads+=1
                return ['PLC_PRG',None] if self.reads==2 else super().__getitem__(index)

        self.main.pous=NullOnSecondRead([['PLC_PRG','None']])
        # Calculate the matching version before setting the read counter for this call.
        self.refresh_version()
        self.main.pous.reads=0
        result=self.append()
        self.assertEqual((result['status'],result['error']['code']),('conflict','TASK_APPEND_IDENTITY_OR_COVERAGE'))
        self.assertIn('注释须为文本',result['data']['primaryException']['message'])
        self.assertEqual((self.main.pous.reads,self.main.pous.add_calls,self.saves),(2,0,0))
        self.assertEqual(self.e['file_hash'](str(self.project_file)),self.args['expectedDiskHash'])

    def test_append_detects_literal_none_becoming_null_after_add_or_reopen(self):
        for stage in ('afterAdd','reopen'):
            with self.subTest(stage=stage):
                self.project_file.write_bytes(b'unsaved probe fixture')
                self.main.pous=Calls([['PLC_PRG','None']])
                self.events.clear()
                self.saves=0
                self.refresh_version()
                def add_without_comment(name,comment):
                    Calls.add(self.main.pous,name,comment)
                    self.main.pous[0][1]=None

                def reopen_without_comment(state):
                    reopened=self.save_reopen(state)
                    self.main.pous[0][1]=None
                    return reopened

                if stage=='afterAdd':
                    self.main.pous.add=add_without_comment
                self.e['lifecycle_save_reopen']=reopen_without_comment if stage=='reopen' else self.save_reopen
                result=self.append()
                self.assertEqual((result['status'],result['error']['code']),('unknown','TASK_APPEND_INCOMPLETE'))
                self.assertFalse(result['data']['automaticRollback'])
                self.assertFalse(result['data']['partial']['tasks'][0]['callsComplete'])
                self.assertEqual(result['data']['before']['tasks'][0]['rawCalls'],[['PLC_PRG','None']])
                self.assertEqual((self.main.pous.add_calls,self.saves),(1,int(stage=='reopen')))
                self.assertEqual('afterAppend' in result['data'],stage=='reopen')
                self.assertEqual(self.e['file_hash'](str(self.project_file))!=self.args['expectedDiskHash'],stage=='reopen')
                self.assertTrue(Path(self.req['checkpointPath']).is_file())

    def test_append_unknown_after_add_never_saves_or_rolls_back(self):
        self.main.pous.fail=True
        result=self.append()
        self.assertEqual(result['status'],'unknown',result)
        self.assertIn('may have taken effect',result['data']['primaryException']['message'])
        self.assertFalse(result['data']['automaticRollback'])
        self.assertEqual((self.main.pous.add_calls,self.saves),(1,0))
        self.assertEqual(self.main.pous,[['PLC_PRG',''],['PRG_S8Probe','']])
        self.assertTrue(Path(self.req['checkpointPath']).is_file())

    def test_append_wrong_reopen_is_unknown_without_recovery_save(self):
        self.wrong_reopen=True
        result=self.append()
        self.assertEqual(result['status'],'unknown',result)
        self.assertFalse(result['data']['automaticRollback'])
        self.assertEqual((self.main.pous.add_calls,self.saves),(1,1))
        self.assertIn('afterAppend',result['data'])

    def test_native_factory_period_and_single_bind_saved_once(self):
        result=self.write()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(self.factory_calls,1)
        self.assertEqual(self.config.nodes[-1].pous.add_calls,1)
        self.assertEqual(self.saves,1)
        self.assertEqual(result['data']['task']['rawFields']['interval'],'t#50ms')
        self.assertEqual(result['data']['programEmbeddedObjectTypes'],[ST_IMPLEMENTATION_TYPE])
        self.assertEqual(result['data']['task']['rawCalls'],[['PRG_S8Probe','']])
        self.assertEqual(result['data']['calls'],[dict(order=0,applicationId='app',programId='program',raw=['PRG_S8Probe',''])])
        self.assertEqual([event[0] for event in self.events if '-end' in event[0]],
                         ['task-create-create-end.json','task-create-period-end.json','task-create-bind-end.json'])
        self.assertEqual(Path(self.req['checkpointPath']).read_bytes(),b'unsaved probe fixture')

    def test_native_language_evidence_is_required_before_factory_bind_or_save(self):
        for case in ('non-ST','empty','missing','getter raises'):
            with self.subTest(case=case):
                self.program.__class__ = Node
                if case=='non-ST':
                    self.program.embedded_object_types=['00000000-0000-0000-0000-000000000001']
                elif case=='empty':
                    self.program.embedded_object_types=[]
                elif case=='missing':
                    del self.program.embedded_object_types
                else:
                    self.program.__class__ = UnreadableProgram
                result=self.write()
                self.assertEqual(result['status'],'conflict',result)
                self.assertEqual(result['error']['code'],'TASK_CREATE_IDENTITY_OR_COVERAGE')
                message=result['data']['primaryException']['message']
                self.assertIn({'non-ST':'原生 ST','empty':'原生 ST','missing':'embedded_object_types',
                               'getter raises':'Native embedded type read failed'}[case],message)
                self.assertEqual(self.factory_calls,0)
                self.assertEqual(sum(node.pous.add_calls for node in self.config.nodes),0)
                self.assertEqual(self.saves,0)
                self.assertEqual(self.events,[])
                self.assertFalse(Path(self.req['checkpointPath']).exists())
                self.assertEqual(self.e['file_hash'](str(self.project_file)),self.args['expectedDiskHash'])

    def test_language_marker_lost_after_binding_never_saves(self):
        publish=self.e['publish']
        def lose_after_binding(path,data):
            publish(path,data)
            if Path(path).name=='task-create-bind-end.json':
                self.program.embedded_object_types=[]
        self.e['publish']=lose_after_binding
        result=self.write()
        self.assertEqual(result['status'],'unknown',result)
        self.assertEqual(result['error']['code'],'TASK_CREATE_INCOMPLETE')
        self.assertIn('原生 ST',result['data']['primaryException']['message'])
        self.assertEqual((self.factory_calls,self.config.nodes[-1].pous.add_calls,self.saves),(1,1,0))
        self.assertFalse(result['data']['automaticRollback'])
        self.assertEqual(self.e['file_hash'](str(self.project_file)),self.args['expectedDiskHash'])
        self.assertTrue(Path(self.req['checkpointPath']).exists())

    def test_language_getter_error_after_reopen_preserves_original_error_and_no_recovery_save(self):
        def unreadable_after_reopen(state):
            project=self.save_reopen(state)
            self.program.__class__=UnreadableProgram
            return project
        self.e['lifecycle_save_reopen']=unreadable_after_reopen
        result=self.write()
        self.assertEqual(result['status'],'unknown',result)
        self.assertEqual(result['error']['code'],'TASK_CREATE_INCOMPLETE')
        self.assertIn('Native embedded type read failed',result['data']['primaryException']['message'])
        self.assertEqual((self.factory_calls,self.config.nodes[-1].pous.add_calls,self.saves),(1,1,1))
        self.assertFalse(result['data']['automaticRollback'])
        self.assertEqual(self.project_file.read_bytes(),b'saved native fixture')
        self.assertTrue(Path(self.req['checkpointPath']).exists())

    def test_native_bind_unknown_never_saves_deletes_or_repeats(self):
        self.fail=True
        result=self.write()
        self.assertEqual(result['status'],'unknown',result)
        self.assertEqual(result['error']['code'],'TASK_CREATE_INCOMPLETE')
        self.assertIn('may have taken effect',result['data']['primaryException']['message'])
        self.assertEqual(self.factory_calls,1)
        self.assertEqual(self.saves,0)
        self.assertEqual(self.config.nodes[-1].pous,[['PRG_S8Probe','']])
        self.assertEqual(result['data']['actions'][-1],dict(stage='bind',status='started'))
        self.assertEqual(self.project_file.read_bytes(),b'unsaved probe fixture')
        self.assertTrue(Path(self.req['checkpointPath']).exists())

    def test_name_hash_program_and_config_conflicts_are_before_checkpoint(self):
        for patch_,code in [
            (dict(name='mAinTasK'),'TASK_NAME_EXISTS'),(dict(expectedTaskVersion='old'),'TASK_VERSION_CHANGED'),
            (dict(expectedDiskHash='old'),'TASK_DISK_CHANGED'),(dict(taskConfigurationId='other'),'TASK_CREATE_IDENTITY_OR_COVERAGE'),
            (dict(programId='wrapper'),'TASK_CREATE_IDENTITY_OR_COVERAGE')]:
            with self.subTest(patch_=patch_):
                self.assertEqual(self.write(**patch_)['error']['code'],code)
        self.assertEqual(self.factory_calls,0)
        self.assertEqual(self.saves,0)
        self.assertFalse(Path(self.req['checkpointPath']).exists())

    def test_wrong_reopened_original_calls_never_causes_a_second_save(self):
        self.wrong_reopen=True
        result=self.write()
        self.assertEqual(result['status'],'unknown',result)
        self.assertEqual(self.factory_calls,1)
        self.assertEqual(self.saves,1)
        self.assertFalse(result['data']['automaticRollback'])


if __name__=='__main__':
    unittest.main()
