# -*- coding: utf-8 -*-
"""Archived state regression + substituted native build; never opens the real project."""
import copy,json,os,sys,unittest,io,tempfile,types,shutil
sys.path.insert(0,os.path.dirname(__file__))
from test_resident_build import c,BuildNative
with io.open(os.path.join(os.path.dirname(__file__),'fixtures','resident-build-library-native.json'),encoding='utf-8') as f:ARCHIVE=json.load(f)
AID=ARCHIVE['before']['state']['applications'][0]
MID='5d558397-776b-478d-ab91-fa36aca5d60a'
OBJ='76817b8e-cf3d-4b51-82a0-fb6e8bc7c778'
def support():
    # Substitute loaded-assembly read. These values are NOT retrofilled into old IPC.
    return dict(scheme='resident-compiler-library-support-v1',assemblies=[dict(name=n,version='1.9.1.6',path=n+'.dll',sha256=h) for n,h in sorted(c.COMPILER_LIBRARY_ARTIFACTS.items())])
def verify(f,s=None,aid=AID):return c.build_conservation(f['before']['state'],f['after']['state'],f['build-context-before'],f['after']['buildContext'],aid,s)
def refs(f):return f['after']['state']['nodes'][MID]['directLibraries']
class LibraryBuildNative(BuildNative):
    def __init__(self):
        BuildNative.__init__(self);self.state=copy.deepcopy(ARCHIVE['before']['state']);self.support=support();self.mutate=None
    def prepare_build(self,aid):
        if aid!=AID:raise c.Rejection('Wrong app')
    def build_context(self,s):return copy.deepcopy(ARCHIVE['build-context-before'])
    def build_library_support(self):return copy.deepcopy(self.support)
    def compile_application(self,aid,publish,gate):
        self.after_build=lambda n:n.state.update(copy.deepcopy(ARCHIVE['after']['state']))
        if self.mutate:
            def changed(n):n.state.update(copy.deepcopy(ARCHIVE['after']['state']));self.mutate(n)
            self.after_build=changed
        return BuildNative.compile_application(self,aid,publish,gate)
class LibraryCases(unittest.TestCase):
    def test_archived_addition_raw_state_unchanged(self):
        f=copy.deepcopy(ARCHIVE);p=verify(f,support());self.assertFalse(p['directLibrariesUnchanged']);self.assertTrue(p['originalDirectLibrariesUnchanged']);self.assertEqual(p['compilerAddedDirectLibraries'][0]['reference'],refs(f)[-1]);self.assertEqual(f,ARCHIVE)
        self.assertEqual(p['compilerAddedDirectLibraries'][0]['index'],17)
    def test_already_present_no_new_proof_required(self):
        f=copy.deepcopy(ARCHIVE);f['before']=copy.deepcopy(f['after']);f['build-context-before']=f['after']['buildContext'];p=verify(f);self.assertTrue(p['directLibrariesUnchanged']);self.assertNotIn('compilerAddedDirectLibraries',p)
    def test_support_and_application_required(self):
        for s in [None,{},dict(support(),assemblies=[]),dict(support(),extra=True)]:self.assertRaises((ValueError,TypeError),verify,ARCHIVE,s)
        self.assertRaises(ValueError,verify,ARCHIVE,support(),OBJ)
    def test_reference_identity_and_prefix_length_are_not_fixture_constants(self):
        f=copy.deepcopy(ARCHIVE);f['before']['state']['nodes'][MID]['directLibraries']=f['before']['state']['nodes'][MID]['directLibraries'][:2];f['after']['state']['nodes'][MID]['directLibraries']=refs(f)[:2]+[refs(f)[-1]];refs(f)[-1]['id']='980234';self.assertEqual(verify(f,support())['compilerAddedDirectLibraries'][0]['index'],2)
    def test_loaded_assembly_collector_is_read_only_and_propagates_failure(self):
        root=tempfile.mkdtemp();old=sys.modules.get('System');fake=types.ModuleType('System')
        class Version(object):
            def ToString(self):return '1.9.1.6'
        class Assembly(object):
            def __init__(self,name):self.Name=name;self.Version=Version();self.Location=os.path.join(root,name+'.dll')
            def GetName(self):return self
        assemblies=[Assembly(n) for n in c.COMPILER_LIBRARY_ARTIFACTS]
        for a in assemblies:
            with open(a.Location,'wb') as f:f.write(b'only an offline assembly substitute')
        class Domain(object):
            def GetAssemblies(self):return assemblies
        fake.AppDomain=type('AppDomain',(),dict(CurrentDomain=Domain()));sys.modules['System']=fake
        try:
            proof=c.compiler_library_support();self.assertEqual(len(proof['assemblies']),2)
            for r in proof['assemblies']:self.assertEqual(r['sha256'],c.file_hash(r['path']))
            os.remove(assemblies[0].Location);self.assertRaises(IOError,c.compiler_library_support)
        finally:
            if old is None:sys.modules.pop('System',None)
            else:sys.modules['System']=old
            shutil.rmtree(root)
    def test_real_build_production_handler_and_next_version(self):
        n,s,records,req=self.session();r=s.handle(req);self.assertEqual(r['status'],'succeeded',r);self.assertEqual(n.builds,1);self.assertEqual(n.writes,0);self.assertEqual(n.saves,0)
        self.assertNotEqual(r['data']['residentVersion'],req['args']['expectedResidentVersion']);self.assertEqual(r['data']['buildInputResidentVersion'],req['args']['expectedResidentVersion']);self.assertEqual(records['verification.json'],r['data']['buildConservation'])
        old=s.handle(dict(req,operationId='stale',requestId='stale'));self.assertEqual(old['status'],'conflict');self.assertEqual(n.builds,1)
        nxt=copy.deepcopy(req);nxt['args']['expectedResidentVersion']=r['data']['residentVersion'];self.assertEqual(s.handle(nxt)['status'],'succeeded');self.assertEqual(n.builds,2)
    def session(self,pubfault=None):
        n=LibraryBuildNative();records={}
        def pub(k,v):
            if k==pubfault:raise IOError('first evidence publication fault')
            records[k]=copy.deepcopy(v)
        disk=ARCHIVE['before']['diskHash'];s=c.ResidentSession(n,lambda:disk,pub)
        req=dict(command='build',args=dict(applicationId=AID,expectedResidentVersion=c.digest(dict(dependencies=c.dependencies(n.state),diskHash=disk))),operationId='offline-build',requestId='offline-build',directory='substitute')
        return n,s,records,req
    def test_unconfirmed_freezes_no_recovery_and_first_error(self):
        for fault in ['compiler-library-support-after.json','verification.json','mutation','support-change']:
            n,s,records,req=self.session(fault)
            if fault=='mutation':n.mutate=lambda n:n.state['nodes'][MID]['directLibraries'][-1].update(explicit_redirection='bad')
            if fault=='support-change':n.mutate=lambda n:n.support['assemblies'][0].update(path='different.dll')
            r=s.handle(req);self.assertEqual(r['status'],'unknown',r);self.assertEqual(n.builds,1);self.assertEqual(n.saves,0);self.assertEqual(n.writes,0);self.assertRaises(c.Conflict,s.handle,req);self.assertIn('after.json',records)
            if fault.endswith('.json'):self.assertEqual(r['data']['firstError']['message'],'first evidence publication fault')
    def test_support_publication_failure_before_native_call(self):
        n,s,records,req=self.session('compiler-library-support-before.json');r=s.handle(req);self.assertEqual(r['status'],'unknown');self.assertEqual(n.builds,0);self.assertEqual(n.saves,0)

