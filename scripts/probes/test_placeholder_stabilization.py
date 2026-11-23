# -*- coding: utf-8 -*-
"""Offline only. Archived inputs are read-only; neutral compile result is synthetic.

This suite calls the real guard and extracted native run function with fake handles.
No native entry/body, Store, IDE or project file is executed/opened.
"""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import types
import unittest
import library_placeholder_clear_guard as guard

SCRIPTS = Path(__file__).parent
ARCHIVE = Path(os.environ.get('PLACEHOLDER_STOP_ARCHIVE', r'D:\InoPro-PlaceholderClear-20261123-120000'))
FIXED = Path(r'D:\InoPro-Fixed\0.36.0-da87ac1d553a')
HASHES = {
    'prepare-initial.json':'ff5b5ad695a7fe3be971d8551174357d597c5e70a2e7366ac28244d0a1b06ff4',
    'baseline-initial.json':'98827fa086e44913df51e85147fe499a7e99ce39f524f706ccdadee48c6ea1e2',
    'baseline-baseline-build-readback.json':'1c90872c41b94aa8188bdfdb03a9e4dfbfadd940a48d1e638fd52b903f4f8de6'}


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode('utf-8')).hexdigest()


def archived(name):
    data = (ARCHIVE/name).read_bytes()
    assert digest(data) == HASHES[name], 'Archived input changed'
    return json.loads(data)


# Only fixed top-level definitions/constants; no worker/native dispatch code.
library_file = FIXED/'bridge/library_reference.py'
assert digest(library_file.read_bytes()) == 'dc3f73356dfde1e19792c0d5d4cc6c71d1df66d1e4d38f24521f9db0763f426e'
API = dict(sha=digest, encode=lambda x:json.dumps(x, ensure_ascii=False, separators=(',', ':'), sort_keys=True))
exec(compile(library_file.read_text(encoding='utf-8'), str(library_file), 'exec'), API)


def versions(state):
    inv=state['library']
    inv['scope']['capturedReferences']=len(inv['references'])
    inv['managers'][0]['capturedReferences']=len(inv['references'])
    inv['configurationVersion']=API['library_configuration_version'](inv)
    inv['placeholderConfigurationVersion']=API['placeholder_configuration_version'](inv)


def neutral_pair():
    before=archived('prepare-initial.json');after=copy.deepcopy(before)
    # Projection of the six actual rows onto pre-target neutral input. This is NOT
    # a historical snapshot or proof of future save/reopen persistence.
    extra=archived('baseline-baseline-build-readback.json')['library']['references'][13:]
    for row in extra:
        i=len(after['library']['references'])
        row['order']=row['index']=i;row['path'][-1]=str(i)
        after['library']['references'].append(row)
    versions(after)
    return before, after


def context(mode='stabilize'):
    return dict(mode=mode,seedSha256=guard.STABILIZATION_SEED,
                expectedDisk=guard.STABILIZATION_SEED,nativeVersion='1.9.1.6')


