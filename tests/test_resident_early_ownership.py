# -*- coding: utf-8 -*-
"""Actual host/core with offline public-project doubles. No CLR or IDE launch."""
import copy,json,os,sys,tempfile,types,unittest
from unittest import mock
from pathlib import Path
import test_resident_core as fixtures
c=fixtures.c
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','bridge'))
import resident_host as h


class EarlyOwnershipTests(unittest.TestCase):
    def setUp(self):
        source=fixtures.PublicAdapterCases();source.setUp()
        self.projects=source.projects;self.item=source.item
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=self.tmp.name;self.rows={};self.publish_fail=None
        self.req=dict(operationId='op-1',requestId='request-1',launchId='launch-1',sequence=1,
                      projectPath='test.project',command='inspect',args={},directory=self.root)
        self.intent=dict(launchId='launch-1',projectPath='test.project',directory=self.root,
                         scriptHash='entry-hash',coreHash='core-hash')
        self.rec=h.OwnershipRecorder(vars(c),self.intent,dict(pid=123,startId='456'),self.publish)
        self.rec.begin(self.req)
        self.adapter=c.NativeProjectAdapter(self.projects,'test.project',c.same_public_identity,lambda:1,
            observe_ownership=lambda proof:self.rec.observe(proof,self.adapter.handle,self.adapter.attempts))
        self.session=c.ResidentSession(self.adapter,lambda:'disk-hash',self.publish)
    def publish(self,name,value):
        if name==self.publish_fail:raise IOError('first publication fault')
        if name in self.rows:raise IOError('evidence overwrite')
        self.rows[name]=copy.deepcopy(value)
    def test_complete_snapshot_and_receipt_bind_native_identity(self):
        r=self.session.handle(self.req);self.assertEqual(r['status'],'succeeded')
        row=self.rows['ownership-0001.json']
        self.assertEqual(row['nativeValidation'],dict(passed=True,error=None))
        self.assertEqual(row['projectHandle'],0);self.assertEqual(row['requestHash'],c.digest(self.req))
        self.assertEqual(row['attempts'],dict(open=1,replace=0,read=1,build=0))
        self.assertEqual(row['raw']['returned'],self.rows['before.json']['state']['openedProjects']['0'])
        self.assertEqual(self.rec.records,[dict(name='ownership-0001.json',sha256=c.digest(row))])
    def test_observer_error_after_owned_has_receipt_but_no_before_or_permission(self):
        original=self.adapter._owned
        def error():original();raise ImportError('observer install failure')
        self.adapter._owned=error
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'unknown');self.assertNotIn('before.json',self.rows)
        self.assertTrue(self.rows['ownership-0001.json']['nativeValidation']['passed'])
        self.assertIn('observer install failure',r['data']['firstError']['message'])
        self.assertRaises(c.Conflict,self.session.handle,self.req)
        self.assertEqual(self.adapter.attempts['replace'],0);self.assertEqual(self.adapter.attempts['build'],0)
    def test_tree_read_failure_still_retains_early_receipt(self):
        self.item.get_children=lambda recursive:(_ for _ in ()).throw(ValueError('first tree error'))
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'unknown');self.assertNotIn('before.json',self.rows)
        self.assertIn('first tree error',r['data']['firstError']['message'])
        self.assertIn('ownership-0001.json',self.rows)
    def test_raw_ownership_failure_is_not_validation_success(self):
        opened=self.projects.open
        def open_project(*args,**kwargs):
            p=opened(*args,**kwargs);self.projects.primary=None;return p
        self.projects.open=open_project
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'conflict');self.assertNotIn('before.json',self.rows)
        row=self.rows['ownership-0001.json'];self.assertIsNone(row['raw']['primary'])
        self.assertFalse(row['nativeValidation']['passed']);self.assertIsNotNone(row['nativeValidation']['error'])
    def test_publication_failure_stops_before_tree_no_record_claim(self):
        self.publish_fail='ownership-0001.json';walks=[]
        self.item.get_children=lambda recursive:walks.append(1) or []
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'unknown');self.assertEqual(walks,[])
        self.assertEqual(self.rec.records,[]);self.assertNotIn('before.json',self.rows)
        self.assertIn('first publication fault',r['data']['firstError']['message'])
    def test_native_first_error_survives_recorder_failure(self):
        self.publish_fail='ownership-0001.json';opened=self.projects.open
        class Bad:
            @property
            def library(self):raise ValueError('first native ownership fault')
        def open_project(*args,**kwargs):
            p=opened(*args,**kwargs);self.projects.primary=Bad();return p
        self.projects.open=open_project
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'unknown')
        self.assertIn('first native ownership fault',r['data']['firstError']['message'])
        self.assertIn('first publication fault',r['data']['secondaryErrors'][0]['error']['message'])
        self.assertNotIn('before.json',self.rows)
    def test_requests_and_repeated_reads_have_distinct_receipts_without_overwrite(self):
        self.adapter.snapshot();self.adapter.snapshot()
        self.assertEqual(len(self.rec.records),2)
        first=copy.deepcopy(self.rows['ownership-0001.json'])
        self.adapter.last_ownership['returned']['path']='mutated-memory'
        self.assertEqual(self.rows['ownership-0001.json'],first)
        self.req['operationId']='op-2';self.req['requestId']='request-2';self.req['sequence']=2
        self.rows={};self.rec.end();self.rec.begin(self.req);self.adapter.snapshot()
        self.assertEqual(self.rows['ownership-0001.json']['operationId'],'op-2')
        self.assertEqual(self.projects.opens,1)
    def test_validation_first_error_survives_recorder_failure(self):
        self.publish_fail='ownership-0001.json';opened=self.projects.open
        def open_project(*args,**kwargs):
            p=opened(*args,**kwargs);self.projects.primary=None;return p
        self.projects.open=open_project
        r=self.session.handle(self.req)
        self.assertEqual(r['status'],'conflict')
        self.assertIn('Owned or primary project unavailable',r['data']['firstError']['message'])
        self.assertIn('first publication fault',r['data']['secondaryErrors'][0]['error']['message'])
        self.assertFalse(r['data']['recoverableRejection'])
        self.assertRaises(c.Conflict,self.session.handle,self.req)
    def test_no_request_event_read_does_not_touch_old_records_but_changed_binding_stops(self):
        self.adapter.snapshot();before=copy.deepcopy(self.rows);manifest=copy.deepcopy(self.rec.records)
        self.rec.end();self.adapter.snapshot()
        self.assertEqual(self.rows,before);self.assertEqual(self.rec.records,manifest)
        self.rec.begin(dict(self.req,launchId='wrong-launch'))
        self.assertRaises(ValueError,self.adapter.snapshot);self.assertEqual(self.rec.records,[])
    def test_real_host_constructor_wires_callback_and_binds_result(self):
        # Execute the production constructor/service path with import doubles.
        # Thread.Start intentionally does nothing: no native/background dispatch.
        class Thread:
            CurrentThread=types.SimpleNamespace(ManagedThreadId=1)
            def __init__(self,*args):pass
            def Start(self):pass
        process=types.SimpleNamespace(Id=123,StartTime=types.SimpleNamespace(ToUniversalTime=lambda:types.SimpleNamespace(Ticks=456)),Dispose=lambda:None)
        modules={'clr':types.SimpleNamespace(AddReference=lambda name:None),
                 'System.Diagnostics':types.SimpleNamespace(Process=types.SimpleNamespace(GetCurrentProcess=lambda:process),StackTrace=None),
                 'System.Threading':types.SimpleNamespace(Thread=Thread,ThreadStart=lambda f:f),
                 'System.Windows.Forms':types.SimpleNamespace(Application=types.SimpleNamespace(OpenForms=[])),
                 'scriptengine':types.SimpleNamespace(projects=self.projects,system=object())}
        with open(h.__file__,'rb') as stream:entry_hash=h.hashlib.sha256(stream.read()).hexdigest()
        intent=dict(self.intent,corePath='fixed-core',scriptHash=entry_hash)
        p=os.path.join(self.root,'intent.json')
        with open(p,'w',encoding='utf-8') as stream:json.dump(intent,stream)
        with mock.patch.dict(os.environ,{'INOPRO_RESIDENT_REQUEST':p}),mock.patch.dict(sys.modules,modules),mock.patch.object(h,'load_fixed',return_value=vars(c)),mock.patch.object(h,'unicode',str,create=True),mock.patch.object(c,'file_hash',return_value='disk-hash'):
            h.start();controller=h._controller
            controller.directory=self.root;controller.capture=lambda:None;controller.admission=lambda req:None
            result=controller.service(self.req)
        self.assertEqual(result['status'],'succeeded')
        with open(os.path.join(self.root,'ownership-0001.json'),encoding='utf-8') as stream:record=json.load(stream)
        self.assertTrue(record['nativeValidation']['passed'])
        self.assertEqual(result['data']['residentEvidence']['ownershipRecords'],[dict(name='ownership-0001.json',sha256=c.digest(record))])
        self.assertIsNone(controller.ownership.request)
        before={name:Path(self.root,name).read_bytes() for name in os.listdir(self.root)}
        controller.adapter.snapshot() # save-event read outside the completed request
        after={name:Path(self.root,name).read_bytes() for name in os.listdir(self.root)}
        self.assertEqual(before,after)
        self.assertEqual(len(result['data']['residentEvidence']['ownershipRecords']),1)
        second=os.path.join(self.root,'second');os.mkdir(second);controller.directory=second
        with mock.patch.object(controller.session,'handle',side_effect=RuntimeError('handler escape')):
            with self.assertRaisesRegex(RuntimeError,'handler escape'):controller.service(dict(self.req,requestId='second',directory=self.root))
        self.assertIsNone(controller.ownership.request)


if __name__=='__main__':unittest.main()
