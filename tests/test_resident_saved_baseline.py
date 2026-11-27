# -*- coding: utf-8 -*-
"""Production native adapter/session with public-object substitutes, never an IDE."""
import copy,unittest
import test_resident_core as f
c=f.c

class SavedCases(unittest.TestCase):
    def setUp(self):
        self.fixture=f.PublicAdapterCases('test_public_open_once_and_owned_replace');self.fixture.setUp();self.adapter=self.fixture.adapter
        self.disk='a'*64;self.file_id='1:2';self.rows={};self.fail=None;self.seq=0
        self.session=c.ResidentSession(self.adapter,lambda:self.disk,self.publish)
        self.last=self.call('inspect');self.assertEqual(self.last['status'],'succeeded')
        self.adapter.project.dirty=False
    def publish(self,name,value):
        if name==self.fail:raise IOError('first publication fault '+name)
        self.rows[name]=copy.deepcopy(value)
    def request(self,command,args=None):
        self.seq+=1
        req=dict(command=command,args=dict(applicationId=f.APP,**(args or {})),operationId='op-'+str(self.seq),requestId='req-'+str(self.seq),directory='offline',projectPath='test.project',launchId='launch-1',sequence=self.seq,diskHash=self.disk,fileIdentity=self.file_id)
        if self.session.accepted_baseline:req['acceptedBaseline']=self.session.accepted_baseline
        return req
    def call(self,command,args=None):
        self.rows={};return self.session.handle(self.request(command,args))
    def saved_request(self,**args):
        a=dict(userConfirmedSaved=True,expectedResidentVersion=self.session.last_version);a.update(args)
        req=self.request('accept_saved',a)
        req['savedBaseline']=dict(priorFileIdentity=self.session.previous_file_identity,priorDiskHash=self.session.previous_disk,priorResidentVersion=self.session.last_version,priorBaselineId=self.session.accepted_baseline,priorProjectHandle=self.session.previous_handle,candidateDisk=dict(fileIdentity=self.file_id,diskHash=self.disk))
        return req
    def test_public_adapter_save_accept_and_next_explicit_edit(self):
        old=self.call('read',dict(objectId=f.OBJ))['data']
        changed=self.call('change',dict(objectId=f.OBJ,declaration=old['declaration'],expectedHash=old['contentHash'],expectedResidentVersion=old['residentVersion'],implementation='Delay := T#7s; // 中文'))
        self.assertEqual(changed['status'],'succeeded');self.adapter.project.dirty=True
        refused=self.session.handle(self.saved_request());self.assertEqual(refused['status'],'conflict');self.assertFalse(refused['data']['firstError']['dispatched'])
        # Simulated user save, not any adapter save call.
        self.adapter.project.dirty=False;self.disk='b'*64;self.file_id='1:3'
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'succeeded',r)
        self.assertFalse(r['data']['savedBaselineAcceptance']['nativeSaveProven']);self.assertFalse(r['data']['saved'])
        read=self.call('read',dict(objectId=f.OBJ))['data'];self.assertEqual(read['implementation'],'Delay := T#7s; // 中文')
        after=self.call('change',dict(objectId=f.OBJ,declaration=read['declaration'],expectedHash=read['contentHash'],expectedResidentVersion=read['residentVersion'],implementation='Delay := T#8s; // 中文'))
        self.assertEqual(after['status'],'succeeded',after);self.assertEqual(self.fixture.projects.opens,1);self.assertEqual(self.adapter.attempts['replace'],2)
        self.assertEqual(self.call('read',dict(objectId=f.OBJ))['data']['implementation'],'Delay := T#8s; // 中文')
    def test_same_bytes_acceptance_changes_generation(self):
        old=self.last['data']['residentVersion'];r=self.session.handle(self.saved_request())
        self.assertEqual(r['status'],'succeeded');self.assertNotEqual(r['data']['residentVersion'],old)
        reused=self.saved_request(expectedResidentVersion=old);self.assertEqual(self.session.handle(reused)['status'],'conflict')
    def test_old_envelope_generation_rejected(self):
        old=self.request('read',dict(objectId=f.OBJ));self.assertEqual(self.session.handle(self.saved_request())['status'],'succeeded')
        self.assertEqual(self.session.handle(old)['status'],'conflict');self.assertEqual(self.adapter.attempts['replace'],0)
    def test_missing_confirmation_rejected(self):
        self.assertEqual(self.session.handle(self.saved_request(userConfirmedSaved=False))['status'],'conflict')
    def test_prior_bindings_rejected(self):
        for key,value in [('priorDiskHash','bad'),('priorFileIdentity','bad'),('priorResidentVersion','bad'),('priorBaselineId','bad'),('priorProjectHandle',9),('priorProjectHandle',False)]:
            req=self.saved_request();req['savedBaseline'][key]=value
            self.assertEqual(self.session.handle(req)['status'],'conflict',key)
        self.assertEqual(self.adapter.attempts['replace'],0)
    def test_missing_dirty_unknown(self):
        del self.adapter.project.dirty
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'unknown');self.assertIn('dirty',r['data']['firstError']['message'])
    def test_nonboolean_dirty_unknown(self):
        self.adapter.project.dirty=0
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'unknown')
    def mutate_second(self,fn):
        original=self.adapter.saved_snapshot;count=[0]
        def read():
            count[0]+=1
            if count[0]==2:fn()
            return original()
        self.adapter.saved_snapshot=read
    def test_background_library_variation_preserves_original_evidence(self):
        class Library(object):handle=9;path='background.library';primary=False;library=True
        self.mutate_second(lambda:self.fixture.projects.all.append(Library()))
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'succeeded',r)
        self.assertNotEqual(self.rows['saved-read-first.json'],self.rows['saved-read-second.json'])
        self.assertEqual(self.adapter.attempts['replace'],0)
    def test_second_project_rejected(self):
        class Other(object):handle=9;path='other.project';primary=False;library=False
        self.mutate_second(lambda:self.fixture.projects.all.append(Other()))
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'conflict');self.assertIsNotNone(self.session.poison)
    def test_memory_change_between_reads_freezes(self):
        self.mutate_second(lambda:setattr(self.fixture.item.textual_implementation,'text','unexpected'))
        r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'conflict');self.assertIsNotNone(self.session.poison)
    def test_dirty_change_between_reads_freezes(self):
        self.mutate_second(lambda:setattr(self.adapter.project,'dirty',True))
        self.assertEqual(self.session.handle(self.saved_request())['status'],'conflict');self.assertIsNotNone(self.session.poison)
    def test_disk_change_during_acceptance_freezes(self):
        self.mutate_second(lambda:setattr(self,'disk','c'*64))
        self.assertEqual(self.session.handle(self.saved_request())['status'],'conflict');self.assertIsNotNone(self.session.poison)
    def test_path_change_rejected(self):
        self.adapter.project.path='another.project'
        self.assertEqual(self.session.handle(self.saved_request())['status'],'conflict')
    def test_handle_change_rejected(self):
        self.adapter.project.handle=5
        self.assertEqual(self.session.handle(self.saved_request())['status'],'conflict')
    def test_source_coverage_failure_unknown(self):
        self.fixture.item.textual_implementation.text=None
        self.assertEqual(self.session.handle(self.saved_request())['status'],'unknown')
    def test_receipt_publication_failure_preserves_first_error_and_freezes(self):
        self.fail='saved-acceptance.json';r=self.session.handle(self.saved_request())
        self.assertEqual(r['status'],'unknown');self.assertIn('first publication fault',r['data']['firstError']['message']);self.assertIsNone(self.session.accepted_baseline)
        self.assertRaises(c.Conflict,self.call,'inspect');self.assertEqual(self.adapter.attempts['replace'],0)
    def test_first_read_publication_failure_freezes(self):
        self.fail='saved-read-first.json';r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'unknown')
    def test_candidate_publication_failure_freezes(self):
        self.fail='saved-candidate.json';r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'unknown')
    def test_lease_gate_failure_freezes_without_commit(self):
        def gate():raise ValueError('original lease fault')
        self.session.admission=gate;r=self.session.handle(self.saved_request());self.assertEqual(r['status'],'unknown')
        self.assertNotIn('saved-acceptance.json',self.rows);self.assertIn('original lease fault',r['data']['firstError']['message'])
    def test_disk_changed_without_declaration_stops_and_cannot_accept_later(self):
        self.disk='b'*64;self.assertEqual(self.call('read',dict(objectId=f.OBJ))['status'],'conflict')
        self.assertRaises(c.Conflict,self.session.handle,self.saved_request())

if __name__=='__main__':unittest.main()
