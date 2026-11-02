"""Production lifecycle fault tests with native API doubles; not real IDE evidence."""
import ast, hashlib, json, os, re, unittest
from pathlib import Path
from types import SimpleNamespace
import bridge_pou_test as fixtures

class Handle:
    def __init__(self, manager, number):
        self.manager,self.number,self.path=manager,number,'fixture.project'
        self.close_calls=self.save_calls=0
        self.closed=False
    def save(self):
        if self.closed:raise AssertionError('save on closed handle')
        self.save_calls+=1
        if self.manager.fail_save:raise RuntimeError('save may have written before throwing')
    def close(self):
        self.close_calls+=1
        if self.closed:raise AssertionError('double close')
        self.closed=True
        if self.number in self.manager.fail_close:raise RuntimeError('close failure '+str(self.number))
        self.manager.primary=None

class Native:
    def __init__(self, fail_open=0, fail_close=(), fail_save=False):
        self.fail_open,self.fail_close,self.fail_save=fail_open,set(fail_close),fail_save
        self.handles=[];self.opens=0;self.primary=None
    def open(self,path,primary):
        self.opens+=1
        if self.opens==self.fail_open:raise RuntimeError('reopen failure' if self.opens>1 else 'initial open failure')
        h=Handle(self,self.opens);self.handles.append(h);self.primary=h;return h

