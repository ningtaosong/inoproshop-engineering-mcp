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


class Calls(list):
    def __init__(self, rows=(), fail=False):
        super().__init__(rows)
        self.fail = fail

    def add(self, name, comment):
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
        self.e = dict(unicode=str,long=int,hashlib=hashlib,json=json,os=os,re=re,shutil=shutil,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x, ast.FunctionDef)],type_ignores=[]),
                     'bridge/worker.py','exec'), self.e)
        root = self.project = Node(str(self.project_file),'root','project',path=str(self.project_file))
        device = Node('Device','device','device-type',root,is_device=True,
                      get_device_identification=lambda:S(type=4102,id='10f4 0002',version='3.5.11.11'))
        logic = Node('Plc Logic','logic','logic-type',device)
        self.app = Node('Application','app','app-type',logic,is_application=True)
        self.config = Node('Task Configuration','config','task-config-type',self.app,is_task_configuration=True)
        self.main = self.make_task('MainTask','main',[['PLC_PRG','']])
        self.program = Node('PRG_S8Probe','program','6f9dac99-8de1-4efc-8465-68ac443b7d08',self.app,
                            has_textual_declaration=True,has_textual_implementation=True,language='ST',pou_type='program')
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
        self.e.update(pou_fields=lambda p:dict(pouType='program',pouTypeSource='native-pou-type-id-and-declaration-header'),
                      snapshot=lambda p:'source-hash', publish=lambda p,d:self.events.append((Path(p).name,json.loads(json.dumps(d)))),
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

    def test_native_factory_period_and_single_bind_saved_once(self):
        result=self.write()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(self.factory_calls,1)
        self.assertEqual(self.saves,1)
        self.assertEqual(result['data']['task']['rawCalls'],[['PRG_S8Probe','']])
        self.assertEqual(result['data']['calls'],[dict(order=0,applicationId='app',programId='program',raw=['PRG_S8Probe',''])])
        self.assertEqual([event[0] for event in self.events if '-end' in event[0]],
                         ['task-create-create-end.json','task-create-period-end.json','task-create-bind-end.json'])
        self.assertEqual(Path(self.req['checkpointPath']).read_bytes(),b'unsaved probe fixture')

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
