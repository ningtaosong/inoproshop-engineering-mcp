"""Production worker entry + close helper, synthetic native API only (no IDE)."""
import ast
import datetime
import hashlib
import io
import json
import os
import sys
import tempfile
import traceback
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HELPER = {}
exec(compile(Path('bridge/native_exit.py').read_text(encoding='utf8'), 'native_exit.py', 'exec'), HELPER)
NativeExit = HELPER['NativeExit']
TREE = ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
START = next(n.lineno for n in TREE.body if isinstance(n, ast.Assign) and any(
    isinstance(t, ast.Name) and t.id == 'request_path' for t in n.targets))
ENTRY = compile(ast.Module(body=[n for n in TREE.body if n.lineno >= START], type_ignores=[]), 'worker-entry', 'exec')


class NativeClose(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.calls = []; self.writes = 0; self.closes = 0; self.saves = 0
        self.callbacks = []; self.fail_file = None; self.fail_stage = None
        self.system = SimpleNamespace(ui_present=True, execute_on_primary_thread=self.schedule)
        self.projects = SimpleNamespace(primary=None, all=[])
        self.command = SimpleNamespace(guid=HELPER['NORMAL_EXIT_GUID'], execute=self.close)
        self.system.commands = {self.command.guid: self.command}
        self.hashes = dict(workerHash='a'*64, helperHash='b'*64)
        self.req = dict(operationId='op', requestId='request', requestFingerprint='c'*64, launchId='launch',
                        resultPath=str(self.root/'result.json'), projectPath=str(self.root/'not-opened.project'),
                        command='test', args={}, normalClosePolicy=dict(version=1,commandGuid=self.command.guid,**self.hashes))
        self.request_path = self.root/'request.json'
        self.request_path.write_text(json.dumps(self.req), encoding='utf8')
        self.stderr = io.StringIO()
        self.addCleanup(patch.stopall)
        patch.object(sys,'stderr',self.stderr).start()
        self.guard = NativeExit(self.req, str(self.request_path), self.system, self.projects, self.publish,
                                dict(pid=42,startId='123'), str, lambda: [], self.hashes)
        self.env = dict(os=os,io=io,json=json,sys=sys,traceback=traceback,
            prepare_native_exit=lambda *args:self.guard,phase_event=lambda *args:None,system=self.system,
            publish=self.publish,dispatch=self.dispatch,text=str,
            failure=lambda status,code,message,data:{'status':status,'error':{'code':code,'message':message},'data':data})

    def publish(self, filename, value):
        if self.fail_file and self.fail_file in filename: raise IOError('first publication failure '+self.fail_file)
        with open(filename,'x',encoding='utf8') as stream: json.dump(value,stream,ensure_ascii=False)

    def schedule(self, callback, async_requested=False):
        self.calls.append(('schedule',async_requested))
        if async_requested:
            if self.fail_stage=='queue': raise RuntimeError('first queue failure')
            if self.fail_stage=='reentrant': callback()
            else: self.callbacks.append(callback)
        else: callback()

    def close(self, args):
        self.closes+=1
        self.assertEqual(args,[])
        if self.fail_stage=='command': raise RuntimeError('first command failure')

    def dispatch(self, req):
        self.writes+=1
        if self.fail_stage=='business': raise RuntimeError('original business exception')
        if self.fail_stage=='left-open': self.projects.all=[object()]
        if self.fail_stage=='business-unknown':
            return dict(status='unknown',error=dict(code='ORIGINAL_FAULT',message='partial write'),data={'cleanupError':'close failed'})
        return dict(status='succeeded',data={})

    def entry(self):
        with patch.dict(os.environ,{'INOPRO_BRIDGE_REQUEST':str(self.request_path)}):exec(ENTRY,self.env)

    def callbacks_run(self):
        for callback in self.callbacks: callback()

    def read(self,name):return json.loads((self.root/name).read_text(encoding='utf8'))

    def test_entry_production_order_and_one_public_close(self):
        self.entry();self.assertEqual(self.writes,1);self.assertEqual(self.closes,0)
        self.assertEqual(self.calls,[('schedule',False),('schedule',True)])
        self.callbacks_run();self.assertEqual(self.closes,1);self.assertEqual(self.saves,0)
        self.assertEqual(self.read('normal-close-returned.json')['dispatchCount'],1)
        self.assertEqual(self.read('result.json')['status'],'succeeded')
        self.assertEqual(self.read('normal-close-preflight.json')['binding']['startId'],'123')

    def test_callback_can_be_reentrant_without_claiming_onload_unwound(self):
        self.fail_stage='reentrant';self.entry();self.assertEqual(self.closes,1)
        self.assertTrue((self.root/'normal-close-queued.json').exists())

    def test_callback_duplicate_does_not_close_twice(self):
        self.entry();self.callbacks_run();self.callbacks_run()
        self.assertEqual(self.closes,1);self.assertTrue((self.root/'normal-close-failed.json').exists())

    def test_business_first_exception_preserved_and_no_force_exit(self):
        self.fail_stage='business';self.entry();self.callbacks_run()
        self.assertEqual(self.closes,0);self.assertEqual(self.read('result.json')['error']['message'],'original business exception')
        self.assertIn('original business exception',self.read('normal-close-failed.json')['firstError']['message'])

    def test_business_unknown_and_cleanup_failure_coexist(self):
        self.fail_stage='business-unknown';self.entry();self.fail_stage='command';self.callbacks_run()
        self.assertEqual(self.read('result.json')['error']['code'],'ORIGINAL_FAULT')
        self.assertEqual(self.read('result.json')['data']['cleanupError'],'close failed')
        self.assertEqual(self.read('normal-close-failed.json')['firstError']['message'],'first command failure')

    def test_recorder_failure_preserves_first_error_in_stderr(self):
        self.entry();self.fail_file='normal-close-failed';self.fail_stage='command';self.callbacks_run()
        self.assertIn('first command failure',self.stderr.getvalue());self.assertIn('first publication failure',self.stderr.getvalue())
        self.assertEqual(self.guard.first_error['message'],'first command failure')
        self.assertFalse((self.root/'normal-close-returned.json').exists())

    def test_stderr_failure_does_not_mask_original(self):
        class Broken:
            def write(self,*args):raise IOError('stderr denied')
        self.entry();self.fail_stage='command'
        with patch.object(sys,'stderr',Broken()):self.callbacks_run()
        self.assertEqual(self.read('normal-close-failed.json')['firstError']['message'],'first command failure')

    def test_existing_result_never_replays_or_closes_another_launch(self):
        self.entry();self.callbacks_run();before=(self.root/'result.json').read_bytes();self.entry()
        self.assertEqual(self.writes,1);self.assertEqual(self.closes,1);self.assertEqual((self.root/'result.json').read_bytes(),before)


def preflight_case(kind):
    def test(self):
        if kind=='ui': self.system.ui_present=False
        elif kind=='primary':self.projects.primary=object()
        elif kind=='all':self.projects.all=[object()]
        elif kind=='command':self.system.commands={}
        elif kind=='guid':self.command.guid='other'
        elif kind=='method':self.command.execute=None
        elif kind=='policy':self.req['normalClosePolicy']['version']=2
        elif kind=='hash':self.hashes['helperHash']='d'*64
        elif kind=='publication':self.fail_file='normal-close-preflight'
        self.entry();self.callbacks_run()
        self.assertEqual(self.writes,0);self.assertEqual(self.closes,0);self.assertEqual(self.saves,0)
        self.assertFalse((self.root/'dispatched.json').exists());self.assertEqual(self.read('result.json')['status'],'unknown')
    return test
for _kind in ['ui','primary','all','command','guid','method','policy','hash','publication']:
    setattr(NativeClose,'test_predispatch_'+_kind,preflight_case(_kind))

def post_case(kind):
    def test(self):
        if kind=='queue':self.fail_stage='queue'
        if kind=='result-publication':self.fail_file='result.json'
        if kind=='left-open':self.fail_stage='left-open'
        self.entry()
        if kind=='callback-open':self.projects.all=[object()]
        if kind=='callback-ui':self.system.ui_present=False
        if kind=='callback-guid':self.command.guid='changed'
        if kind=='callback-missing':self.system.commands={}
        if kind=='command':self.fail_stage='command'
        if kind.startswith('publish-'):self.fail_file='normal-close-'+kind[len('publish-'):]
        self.callbacks_run()
        self.assertEqual(self.writes,1);self.assertEqual(self.saves,0)
        self.assertEqual(self.closes,1 if kind in ['command','publish-returned'] else 0)
        self.assertTrue((self.root/'normal-close-failed.json').exists())
        self.assertFalse((self.root/'normal-close-returned.json').exists())
    return test
for _kind in ['queue','result-publication','left-open','callback-open','callback-ui','callback-guid','callback-missing',
              'command','publish-callback','publish-dispatch','publish-returned']:
    setattr(NativeClose,'test_postdispatch_'+_kind,post_case(_kind))

if __name__=='__main__':unittest.main()
