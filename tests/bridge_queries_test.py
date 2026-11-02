"""Exercise the production native readers with API doubles; not real IDE evidence."""
import ast, hashlib, json, re, os, unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from bridge_pou_test import Node, Manager, Project

class Queries(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf-8'))
        self.env=dict(unicode=str,hashlib=hashlib,json=json,re=re,os=os,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'bridge/worker.py','exec'),self.env)
        self.manager=Manager();self.project=Project(self.manager);self.project.path='fixture.project';self.app=self.project.children[0]
        self.args=dict(projectId=str(__import__('uuid').uuid4()),applicationId=self.app.guid,targetKind='application')
    def test_search_reads_once_and_reports_unsupported_declaration_and_read_failure(self):
        other=Node(self.project,'Enum',declaration='TYPE Enum : (A,B); END_TYPE',nativeType='2db5746d-d284-4425-9f7f-2663a34b0ebc');self.app.children.append(other)
        broken=Node(self.project,'Broken',declaration='PROGRAM Broken',implementation='')
        class Failing:
            @property
            def text(self):raise RuntimeError('actual reader failure')
        broken.textual_declaration=Failing();self.app.children.append(broken)
        r=self.env['search_inventory'](self.project,self.args)
        self.assertEqual(len(r['corpus']),1);self.assertEqual(len(r['scope']['readFailures']),1);self.assertEqual(len(r['scope']['skippedObjects']),1);self.assertFalse(r['scope']['coverageComplete'])
    def test_task_reader_keeps_raw_values_and_does_not_default_failed_field(self):
        class Task(Node):
            is_task=True;kind_of_task='Event';interval=0;interval_unit='ms';event_pou_guid='event-guid';event='Trigger';external_event='';core_binding=-1;parent_synchron_task=''
            watchdog=SimpleNamespace(enabled=False,time=0,time_unit='ms',sensitivity=1)
            pous=[('PLC_PRG',''),('ExternalName','raw-extra')]
            @property
            def priority(self):raise RuntimeError('priority inaccessible')
        task=Task(self.project,'Task');self.app.children.append(task)
        r=self.env['task_inventory'](self.project,self.args);t=r['tasks'][0]
        self.assertNotIn('priority',t['rawFields']);self.assertEqual(t['rawFields']['interval'],'0');self.assertEqual(t['rawCalls'][1],['ExternalName','raw-extra']);self.assertFalse(r['coverageComplete']);self.assertEqual(t['unavailableFields'][0]['field'],'priority')
        self.assertEqual(r['programs'][0]['objectId'],self.app.children[0].guid)
    def test_binary_file_hash_never_uses_text_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'binary.project';payload=bytes(range(256))*7;p.write_bytes(payload)
            # In production IronPython binary str also satisfies unicode. This double makes any use of sha fail.
            self.env['sha']=lambda value:(_ for _ in ()).throw(AssertionError('binary bytes sent to text hash'))
            self.assertEqual(self.env['file_hash'](str(p)),hashlib.sha256(payload).hexdigest())

if __name__=='__main__':unittest.main(verbosity=2)
