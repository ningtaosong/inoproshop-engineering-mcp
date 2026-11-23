"""Synthetic helpers only. Compatible with the installed IronPython 2.7.7 host."""
import hashlib
import io
import json
import os
import shutil
import tempfile
import unittest
import probe_fixed_helpers as loader
from probe_startup_trace import Trace


class Events:
    def __init__(self): self.events=[]
    def record(self,stage,**details): self.events.append(stage)


class NoEngineering:
    def __getattr__(self,name): raise AssertionError('Engineering access forbidden: '+name)


class FixedHelpers(unittest.TestCase):
    def setUp(self):
        self.root=tempfile.mkdtemp();self.fixed=os.path.join(self.root,'fixed');self.scripts=os.path.join(self.root,'scripts')
        os.makedirs(os.path.join(self.fixed,'bridge'));os.makedirs(self.scripts)
        self.paths={'guardSha256':os.path.join(self.scripts,'library_placeholder_clear_guard.py'),
                    'bridgeSha256':os.path.join(self.fixed,'bridge','worker.py'),
                    'libraryHelperSha256':os.path.join(self.fixed,'bridge','library_reference.py'),
                    'recorderSha256':os.path.join(self.scripts,'probe_startup_trace.py'),
                    'loaderSha256':os.path.abspath(loader.__file__)}
        self.write('guardSha256',u'def require(value,message):\n    if not value: raise ValueError(message)\n')
        self.worker=u'BASE=10\ndef inner(v): return v+OFFSET\ndef outer(v): return inner(v)+BASE\n'
        self.marker=u'# Fixed helper code only; request text is never evaluated.'
        self.write('bridgeSha256',self.worker+self.marker+u'\nraise AssertionError("business tail must not execute")\n')
        self.write('libraryHelperSha256',u'OFFSET=3\ndef from_library(v): return outer(v)\n')
        self.write('recorderSha256',u'# fingerprint fixture only\n')
        self.trace=Events();self.native=dict(projects=NoEngineering(),system=NoEngineering(),librarymanager=NoEngineering())
    def tearDown(self): shutil.rmtree(self.root)
    def write(self,key,source):
        with io.open(self.paths[key],'w',encoding='utf-8') as stream: stream.write(source)
    def hashes(self):
        result={}
        for key,path in self.paths.items():
            with open(path,'rb') as stream: result[key]=hashlib.sha256(stream.read()).hexdigest()
        return result
    def load(self,expected=None):return loader.load_fixed_helpers(self.fixed,self.scripts,expected or self.hashes(),self.trace,self.native)
    def test_shared_namespace_and_cross_module_calls(self):
        guard,api,actual=self.load()
        self.assertEqual(api['from_library'](4),17)
        api['BASE']=20;self.assertEqual(api['from_library'](4),27)
        for name in ['inner','outer','from_library']:
            actual_globals=getattr(api[name],'func_globals',None) or getattr(api[name],'__globals__')
            self.assertIs(actual_globals,api)
        self.assertIs(api['projects'],self.native['projects'])
        self.assertEqual(api['__file__'],self.paths['bridgeSha256'])
        self.assertEqual(actual,self.hashes())
    def test_fixed_execution_returns_same_dictionary(self):
        api={'INITIAL':7};returned=loader.execute_fixed_source('def value(): return INITIAL','synthetic-fixed',api)
        self.assertIs(returned,api);self.assertEqual(api['value'](),7)
    def test_load_order_and_business_tail_excluded(self):
        self.load()
        self.assertEqual(self.trace.events,['project-helpers-start','guard-helper-loaded','worker-helpers-loaded','project-helpers-complete'])
    def test_changed_fingerprint_stops_before_any_helper_import(self):
        expected=self.hashes();self.write('libraryHelperSha256',u'raise AssertionError("must not execute")\n')
        with self.assertRaises(ValueError):self.load(expected)
        self.assertEqual(self.trace.events,['project-helpers-start'])
    def test_missing_expected_fingerprint_stops(self):
        expected=self.hashes();del expected['loaderSha256']
        with self.assertRaises(KeyError):self.load(expected)
        self.assertNotIn('guard-helper-loaded',self.trace.events)
    def test_guard_import_exception_propagates(self):
        self.write('guardSha256',u'raise ImportError("first guard import failure")\n')
        with self.assertRaises(ImportError) as caught:self.load()
        self.assertIn('first guard import failure',str(caught.exception))
        self.assertNotIn('worker-helpers-loaded',self.trace.events)
    def test_worker_parse_failure_prevents_next_module(self):
        self.write('bridgeSha256',u'def broken(:\n'+self.marker)
        with self.assertRaises(SyntaxError):self.load()
        self.assertNotIn('worker-helpers-loaded',self.trace.events)
    def test_worker_runtime_failure_prevents_next_module(self):
        self.write('bridgeSha256',u'raise RuntimeError("first worker load failure")\n'+self.marker)
        with self.assertRaises(RuntimeError) as caught:self.load()
        self.assertIn('first worker load failure',str(caught.exception))
        self.assertNotIn('worker-helpers-loaded',self.trace.events)
    def test_library_runtime_failure_not_success(self):
        self.write('libraryHelperSha256',u'raise RuntimeError("first library load failure")\n')
        with self.assertRaises(RuntimeError):self.load()
        self.assertIn('worker-helpers-loaded',self.trace.events);self.assertNotIn('project-helpers-complete',self.trace.events)
    def test_boundary_ambiguity_refused(self):
        self.write('bridgeSha256',self.marker+u'\n'+self.marker)
        with self.assertRaises(ValueError):self.load()
        self.assertNotIn('worker-helpers-loaded',self.trace.events)
    def test_logger_failure_keeps_first_loader_error(self):
        self.write('libraryHelperSha256',u'raise RuntimeError("original library exception")\n')
        lines=[]
        def unavailable(path,value):raise IOError('logger unavailable')
        recorder=Trace(self.root,'offline',{},writer=unavailable,fallback=lines.append)
        try:self.load()
        except RuntimeError as error:recorder.fail('helper-loading',error)
        self.assertEqual(recorder.primary['message'],'original library exception')
        self.assertIn('logger unavailable',lines[0]);self.assertIn('original library exception',lines[0])


def run_cases_json():
    result=unittest.TestResult();unittest.defaultTestLoader.loadTestsFromTestCase(FixedHelpers).run(result)
    return json.dumps(dict(testsRun=result.testsRun,failures=[str(x) for x in result.failures],
                           errors=[str(x) for x in result.errors],passed=result.wasSuccessful(),syntheticOnly=True),ensure_ascii=True)

if __name__=='__main__':
    result=run_cases_json();print(result)
    if not json.loads(result)['passed']:raise SystemExit(1)
