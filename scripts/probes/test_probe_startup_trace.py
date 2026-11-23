import ast
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch
from probe_startup_trace import Trace, durable

SCRIPTS=Path(__file__).parent

class StartupTrace(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.trace=Trace(str(self.root),'unit',{'operationId':'op','launchId':'launch'})
    def test_chinese_publish_and_readback(self):
        self.trace.publish_result({'status':'succeeded','message':'中文取证'})
        result=json.loads((self.root/'unit-result.json').read_text())
        self.assertEqual(result['message'],'中文取证')
        self.assertEqual(result['traceBinding']['launchId'],'launch')
    def test_exclusive_evidence(self):
        durable(str(self.root/'first.json'),{'first':True})
        before=(self.root/'first.json').read_bytes()
        with self.assertRaises(OSError): durable(str(self.root/'first.json'),{'first':False})
        self.assertEqual(before,(self.root/'first.json').read_bytes())
    def test_result_publication_failure(self):
        def writer(p,v):
            if p.endswith('result.json'):raise OSError('result publication failed')
            durable(p,v)
        t=Trace(str(self.root),'unit',{},writer=writer)
        try:t.publish_result({'message':'中文'})
        except OSError as error:t.fail('result-publication',error)
        self.assertIn('result publication failed',t.primary['message'])
        self.assertFalse((self.root/'unit-result.json').exists())
    def test_recorder_keeps_original_exception(self):
        lines=[]
        def fail(p,v):raise OSError('logger failed')
        t=Trace(str(self.root),'unit',{},writer=fail,fallback=lines.append)
        try:raise RuntimeError('original import failed')
        except RuntimeError as error:t.fail('imports',error)
        self.assertEqual(t.primary['message'],'original import failed')
        self.assertIn('logger failed',lines[0]);self.assertIn('original import failed',lines[0])
    def test_primary_thread_exception_preserved(self):
        class System:
            def execute_on_primary_thread(self,fn):fn()
        def body():raise RuntimeError('native inner failure')
        with self.assertRaisesRegex(RuntimeError,'native inner failure'):self.trace.primary_call(System(),body)
        self.assertEqual(self.trace.primary['message'],'native inner failure')
    def test_main_thread_roundtrip(self):
        called=[]
        class System:
            def execute_on_primary_thread(self,fn):fn()
        self.trace.primary_call(System(),lambda:called.append(1))
        self.assertEqual(called,[1]);self.assertEqual(self.trace.count,4)
    def test_exit_request_is_not_exit_receipt(self):
        class System:
            def exit(self):pass
        self.trace.request_exit(System())
        events=[json.loads(p.read_text())['stage'] for p in sorted(self.root.glob('*.json'))]
        self.assertEqual(events,['exit-requested','exit-call-returned'])
    def test_earliest_entry_failure_goes_to_stderr(self):
        error=io.StringIO()
        with patch.dict(os.environ,{'INOPRO_TRACE_ROOT':str(self.root/'absent')}),contextlib.redirect_stderr(error):
            with self.assertRaises(FileNotFoundError):runpy.run_path(str(SCRIPTS/'native-startup-smoke.py'))
        self.assertIn('EARLIEST_ENTRY_FAILURE',error.getvalue())
    def test_native_import_failure_keeps_entry_and_exception(self):
        error=io.StringIO()
        with patch.dict(os.environ,{'INOPRO_TRACE_ROOT':str(self.root),'INOPRO_TRACE_MODE':'startup'}),contextlib.redirect_stderr(error):
            with self.assertRaises(ModuleNotFoundError):runpy.run_path(str(SCRIPTS/'native-startup-smoke.py'))
        self.assertTrue((self.root/'startup-bootstrap-entered.txt').exists())
        self.assertTrue((self.root/'startup-entry.json').exists())
        failures=[json.loads(p.read_text()) for p in self.root.glob('startup-trace-*.json') if json.loads(p.read_text())['stage']=='failure']
        self.assertEqual(len(failures),1);self.assertIn('System',failures[0]['primaryException']['message'])
    def test_project_helper_import_failure_before_primary_callback(self):
        source=(SCRIPTS/'library-placeholder-clear-native.py').read_text(encoding='utf-8')
        tree=ast.parse(source);fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='run')
        class Importer:
            def load_source(self,*a):raise ImportError('project guard import failure')
        scope={'_trace':self.trace,'imp':Importer(),'os':os}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'actual-probe-run','exec'),scope)
        try:scope['run'](str(self.root),'unused','prepare',str(SCRIPTS))
        except ImportError as error:self.trace.fail('outer-startup-envelope',error)
        self.assertEqual(self.trace.primary['message'],'project guard import failure')
        stages=[json.loads(p.read_text())['stage'] for p in self.root.glob('unit-trace-*.json')]
        self.assertIn('project-helpers-start',stages);self.assertNotIn('primary-thread-requested',stages)
    def test_smoke_has_no_engineering_imports_or_calls(self):
        tree=ast.parse((SCRIPTS/'native-startup-smoke.py').read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if isinstance(node,ast.ImportFrom) and node.module=='scriptengine':self.assertEqual([a.name for a in node.names],['system'])
            if isinstance(node,ast.Attribute):self.assertNotIn(node.attr,{'projects','save','compile','librarymanager','set_redirection'})

if __name__=='__main__':unittest.main(verbosity=2)