def provenance(mode, state):
    """Synthetic predecessor evidence, never written to native output directories."""
    root='synthetic-only';intent=context(mode)
    intent.update(operationId='synthetic-operation',launchId='current',project=state['projectPath'],previousStage=None)
    intent.update({k:'a'*64 for k in guard.FINGERPRINT_KEYS})
    # These must match actual code bytes when the extracted native work runs.
    for key, name in [('launcherSha256','library-placeholder-clear-launch.mjs'),
                      ('phaseContractSha256','placeholder-probe-stages.mjs'),('loaderSha256','probe_fixed_helpers.py')]:
        intent[key]=digest((SCRIPTS/name).read_bytes())
    store={};index=guard.PHASES.index(mode)
    if index:
        previous=guard.PHASES[index-1];prior=copy.deepcopy(intent);prior['mode']=previous;prior['launchId']='previous'
        counts=guard.PHASE_COUNTS[index-1]
        binding=dict(operationId=intent['operationId'],launchId=prior['launchId'],scriptSha256=prior['sha256'])
        result=dict(status='succeeded',closed=True,mode=previous,operationId=intent['operationId'],
                    projectPath=intent['project'],diskBefore=prior['expectedDisk'],diskAfterClose=intent['expectedDisk'],
                    saveCount=counts[0],fixtureMutationCount=counts[1],clearDispatchCount=counts[2],
                    compileCount=counts[3],compileCompletedCount=counts[3],
                    publicLoadCount=guard.PHASE_LOADS[index-1],
                    engine=dict(pid=42,creationUtcTicks='birth-previous'),
                    traceBinding=dict(binding,pid=42,creationUtcTicks='birth-previous'))
        if previous in ('declare','normal','prepare','baseline'):
            plan=dict(synthetic=True)
            store[os.path.join(root,previous+'-plan.json')]=plan
            result['planSha256']=digest(json.dumps(plan,sort_keys=True))
        result_hash=digest(json.dumps(result,sort_keys=True))
        observation=dict(status='succeeded',timedOut=False,identityMatches=True,normalExit=True,
            primaryException=None,loggerErrors=[],exit=dict(code=0,signal=None),binding=binding,
            birth=dict(state='running',identity=dict(pid=42,startId='birth-previous')),
            result=dict(exists=True,sha256=result_hash,value=copy.deepcopy(result)))
        link=dict(mode=previous)
        for key,suffix,val in [('intent','intent',prior),('result','result',result),
                              ('observation','observation-complete',observation),('state',guard.PHASE_STATES[index-1],copy.deepcopy(state))]:
            name=os.path.join(root,previous+'-'+suffix+'.json');store[name]=val
            link[key+'Sha256']=digest(json.dumps(val,sort_keys=True))
        intent['previousStage']=link
    return root,intent,store


def run_fake(mode, states, change_intent=None, fail_publication=None, boundaries=None):
    """Execute actual run/work/build/guard/save/close control flow, fake boundaries.

    Only capture() is replaced by deterministic archived/synthetic data. All
    nested phase logic, validation and failure handling come from the native file.
    """
    before=copy.deepcopy(states[0]);root,intent,store=provenance(mode,before)
    if change_intent:change_intent(intent,store)
    calls=dict(open=0,save=0,close=0,compile=0,exit=0,placeholder=0)
    emitted={};failures=[];current_hash=[intent['expectedDisk']];queue=list(copy.deepcopy(states))
    extra = boundaries(calls) if boundaries else {}
    virtual_files={}
    class Project:
        path=intent['project']
        def save(self):calls['save']+=1;current_hash[0]='b'*64
        def close(self):calls['close']+=1;projects.primary=None
    project=Project()
    def opened(p):calls['open']+=1;projects.primary=project;return project
    projects=types.SimpleNamespace(primary=None,open=opened)
    def file_hash(p):
        if p==intent['project']:return current_hash[0]
        if p in virtual_files:return virtual_files[p]
        if Path(p).name in emitted:return digest(json.dumps(emitted[Path(p).name],sort_keys=True))
        if p in store:return digest(json.dumps(store[p],sort_keys=True))
        return digest(Path(p).read_bytes())
    def load(p):
        if p==os.path.join(root,mode+'-intent.json'):return intent
        return copy.deepcopy(store[p])
    def capture():
        value=queue.pop(0)
        if isinstance(value,Exception):raise value
        refs=extra['refsForState'](value) if 'refsForState' in extra else extra.get('refs',[])
        return value,extra.get('manager'),refs,{}
    def publish(p,v):
        if fail_publication and p.endswith(fail_publication):raise OSError('evidence publication failed')
        emitted[Path(p).name]=copy.deepcopy(v)
    def build(*args):calls['compile']+=1;return dict(status='succeeded',data=dict(buildPassed=True,diagnosticsComplete=True))
    api=dict(API,publish=publish,file_hash=file_hash,direct_exclusive_probe=lambda p:None,
             compile_application=build,exception_evidence=lambda e:dict(message=str(e),type=type(e).__name__))
    api.update(extra.get('api',{}))
    class Trace:
        def record(self,*a,**k):pass
        def primary_call(self,s,fn):fn()
        def fail(self,stage,error):failures.append((stage,str(error)))
        def publish_result(self,value,p):publish(p,value)
        def request_exit(self,s):calls['exit']+=1
    proc=types.SimpleNamespace(Id=43,StartTime=types.SimpleNamespace(ToUniversalTime=lambda:types.SimpleNamespace(Ticks='current-birth')),
        MainModule=types.SimpleNamespace(FileVersionInfo=types.SimpleNamespace(FileVersion='1.9.1.6')))
    loader=types.SimpleNamespace(load_fixed_helpers=lambda *a:(guard,api,{}))
    scope=dict(os=os,load=load,hashlib=hashlib,imp=types.SimpleNamespace(load_source=lambda *a:loader),
        _trace=Trace(),projects=projects,system=None,librarymanager=None,unicode=str,
        Process=types.SimpleNamespace(GetCurrentProcess=lambda:proc),_capture_stub=capture,
        File=types.SimpleNamespace(Copy=lambda a,b,c:virtual_files.__setitem__(b,file_hash(a))),
        DateTime=types.SimpleNamespace(UtcNow=types.SimpleNamespace(ToString=lambda x:'synthetic-utc')))
    tree=ast.parse((SCRIPTS/'library-placeholder-clear-native.py').read_text(encoding='utf-8'))
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
    capture_fn=next(n for n in fn.body if isinstance(n,ast.FunctionDef) and n.name=='capture')
    capture_fn.body=ast.parse('return _capture_stub()').body
    module=ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[]))
    exec(compile(module,'actual-native-run-with-fake-capture','exec'),scope)
    scope['run'](root,str(FIXED),mode,str(SCRIPTS))
    return calls,emitted[mode+'-result.json'],emitted,failures


