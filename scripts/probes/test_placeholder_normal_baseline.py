# -*- coding: utf-8 -*-
"""Synthetic normal resolution, archived evidence read only; no OEM execution."""
import copy
import json
import os
from pathlib import Path
import types
import unittest
import library_placeholder_clear_guard as guard
from test_placeholder_stabilization import API, versions, run_fake, digest

ARCHIVE=Path(r'D:\InoPro-PlaceholderClear-20261123-132011')


def fixture():
    normal=json.loads((ARCHIVE/'prepare-created.json').read_text('utf-8-sig'))
    plan=json.loads((ARCHIVE/'prepare-plan.json').read_text('utf-8-sig'))
    old_path=plan['projectPath'];synthetic_path=r'Z:\synthetic-no-IDE-fixture\fixture.project'
    normal=json.loads(json.dumps(normal).replace(json.dumps(old_path)[1:-1],json.dumps(synthetic_path)[1:-1]))
    plan['projectPath']=synthetic_path
    plan.update(placeholderName='CAA Mathematics',normalSavedReopened=True,baselineSavedReopened=True,
                normalInstalled=copy.deepcopy(plan['defaultInstalled']),diskHash=guard.STABILIZATION_SEED)
    f=normal['library']['references'][-1]['rawFields']
    f.update(placeholder_name=plan['placeholderName'],name='#'+plan['placeholderName'],
             effective_resolution=plan['defaultResolution'],resolution_info='synthetic native provider evidence')
    normal['library']['references'][-1]['resolutionStatus']='effective-resolution-reported'
    versions(normal);plan['normalBaseline']=copy.deepcopy(normal)
    overridden=copy.deepcopy(normal);of=overridden['library']['references'][-1]['rawFields']
    of.update(explicit_redirection=plan['explicitResolution'],is_redirected=True,
              effective_resolution=plan['explicitResolution'],resolution_info='synthetic application override')
    overridden['targetRedirection']=dict(available=True,value=plan['explicitResolution'],nativeType='string')
    versions(overridden)
    immediate=copy.deepcopy(normal);immediate['library']['references'][-1]['rawFields'].update(effective_resolution=None,resolution_info=None)
    immediate['library']['references'][-1]['resolutionStatus']='unknown';versions(immediate)
    return plan,normal,overridden,immediate


def set_files(plan,normal,before,mode,edit=None):
    def setup(intent,store):
        root='synthetic-only'
        evidence={}
        for key,name,value in [('state','normal-normal-build-readback.json',normal),
                ('intent','normal-intent.json',dict(synthetic=True)),('declarePlan','declare-plan.json',dict(synthetic=True))]:
            store[os.path.join(root,name)]=copy.deepcopy(value)
            evidence[key+'File']=name;evidence[key+'Sha256']=digest(json.dumps(value,sort_keys=True))
        p=copy.deepcopy(plan);p['normalEvidence']=evidence
        store[os.path.join(root,'normal-plan.json')]=copy.deepcopy(p)
        store[os.path.join(root,'baseline-plan.json')]=copy.deepcopy(p)
        store[os.path.join(root,'baseline-initial.json')]=copy.deepcopy(before)
        store[os.path.join(root,'clear-after-save.json')]=copy.deepcopy(normal)
        if mode=='verify':intent['previousStage']['stateSha256']=digest(json.dumps(normal,sort_keys=True))
        previous=intent['previousStage']['mode']
        result=store[os.path.join(root,previous+'-result.json')]
        if 'planSha256' in result:
            result['planSha256']=digest(json.dumps(store[os.path.join(root,previous+'-plan.json')],sort_keys=True))
            result_hash=digest(json.dumps(result,sort_keys=True))
            intent['previousStage']['resultSha256']=result_hash
            obs=store[os.path.join(root,previous+'-observation-complete.json')]
            obs['result'].update(value=copy.deepcopy(result),sha256=result_hash)
            intent['previousStage']['observationSha256']=digest(json.dumps(obs,sort_keys=True))
        if edit:edit(intent,store)
    return setup


def boundaries(plan, fail_set=False, fail_load=False):
    def create(calls):
        calls.update(setter=0,load=0)
        def setter(value):
            calls['setter']+=1
            if fail_set:raise RuntimeError('first setter error after possible commit')
        def load(value):
            calls['load']+=1
            if fail_load:raise RuntimeError('public load failed')
            assert value is True
            return ['synthetic library list; not native proof']
        ref=types.SimpleNamespace(id=plan['referenceId'],set_redirection=setter)
        return dict(manager=types.SimpleNamespace(get_libraries=load),refs=[ref])
    return create