MUTATIONS={
 'extra-reference':lambda f:refs(f).append(copy.deepcopy(refs(f)[-1])),
 'removed-original':lambda f:refs(f).pop(0),
 'reordered-original':lambda f:refs(f).__setitem__(slice(0,2),list(reversed(refs(f)[:2]))),
 'original-namespace':lambda f:refs(f)[0].update(namespace='changed'),
 'original-unknown-field':lambda f:refs(f)[0].update(extra=None),
 'wrong-library-name':lambda f:refs(f)[-1].update(name='#OtherSystemLibrary'),
 'wrong-version':lambda f:refs(f)[-1].update(effective_resolution='IecVarAccess, 9.0.0.0 (System)'),
 'wrong-default':lambda f:refs(f)[-1].update(default_resolution='wrong'),
 'explicit-redirection':lambda f:refs(f)[-1].update(explicit_redirection=''),
 'redirected':lambda f:refs(f)[-1].update(is_redirected=True),
 'system-flag-type':lambda f:refs(f)[-1].update(system_library=1),
 'wrong-resolver':lambda f:refs(f)[-1].update(resolver_guid=OBJ),
 'missing-field':lambda f:refs(f)[-1].pop('namespace'),
 'unknown-field':lambda f:refs(f)[-1].update(extra=False),
 'duplicate-id':lambda f:refs(f)[-1].update(id=refs(f)[0]['id']),
 'null-id':lambda f:refs(f)[-1].update(id=None),
 'noncanonical-id':lambda f:refs(f)[-1].update(id='0'+refs(f)[0]['id']),
 'missing-null-top-field':lambda f:f['before']['state'].update(extra=None),
 'manager-application':lambda f:f['after']['state']['nodes'][MID].update(applicationId=OBJ),
 'manager-path':lambda f:f['after']['state']['nodes'][MID]['path'].append('wrong'),
 'source-change':lambda f:f['after']['state']['nodes'][OBJ].update(implementation='changed'),
 'source-language':lambda f:f['after']['state']['nodes'][OBJ].update(embeddedObjectTypes=[]),
 'application-list':lambda f:f['after']['state']['applications'].append(OBJ),
 'task-calls':lambda f:next(r for r in f['after']['state']['nodes'].values() if 'calls' in r)['calls'].append(['Other','']),
 'device-version':lambda f:next(iter(f['after']['buildContext']['devices'].values()))['identity'].update(version='other'),
 'coverage-gap':lambda f:f['after']['buildContext']['children'].pop(MID),
}
for name,mutate in MUTATIONS.items():
    def case(self,mutate=mutate):
        f=copy.deepcopy(ARCHIVE);mutate(f);self.assertRaises((ValueError,TypeError,KeyError),verify,f,support())
    setattr(LibraryCases,'test_reject_'+name.replace('-','_'),case)
for field,value in [('version','1.9.1.7'),('sha256','0'*64),('path','')]:
    def case(self,field=field,value=value):
        s=support();s['assemblies'][0][field]=value;self.assertRaises(ValueError,verify,ARCHIVE,s)
    setattr(LibraryCases,'test_reject_support_'+field,case)
if __name__=='__main__':unittest.main()