class Stabilization(unittest.TestCase):
    def reject(self, edit, edit_before=None, mode='stabilize'):
        b,a=neutral_pair()
        if edit_before:edit_before(b)
        edit(a)
        # Recompute legitimate content versions: guard must reject actual data,
        # not pass merely because a hash was updated.
        versions(b);versions(a)
        with self.assertRaises((ValueError,KeyError,TypeError)):
            guard.stabilize_transition(b,a,context(mode),API)
    def test_original_archive_still_fails_strict_comparison(self):
        with self.assertRaisesRegex(ValueError,'configurationVersion'):
            guard.equal(archived('baseline-initial.json'),archived('baseline-baseline-build-readback.json'),'Original compile')
    def test_observed_six_projected_before_target(self):
        b,a=neutral_pair();guard.stabilize_transition(b,a,context(),API)
        self.assertEqual(a['library']['references'][-1]['rawFields']['default_resolution'],'IecVarAccess, 3.3.1.20 (System)')
        self.assertEqual(a['library']['references'][-1]['rawFields']['effective_resolution'],'IecVarAccess, 3.5.11.0 (System)')
    def test_original_target_present_pair_cannot_be_reclassified(self):
        with self.assertRaises(ValueError):guard.stabilize_transition(archived('baseline-initial.json'),archived('baseline-baseline-build-readback.json'),context(),API)
    def test_exception_only_first_stage(self):
        for mode in guard.PHASES[1:]:self.reject(lambda a:None,mode=mode)
    def test_bad_seed_or_runtime(self):
        b,a=neutral_pair()
        for key in ('seedSha256','expectedDisk','nativeVersion'):
            c=context();c[key]='changed'
            with self.assertRaises(ValueError):guard.stabilize_transition(b,a,c,API)
    def test_extra_row(self):self.reject(lambda a:a['library']['references'].append(copy.deepcopy(a['library']['references'][-1])))
    def test_missing_row(self):self.reject(lambda a:a['library']['references'].pop())
    def test_wrong_order(self):
        def edit(a):a['library']['references'][-1],a['library']['references'][-2]=a['library']['references'][-2],a['library']['references'][-1]
        self.reject(edit)
    def test_all_added_fields_strict(self):
        for index in range(-6,0):
            for key in ('namespace','default_resolution','effective_resolution','resolution_info','resolver_guid','placeholder_name','name'):
                self.reject(lambda a:a['library']['references'][index]['rawFields'].__setitem__(key,'changed'))
            for key in ('system_library','is_managed','is_placeholder','optional','qualified_only','is_redirected'):
                self.reject(lambda a:a['library']['references'][index]['rawFields'].__setitem__(key,not a['library']['references'][index]['rawFields'][key]))
    def test_override_null_not_empty_or_literal(self):
        for value in ('','None','changed'):self.reject(lambda a:a['library']['references'][-1]['rawFields'].__setitem__('explicit_redirection',value))
    def test_unknown_new_field(self):self.reject(lambda a:a['library']['references'][-1]['rawFields'].__setitem__('newUnknown','value'))
    def test_changed_old_reference(self):self.reject(lambda a:a['library']['references'][0]['rawFields'].__setitem__('namespace','changed'))
    def test_duplicate_and_invalid_id(self):
        for value in (None,'',0,'0','-1','x','001'):
            self.reject(lambda a:a['library']['references'][-1]['rawFields'].__setitem__('id',value))
        self.reject(lambda a:a['library']['references'][-1]['rawFields'].__setitem__('id',a['library']['references'][0]['rawFields']['id']))
    def test_owner_path_and_device_changed(self):
        for key in ('managerId','applicationId','projectPath','managerPath','applicationPath'):
            self.reject(lambda a:a.__setitem__(key,'changed'))
        for key in ('id','path','type','descriptionId','version'):self.reject(lambda a:a['device'].__setitem__(key,'changed'))
    def test_coverage_and_field_failure(self):
        for key,value in [('enumerationComplete',False),('fieldReadComplete',False),('truncated',True),('enumerationFailures',['read error'])]:
            self.reject(lambda a:a['library']['scope'].__setitem__(key,value))
        self.reject(lambda a:a['library']['references'][-1].__setitem__('unavailableFields',['id']))
        self.reject(lambda a:a['library']['references'][-1]['rawFields'].pop('resolver_guid'))
    def test_source_task_or_unknown_state_changed(self):
        for key in ('sources','tasks','sourceSnapshot'):self.reject(lambda a:a.__setitem__(key,{'changed':True}))
        self.reject(lambda a:a.__setitem__('newState','changed'))
    def test_stored_hash_is_checked(self):
        b,a=neutral_pair();a['library']['configurationVersion']='c'*64
        with self.assertRaises(ValueError):guard.stabilize_transition(b,a,context(),API)
    def test_other_stages_full_equality(self):
        b,a=neutral_pair();guard.stable_state(a,copy.deepcopy(a),API)
        with self.assertRaises(ValueError):guard.stable_state(b,a,API)
    def test_native_first_compile_save_order(self):
        b,a=neutral_pair();calls,result,events,_=run_fake('stabilize',[b,a,a])
        self.assertEqual(result['status'],'succeeded');self.assertEqual(calls,dict(open=1,save=1,close=1,compile=1,exit=1,placeholder=0))
        self.assertIn('stabilize-stabilize-build-comparison.json',events)
    def test_native_bad_addition_no_save_and_preserves_scene(self):
        b,a=neutral_pair();a['library']['references'][-1]['rawFields']['namespace']='changed';versions(a)
        calls,result,_,failures=run_fake('stabilize',[b,a])
        self.assertEqual(result['status'],'unknown');self.assertEqual(calls['save'],0);self.assertEqual(calls['close'],0)
        self.assertEqual(calls['exit'],0);self.assertIn('exact system additions',failures[0][1])
    def test_native_after_stabilize_save_failure_is_unknown_no_recovery(self):
        b,a=neutral_pair();changed=copy.deepcopy(a);changed['sourceSnapshot']='changed'
        calls,result,_,_=run_fake('stabilize',[b,a,changed])
        self.assertEqual(result['status'],'unknown');self.assertEqual(result['saveCount'],1)
        self.assertEqual(calls['save'],1);self.assertEqual(calls['close'],0);self.assertEqual(calls['exit'],0)
        self.assertIn('sourceSnapshot',result['primaryException']['message'])
    def test_native_after_save_read_exception_first_error_preserved(self):
        b,a=neutral_pair();calls,result,_,_=run_fake('stabilize',[b,a,RuntimeError('first read failed')],fail_publication='first-failure.json')
        self.assertEqual(result['primaryException']['message'],'first read failed')
        self.assertEqual(result['evidenceError']['message'],'evidence publication failed')
        self.assertEqual(calls['save'],1);self.assertEqual(calls['close'],0)
    def test_native_compile_comparison_publication_failure_blocks_save(self):
        b,a=neutral_pair();calls,result,_,_=run_fake('stabilize',[b,a],fail_publication='stabilize-build-comparison.json')
        self.assertEqual(result['status'],'unknown');self.assertEqual(calls['save'],0);self.assertEqual(calls['close'],0)
        self.assertEqual(result['primaryException']['message'],'evidence publication failed')
    def test_native_stable_reopen_and_compile_no_save(self):
        _,a=neutral_pair();calls,result,_,_=run_fake('stable',[a,a])
        self.assertEqual(result['status'],'succeeded');self.assertEqual(calls['compile'],1);self.assertEqual(calls['save'],0)
    def test_native_stable_compile_drift_no_prepare(self):
        _,a=neutral_pair();changed=copy.deepcopy(a);changed['sourceSnapshot']='changed'
        calls,result,_,_=run_fake('stable',[a,changed])
        self.assertEqual(result['status'],'failed');self.assertEqual(calls['close'],1)
        self.assertEqual(calls['save'],0);self.assertEqual(calls['placeholder'],0)
    def test_native_prepare_cannot_skip_stable(self):
        _,a=neutral_pair()
        calls,result,_,_=run_fake('prepare',[a],lambda i,s:i.__setitem__('previousStage',dict(mode='stabilize')))
        self.assertEqual(result['status'],'unknown');self.assertEqual(calls['open'],0)
        self.assertEqual(calls['save'],0);self.assertEqual(calls['placeholder'],0)


