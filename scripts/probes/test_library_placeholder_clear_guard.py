"""Synthetic evidence only; does not open an IDE or prove native persistence."""
import copy
import unittest
from library_placeholder_clear_guard import preflight, after_clear, clear_once


def fixture():
    plan = dict(projectPath='fixture.project',applicationId='app',managerId='manager',referenceId='123',
                placeholderName='Owned',namespace='MATH',defaultResolution='Lib, 1 (Vendor)',
                explicitResolution='Lib, 2 (Vendor)',preparedByThisProbe=True,baselineSavedReopened=True,diskHash='disk')
    fields = dict(id='123',name='#Owned',namespace='MATH',is_placeholder=True,is_managed=False,system_library=False,
                  optional=False,qualified_only=False,placeholder_name='Owned',default_resolution=plan['defaultResolution'],
                  explicit_redirection=plan['explicitResolution'],effective_resolution=plan['explicitResolution'],
                  is_redirected=True,resolution_info='application override',resolver_guid='resolver')
    row = dict(managerId='manager',order=0,unavailableFields=[],rawFields=fields)
    other = dict(managerId='manager',order=1,unavailableFields=[],rawFields=dict(id='456',name='DirectLib',namespace='OTHER',
                 is_placeholder=False,is_managed=True,system_library=False,optional=False,qualified_only=False))
    state = dict(projectPath='fixture.project',applicationId='app',managerId='manager',
        library=dict(applicationId='app',managers=[dict(managerId='manager')],references=[row,other],
                     scope=dict(enumerationComplete=True,fieldReadComplete=True,truncated=False,enumerationFailures=[],capturedReferences=2),
                     configurationVersion='v1',placeholderConfigurationVersion='p1'),
        targetRedirection=dict(available=True,value=plan['explicitResolution'],nativeType='string'),
        sources=[dict(text='PROGRAM x')],tasks=dict(MainTask=dict(calls=[['PLC_PRG','中文'],['Keep','None']])) )
    return plan,state


def cleared(before):
    state=copy.deepcopy(before);f=state['library']['references'][0]['rawFields']
    f.update(explicit_redirection=None,is_redirected=False,effective_resolution=f['default_resolution'],resolution_info='default')
    state['targetRedirection']=dict(available=True,value=None,nativeType='null')
    state['library'].update(configurationVersion='v2',placeholderConfigurationVersion='p2')
    return state


class FakeReference:
    def __init__(self,fail=False): self.calls=[];self.fail=fail
    def set_redirection(self,value):
        self.calls.append(value)
        if self.fail: raise RuntimeError('first native failure after dispatch')


class ClearGuard(unittest.TestCase):
    def reject(self,change,plan_change=None,disk='disk'):
        plan,before=fixture();live=copy.deepcopy(before);change(live)
        if plan_change: plan_change(plan)
        ref=FakeReference();marks=[]
        with self.assertRaises((ValueError,KeyError,TypeError)):
            clear_once(ref,before,live,plan,disk,lambda:marks.append('dispatch'))
        self.assertEqual([],ref.calls);self.assertEqual([],marks)
    def post_reject(self,change):
        plan,before=fixture();after=cleared(before);change(after)
        with self.assertRaises((ValueError,KeyError,TypeError)): after_clear(before,after,plan)
    def test_exact_clear_once(self):
        plan,before=fixture();ref=FakeReference();marks=[]
        clear_once(ref,before,copy.deepcopy(before),plan,'disk',lambda:marks.append('dispatch'))
        self.assertEqual([None],ref.calls);self.assertEqual(['dispatch'],marks)
        after_clear(before,cleared(before),plan)
    def test_wrong_target(self): self.reject(lambda s:None,lambda p:p.update(referenceId='999'))
    def test_disk_changed(self): self.reject(lambda s:None,disk='other')
    def test_state_version_changed(self): self.reject(lambda s:s['library'].update(configurationVersion='new'))
    def test_application_changed(self): self.reject(lambda s:s['library'].update(applicationId='other'))
    def test_manager_changed(self): self.reject(lambda s:s['library']['managers'][0].update(managerId='other'))
    def test_duplicate_id(self): self.reject(lambda s:s['library']['references'][1]['rawFields'].update(id='123'))
    def test_duplicate_name_case(self):
        def change(s):
            row=copy.deepcopy(s['library']['references'][0]);row['rawFields'].update(id='789',placeholder_name='oWnEd')
            s['library']['references'].append(row);s['library']['scope']['capturedReferences']=3
        self.reject(change)
    def test_system_source(self): self.reject(lambda s:s['library']['references'][0]['rawFields'].update(system_library=True))
    def test_not_fixture_owned(self): self.reject(lambda s:None,lambda p:p.update(preparedByThisProbe=False))
    def test_missing_override(self): self.reject(lambda s:s['library']['references'][0]['rawFields'].update(explicit_redirection=None))
    def test_empty_override(self): self.reject(lambda s:s['library']['references'][0]['rawFields'].update(explicit_redirection=''))
    def test_missing_field(self): self.reject(lambda s:s['library']['references'][0]['rawFields'].pop('explicit_redirection'))
    def test_incomplete_enumeration(self): self.reject(lambda s:s['library']['scope'].update(enumerationComplete=False))
    def test_truncated(self): self.reject(lambda s:s['library']['scope'].update(truncated=True))
    def test_getter_failure(self): self.reject(lambda s:s['targetRedirection'].update(available=False))
    def test_field_failure(self): self.reject(lambda s:s['library']['references'][0]['unavailableFields'].append({'field':'name'}))
    def test_default_changed(self): self.reject(lambda s:s['library']['references'][0]['rawFields'].update(default_resolution='other'))
    def test_task_changed(self): self.reject(lambda s:s['tasks']['MainTask']['calls'].reverse())
    def test_null_not_empty(self): self.post_reject(lambda s:s['library']['references'][0]['rawFields'].update(explicit_redirection=''))
    def test_null_not_literal(self): self.post_reject(lambda s:s['library']['references'][0]['rawFields'].update(explicit_redirection='None'))
    def test_native_null_type_required(self): self.post_reject(lambda s:s['targetRedirection'].update(nativeType='unavailable'))
    def test_identity_preserved(self): self.post_reject(lambda s:s['library']['references'][0]['rawFields'].update(id='789'))
    def test_default_preserved(self): self.post_reject(lambda s:s['library']['references'][0]['rawFields'].update(default_resolution='other'))
    def test_effective_fallback(self): self.post_reject(lambda s:s['library']['references'][0]['rawFields'].update(effective_resolution='other'))
    def test_other_ref_preserved(self): self.post_reject(lambda s:s['library']['references'][1]['rawFields'].update(namespace='changed'))
    def test_source_preserved(self): self.post_reject(lambda s:s['sources'][0].update(text='changed'))
    def test_task_comment_preserved(self): self.post_reject(lambda s:s['tasks']['MainTask']['calls'][1].__setitem__(1,None))
    def test_unknown_field_preserved(self): self.post_reject(lambda s:s.update(extra='unexplained'))
    def test_exception_not_swallowed_or_replayed(self):
        plan,before=fixture();ref=FakeReference(fail=True);marks=[]
        with self.assertRaisesRegex(RuntimeError,'first native failure'):
            clear_once(ref,before,copy.deepcopy(before),plan,'disk',lambda:marks.append('dispatch'))
        self.assertEqual([None],ref.calls);self.assertEqual(['dispatch'],marks)


if __name__=='__main__': unittest.main(verbosity=2)