def native_clear(edit_immediate=None,edit_final=None,fail_set=False,fail_load=False,edit_store=None,publication=None):
    p,n,b,i=fixture()
    if edit_immediate:edit_immediate(i);versions(i)
    if edit_final:edit_final(n);versions(n)
    return run_fake('clear',[b,b,i,n,n,n],set_files(p,p['normalBaseline'],b,'clear',edit_store),
        publication,boundaries(p,fail_set,fail_load))


class NormalBaseline(unittest.TestCase):
    def test_original_created_and_cleared_unresolved_states_equal(self):
        a=json.loads((ARCHIVE/'prepare-created.json').read_text('utf-8-sig'))
        b=json.loads((ARCHIVE/'clear-after-clear.json').read_text('utf-8-sig'))
        self.assertEqual(a,b)
        p,_,_,_=fixture();p['placeholderName']='ClearProbeOwned';p['projectPath']=a['projectPath'];p.pop('normalBaseline')
        with self.assertRaisesRegex(ValueError,'null/unknown'):guard.normal_resolution(a,p)
    def test_normal_measured_not_default_assumed(self):
        p,n,b,i=fixture();guard.normal_resolution(n,p);guard.after_override(n,b,p)
        guard.after_clear_immediate(b,i,p);guard.after_clear(b,n,p)
    def test_null_empty_unknown_source_rejected_before_override(self):
        for key,values in [('effective_resolution',[None,'','None','other']),('resolution_info',[None,'','None']),('resolver_guid',[None,'','other'])]:
            for value in values:
                p,n,_,_=fixture();n['library']['references'][-1]['rawFields'][key]=value
                with self.assertRaises((ValueError,TypeError)):guard.normal_resolution(n,p)
    def test_name_identity_system_managed_namespace_conflicts(self):
        for key,value in [('id','9'),('placeholder_name','other'),('system_library',True),('is_managed',True),('namespace','other')]:
            p,n,_,_=fixture();n['library']['references'][-1]['rawFields'][key]=value
            with self.assertRaises(ValueError):guard.normal_resolution(n,p)
    def test_source_changed_even_if_installed_resolution_equal(self):
        p,n,b,_=fixture();n['library']['references'][-1]['rawFields']['resolution_info']='different native source'
        with self.assertRaises(ValueError):guard.after_clear(b,n,p)
    def test_no_saved_normal_proof_no_clear_dispatch(self):
        p,n,b,_=fixture();p['normalSavedReopened']=False;calls=[]
        with self.assertRaises(ValueError):guard.clear_once(types.SimpleNamespace(set_redirection=calls.append),b,b,p,p['diskHash'],lambda:calls.append('mark'))
        self.assertEqual(calls,[])
    def test_normal_version_change_detected(self):
        p,n,b,_=fixture();n['library']['configurationVersion']='different'
        with self.assertRaises(ValueError):guard.after_override(n,b,p)
    def test_clear_still_override_or_null_after_load_rejected(self):
        p,n,b,i=fixture()
        for state in [b,i]:
            with self.assertRaises(ValueError):guard.after_clear(b,state,p)
    def test_immediate_status_must_match_raw_effective(self):
        p,n,b,i=fixture();i['library']['references'][-1]['resolutionStatus']='effective-resolution-reported'
        with self.assertRaises(ValueError):guard.after_clear_immediate(b,i,p)
    def test_original_fields_and_unknown_keys_preserved(self):
        for key in ('sources','tasks','sourceSnapshot','device'):
            p,n,b,_=fixture();n[key]={'unexpected':'change'}
            with self.assertRaises(ValueError):guard.after_clear(b,n,p)
    def test_native_clear_immediate_then_single_load_then_save(self):
        calls,r,e,_=native_clear()
        self.assertEqual(r['status'],'succeeded');self.assertEqual(calls['setter'],1);self.assertEqual(calls['load'],1)
        self.assertEqual(calls['save'],1);self.assertEqual(calls['close'],1);self.assertEqual(calls['compile'],1)
        self.assertEqual(e['clear-after-clear-immediate-check.json']['publicLoadCount'],0)
        self.assertIsNone(e['clear-after-clear-immediate.json']['library']['references'][-1]['rawFields']['effective_resolution'])
    def test_native_setter_exception_no_load_no_save(self):
        calls,r,e,_=native_clear(fail_set=True)
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['setter'],1)
        self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0);self.assertEqual(calls['close'],0)
        self.assertIn('first setter error',r['primaryException']['message'])
    def test_native_immediate_bad_identity_no_load(self):
        calls,r,e,_=native_clear(lambda s:s['library']['references'][-1]['rawFields'].update(id='123'))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
    def test_native_immediate_override_present_no_load(self):
        calls,r,e,_=native_clear(lambda s:s['library']['references'][-1]['rawFields'].update(is_redirected=True))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
    def test_native_immediate_other_reference_changed_no_load(self):
        calls,r,e,_=native_clear(lambda s:s['library']['references'][0]['rawFields'].update(namespace='changed'))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
    def test_native_immediate_missing_field_no_load(self):
        calls,r,e,_=native_clear(lambda s:s['library']['references'][-1]['rawFields'].pop('resolution_info'))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
    def test_native_immediate_publication_failure_no_load(self):
        calls,r,e,_=native_clear(publication='after-clear-immediate-check.json')
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
    def test_native_load_error_is_not_retried_or_saved(self):
        calls,r,e,_=native_clear(fail_load=True)
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],1);self.assertEqual(calls['save'],0)
    def test_native_load_null_result_no_save(self):
        calls,r,e,_=native_clear(edit_final=lambda s:s['library']['references'][-1]['rawFields'].update(effective_resolution=None))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['load'],1);self.assertEqual(calls['save'],0)
    def test_native_changed_normal_file_stops_before_clear(self):
        def edit(i,s):s[os.path.join('synthetic-only','normal-normal-build-readback.json')]['sourceSnapshot']='changed'
        calls,r,e,_=native_clear(edit_store=edit)
        self.assertEqual(calls['setter'],0);self.assertEqual(calls['load'],0);self.assertEqual(calls['save'],0)
        self.assertIn('Normal baseline evidence changed',r['primaryException']['message'])
    def test_native_independent_reopen_wrong_state_no_compile_or_save(self):
        p,n,b,_=fixture();changed=copy.deepcopy(n);changed['library']['references'][-1]['rawFields']['explicit_redirection']='wrong'
        calls,r,e,_=run_fake('verify',[changed],set_files(p,n,b,'verify'),boundaries=boundaries(p))
        self.assertEqual(calls['setter'],0);self.assertEqual(calls['save'],0);self.assertEqual(calls['compile'],0)
        self.assertIn('readback differs',r['primaryException']['message'])
    def test_native_declare_normal_compile_save_before_any_override(self):
        calls,r,e,_=self.declare()
        self.assertEqual(r['status'],'succeeded');self.assertEqual(calls['placeholder'],1)
        self.assertEqual(calls['setter'],0);self.assertEqual(calls['load'],1);self.assertEqual(calls['compile'],1);self.assertEqual(calls['save'],1)
        self.assertFalse(e['declare-plan.json']['normalSavedReopened'])
    def test_native_null_normal_creation_stops_without_override_compile_save(self):
        calls,r,e,_=self.declare(lambda s:s['library']['references'][-1]['rawFields'].update(effective_resolution=None))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['placeholder'],1);self.assertEqual(calls['setter'],0)
        self.assertEqual(calls['save'],0);self.assertEqual(calls['compile'],0);self.assertEqual(calls['close'],0)
    def test_native_normal_unknown_source_stops_without_override(self):
        calls,r,e,_=self.declare(lambda s:s['library']['references'][-1]['rawFields'].update(resolution_info=None))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['setter'],0);self.assertEqual(calls['save'],0)
    def test_native_created_reference_does_not_change_other_rows(self):
        calls,r,e,_=self.declare(lambda s:s['library']['references'][0]['rawFields'].update(namespace='changed'))
        self.assertEqual(r['status'],'unknown');self.assertEqual(calls['setter'],0);self.assertEqual(calls['save'],0)
    def declare(self,change=None):
        p,n,b,i=fixture();base=copy.deepcopy(n);base['library']['references'].pop();versions(base)
        base['targetRedirection']=dict(available=False,value=None,nativeType='null')
        if change:change(n);versions(n)
        def factory(calls):
            calls.update(setter=0,load=0)
            def add(name,default):calls['placeholder']+=1
            def loaded(value):calls['load']+=1;return ['synthetic loaded item']
            def setter(v):calls['setter']+=1;raise AssertionError('No override allowed during declare')
            ref=types.SimpleNamespace(id=p['referenceId'],system_library=False,is_managed=False,
                get_redirection=lambda:None,default_resolution=p['defaultResolution'],set_redirection=setter)
            entries=[p['defaultInstalled'],p['overrideInstalled']]
            natives={x['identity']:[object()] for x in entries}
            return dict(manager=types.SimpleNamespace(add_placeholder=add,get_libraries=loaded),
                refsForState=lambda s:[ref] if s['targetRedirection']['available'] else [],
                api=dict(installed_inventory=lambda:(dict(enumerationComplete=True,entries=entries),natives)))
        return run_fake('declare',[base,n,n,n],boundaries=factory)


if __name__=='__main__':unittest.main(verbosity=2)
