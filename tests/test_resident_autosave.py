# -*- coding: utf-8 -*-
"""Actual production session/public adapter, synthetic public objects; no IDE."""
import copy,unittest
import test_resident_core as f
c=f.c

class SaveCases(unittest.TestCase):
    def setUp(self):
        self.fixture=f.PublicAdapterCases('test_public_open_once_and_owned_replace');self.fixture.setUp();self.adapter=self.fixture.adapter
        self.disk='a'*64;self.rows={};self.seq=0;self.saves=0;self.fault=None;self.fail_publish=None;self.gate=None
        self.session=c.ResidentSession(self.adapter,lambda:self.disk,self.publish,authorize_save=self.authorize)
        self.read=self.call('read',objectId=f.OBJ);self.assertEqual(self.read['status'],'succeeded')
        self.adapter.project.dirty=False;self.adapter.project.save=self.save
    def save(self):
        self.saves+=1
        if self.fault=='throw':raise ValueError('first public save error')
        if self.fault!='unchanged':self.disk=c.digest(self.adapter.snapshot())
        self.adapter.project.dirty=self.fault=='dirty'
        if self.fault=='source':self.fixture.item.textual_implementation.text='wrong'
    def publish(self,name,value):
        if name==self.fail_publish:raise IOError('publication '+name)
        self.rows[name]=copy.deepcopy(value)
    def authorize(self,ready):
        if self.gate:self.gate()
        return dict(scheme=ready['scheme'],requestHash=ready['requestHash'],readyHash=c.digest(ready),beforeDisk=ready['beforeDisk'])
    def call(self,command,**args):
        self.seq+=1;self.rows={}
        return self.session.handle(dict(command=command,args=dict(applicationId=f.APP,**args),operationId=str(self.seq),requestId=str(self.seq),directory='offline',savePolicy='resident-confirmed-change-save-v1',initialDisk=dict(diskHash=self.disk,fileIdentity='1:2')))
    def change(self,text='x := 7; // 中文'):
        r=self.read['data']
        return self.call('change',objectId=f.OBJ,declaration=r['declaration'],implementation=text,expectedHash=r['contentHash'],expectedResidentVersion=r['residentVersion'])
    def test_two_changes_keep_one_project_open(self):
        for text in ('x := 7; // 中文','x := 8; // 中文'):
            result=self.change(text);self.assertEqual(result['status'],'succeeded',result)
            self.assertTrue(result['data']['saved']);self.assertEqual(result['data']['saveCalls'],1)
            self.assertEqual(result['data']['saveReceipt']['afterDiskHash'],self.disk)
            self.read=self.call('read',objectId=f.OBJ);self.assertEqual(self.read['data']['implementation'],text)
        self.assertEqual(self.saves,2);self.assertEqual(self.fixture.projects.opens,1)
    def test_noop_and_reads_do_not_save(self):
        result=self.change(self.read['data']['implementation']);self.assertEqual(result['status'],'succeeded',result)
        self.assertTrue(result['data']['noOp']);self.assertEqual(self.saves,0);self.assertEqual(self.adapter.attempts['replace'],0)
        self.assertNotIn('dispatch.json',self.rows)
    def test_save_failure_preserves_first_and_no_recovery_save(self):
        self.fault='throw';self.fail_publish='first-error.json';r=self.change()
        self.assertEqual(r['status'],'unknown');self.assertIn('first public save error',r['data']['firstError']['message'])
        self.assertEqual(len(r['data']['secondaryErrors']),1);self.assertEqual(self.saves,1)
        self.assertEqual(r['data']['saveOutcome'],'unconfirmed');self.assertNotIn('saved',r['data'])
        self.assertRaises(c.Conflict,self.call,'read',objectId=f.OBJ)
    def test_unchanged_file_is_not_confirmed_save(self):
        self.fault='unchanged';self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,1)
    def test_dirty_after_return_is_not_success(self):
        self.fault='dirty';self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,1)
    def test_source_changed_by_save_is_not_success(self):
        self.fault='source';self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,1)
    def test_final_gate_disk_change_is_zero_save(self):
        self.gate=lambda:setattr(self,'disk','b'*64)
        r=self.change();self.assertEqual(r['status'],'unknown');self.assertEqual(self.saves,0);self.assertEqual(self.adapter.attempts['replace'],1)
    def test_final_gate_handle_loss_is_zero_save(self):
        self.gate=lambda:setattr(self.fixture.projects,'primary',None)
        self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,0)
    def test_before_save_publication_failures_stop(self):
        for file in ['checkpoint.json','predispatch.json','after.json','verification.json','save-ready.json','save-call.json']:
            self.setUp();self.fail_publish=file;r=self.change();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.saves,0)
            self.assertEqual(r['data']['firstError']['message'],'publication '+file)
    def test_after_save_publication_failures_do_not_resave(self):
        for file in ['save-returned.json','save-read-first.json','save-read-second.json','save-receipt.json']:
            self.setUp();self.fail_publish=file;r=self.change();self.assertEqual(r['status'],'unknown',r);self.assertEqual(self.saves,1)
            self.assertRaises(c.Conflict,self.call,'read',objectId=f.OBJ)
    def test_missing_or_nonboolean_dirty_is_not_clean(self):
        for value in [None,0,'false']:
            self.setUp()
            def save():self.saves+=1;self.disk='b'*64;self.adapter.project.dirty=value
            self.adapter.project.save=save
            self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,1)
    def test_snapshots_differ_or_file_changes_between_reads(self):
        for fault in ['field','disk']:
            self.setUp();original=self.adapter.saved_snapshot;count=[0]
            def observed():
                count[0]+=1;r=original()
                if count[0]==2:
                    if fault=='field':r['state']['nodes'][f.OBJ]['extra']='bad'
                    else:self.disk='c'*64
                return r
            self.adapter.saved_snapshot=observed
            self.assertEqual(self.change()['status'],'unknown');self.assertEqual(self.saves,1)
    def test_old_memory_version_is_zero_write_zero_save(self):
        self.fixture.item.textual_implementation.text='user edit'
        self.assertEqual(self.change()['status'],'conflict');self.assertEqual(self.saves,0);self.assertEqual(self.adapter.attempts['replace'],0)

if __name__=='__main__':unittest.main()