class StageEvidence(unittest.TestCase):
    def check(self, change=None):
        _,a=neutral_pair();root,i,s=provenance('prepare',a)
        if change:change(i,s)
        return guard.stage_preflight(i,'prepare',root,lambda p:s[p],lambda p:digest(json.dumps(s[p],sort_keys=True)))
    def test_bound_success(self):self.check()
    def test_missing_and_changed_evidence(self):
        for key in ('intentSha256','resultSha256','observationSha256','stateSha256'):
            with self.assertRaises(ValueError):self.check(lambda i,s:i['previousStage'].__setitem__(key,'b'*64))
    def test_different_code(self):
        for key in guard.FINGERPRINT_KEYS:
            with self.assertRaises(ValueError):self.check(lambda i,s:i.__setitem__(key,'b'*64))
    def test_failed_unknown_unclosed_or_exit_bad(self):
        for section,key,value in [('result','status','unknown'),('result','status','failed'),('result','closed',False),
                ('result','compileCompletedCount',0),('observation','status','unknown'),('observation','normalExit',False),
                ('observation','timedOut',True),('observation','identityMatches',False),('observation','loggerErrors',['failed'])]:
            def change(i,s):
                suffix='result' if section=='result' else 'observation-complete'
                p=os.path.join('synthetic-only','normal-'+suffix+'.json');s[p][key]=value
                i['previousStage'][section+'Sha256']=digest(json.dumps(s[p],sort_keys=True))
            with self.assertRaises(ValueError):self.check(change)
    def test_disk_and_operation_changed(self):
        for key in ('expectedDisk','operationId','project','nativeVersion'):
            with self.assertRaises(ValueError):self.check(lambda i,s:i.__setitem__(key,'changed'))
    def test_predecessor_observer_binding_pid_and_result_content(self):
        for edit in (lambda o:o['binding'].__setitem__('launchId','wrong'),
                     lambda o:o['birth']['identity'].__setitem__('startId','wrong'),
                     lambda o:o['birth']['identity'].__setitem__('pid',99),
                     lambda o:o['exit'].__setitem__('code',1),
                     lambda o:o['exit'].__setitem__('signal','SIGTERM'),
                     lambda o:o['result'].__setitem__('sha256','b'*64),
                     lambda o:o['result']['value'].__setitem__('unknownField','wrong')):
            def change(i,s):
                p=os.path.join('synthetic-only','normal-observation-complete.json');edit(s[p])
                i['previousStage']['observationSha256']=digest(json.dumps(s[p],sort_keys=True))
            with self.assertRaises(ValueError):self.check(change)


if __name__=='__main__':unittest.main(verbosity=2)