class Lifecycle(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path('bridge/worker.py').read_text(encoding='utf8'))
        self.env=dict(unicode=str,hashlib=hashlib,json=json,re=re,os=os,CONTRACT='1.0.0')
        exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.FunctionDef)],type_ignores=[]),'bridge/worker.py','exec'),self.env)
        self.req=dict(command='save',projectPath='fixture.project',args=dict(applicationId='app',expectedSnapshot='snapshot'))
    def run_save(self,native,verify_failure=False):
        self.env.update(projects=native,application=lambda *a:None)
        def snapshot(p):
            if verify_failure and p.number==2:raise RuntimeError('original verify failure')
            return 'snapshot'
        self.env['snapshot']=snapshot
        return self.env['dispatch'](self.req)
    def test_success_closes_each_owned_handle_once_and_reports_stages(self):
        n=Native();r=self.run_save(n)
        self.assertEqual(r['status'],'succeeded')
        self.assertEqual([p.close_calls for p in n.handles],[1,1])
        self.assertEqual(sum(p.save_calls for p in n.handles),1)
        self.assertEqual([e['stage'] for e in r['data']['lifecycle']['events']],['initial-open','save','close-before-reopen','reopen','reopen-verification','final-cleanup'])
    def test_reopen_failure_keeps_unknown_without_second_close_or_save(self):
        n=Native(fail_open=2);r=self.run_save(n)
        self.assertEqual(r['status'],'unknown');self.assertEqual(r['error']['message'],'reopen failure')
        self.assertEqual(n.handles[0].close_calls,1);self.assertEqual(n.handles[0].save_calls,1)
        self.assertEqual(r['data']['lifecycle']['events'][-1]['status'],'skipped')
        self.assertTrue(r['data']['lifecycle']['saveMayHaveOccurred'])
    def test_close_failure_detaches_uncertain_handle_and_stays_unknown(self):
        n=Native(fail_close=[1]);r=self.run_save(n)
        self.assertEqual(r['status'],'unknown');self.assertEqual(n.opens,1)
        self.assertEqual(n.handles[0].close_calls,1);self.assertTrue(r['data']['lifecycle']['closeUnconfirmed'])
    def test_primary_and_final_cleanup_exceptions_both_survive(self):
        n=Native(fail_close=[2]);r=self.run_save(n,verify_failure=True)
        self.assertEqual(r['status'],'unknown');self.assertEqual(r['error']['code'],'CLOSE_FAILED')
        self.assertIn('original verify failure',r['summary']);self.assertIn('close failure 2',r['summary'])
        self.assertEqual(r['data']['priorResult']['error']['message'],'original verify failure')
        self.assertEqual(r['data']['cleanupException']['message'],'close failure 2')
        self.assertEqual([p.close_calls for p in n.handles],[1,1])
    def test_final_cleanup_failure_overrides_success_as_unknown(self):
        n=Native(fail_close=[2]);r=self.run_save(n)
        self.assertEqual(r['status'],'unknown');self.assertEqual(r['data']['priorResult']['status'],'succeeded')
    def test_save_throw_may_have_written_never_becomes_ordinary_failure(self):
        n=Native(fail_save=True);r=self.run_save(n)
        self.assertEqual(r['status'],'unknown');self.assertEqual(n.opens,1);self.assertEqual(n.handles[0].save_calls,1)
    def test_initial_open_failure_has_no_write_and_no_owned_cleanup(self):
        n=Native(fail_open=1);r=self.run_save(n)
        self.assertEqual(r['status'],'failed');self.assertEqual(r['data']['lifecycle']['saveAttempts'],0)
        self.assertEqual(r['data']['lifecycle']['events'][-1]['status'],'skipped')
    def creation_fixture(self):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        calls={'save':0,'close':0,'open':0};original_save=f.project.save
        def save():calls['save']+=1;original_save()
        def close():calls['close']+=1
        def opened(*a,**kw):calls['open']+=1;raise RuntimeError('creation reopen failure')
        f.project.save=save;f.project.close=close;f.manager.open=opened
        return f,calls
    def test_creation_reopen_failure_never_rolls_back_persisted_object_or_recloses(self):
        for kind in ['function_block','gvl','structure']:
            with self.subTest(kind=kind):
                f,calls=self.creation_fixture();state=f.env['lifecycle_state'](f.project,f.req['projectPath'])
                f.env['scriptengine'].DutType=SimpleNamespace(Structure='Structure')
                args=dict(f.args)
                if kind!='function_block':
                    name='GVL_Test' if kind=='gvl' else 'ST_Test'
                    args.update(name=name,objectType=kind,declaration='VAR_GLOBAL\n X:INT;\nEND_VAR' if kind=='gvl' else 'TYPE ST_Test : STRUCT X:INT; END_STRUCT END_TYPE')
                    args.pop('pouType');args.pop('implementation')
                r,p=f.env['create_text_object'](f.project,f.req,args,kind,state)
                self.assertEqual(r['status'],'unknown');self.assertIsNone(p);self.assertIsNone(state['project'])
                self.assertEqual(calls,{'save':1,'close':1,'open':1});self.assertEqual(f.manager.control['removed'],[])
                self.assertIn('creation reopen failure',r['data']['primaryException']['message'])
    def test_change_reopen_failure_never_attempts_rollback_save_or_stale_close(self):
        f=fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid');f.setUp()
        f.manager.primary=None;original_open=f.manager.open;counts={'open':0,'save':0,'close':0}
        def opened(path,primary):
            counts['open']+=1
            if counts['open']==2:raise RuntimeError('change reopen failure')
            p=original_open(path,primary);p.path=path;real_save=p.save
            def save():counts['save']+=1;real_save()
            def close():counts['close']+=1
            p.save=save;p.close=close;return p
        f.manager.open=opened;f.env['shutil']=SimpleNamespace(copyfile=lambda *a:None)
        obj=f.app.children[0];before=f.env['read_object'](obj,['Application','PLC_PRG'],f.app.guid)
        req=dict(f.req,command='change',args=dict(applicationId=f.app.guid,objectId=obj.guid,expectedHash=before['contentHash'],declaration=before['declaration'],implementation='// changed'))
        r=f.env['dispatch'](req)
        self.assertEqual(r['status'],'unknown');self.assertEqual(r['error']['code'],'PARTIAL_WRITE')
        self.assertEqual(counts,{'open':2,'save':1,'close':1})

if __name__=='__main__':unittest.main(verbosity=2)
