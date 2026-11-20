# -*- coding: utf-8 -*-
"""Offline staged counterexamples from the published S6b and S8b observations.
Usage: python test_io_mapping_phase_guard.py <previous S8b ZIP> <S6b B.json>
The synthetic combinations below do not represent a historical persistence test.
"""
import copy
import json
import sys
import unittest
import zipfile
from pathlib import Path
import io_mapping_phase_guard as phase

def sources():
    with zipfile.ZipFile(sys.argv[1]) as z:
        before=json.loads(z.read('native/map-same-handle-prewrite-state.json'))
        mapped=json.loads(z.read('native/map-after-setter-state.json'))
        compiled=json.loads(z.read('native/map-before-save-state.json'))
    nodes=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8-sig'))['nodes']
    model=next(n for n in nodes if n['path']==['Device',phase.NAME])
    same_tree=copy.deepcopy(nodes)
    curr=next(n for n in same_tree if n['guid']==model['guid'])
    curr['guid']=next(row['guid']['value'] for row in compiled['snapshot']['devices'] if row['path']==curr['path'])
    compiled['nativeTree']=same_tree
    for state in (before,mapped):
        state['nativeTree']=[n for n in same_tree if n!=curr]
    # Apply the *recorded* empty mapping lists and getter fields to the compiled model.
    empty=copy.deepcopy(compiled)
    empty['snapshot']['channels']=before['snapshot']['channels']
    empty['export']['rows']=before['export']['rows']
    empty['snapshot']['coverage']=before['snapshot']['coverage']
    return before,empty,mapped,compiled

class Phases(unittest.TestCase):
    def setUp(self):
        self.a,self.b,self.ma,self.mb=copy.deepcopy(DATA)

    def test_empty_control_disappears_and_reappears(self):
        p=phase.control_pattern(self.a,self.b,self.a,self.b)
        self.assertEqual(('disappear','appear'),(p['reopen'],p['rebuild']))

    def test_empty_control_keeps_the_same_identity(self):
        self.assertEqual('same',phase.control_pattern(self.a,self.b,self.b,self.b)['reopen'])

    def test_only_target_mapping_on_precompiled_handle(self):
        phase.transition(self.b,self.mb,positive=True,setting=True)
        phase.transition(self.mb,self.ma,positive=True,shape='disappear',cross=True)

    def test_parent_type_position_children_and_roles(self):
        hw=phase.derived(self.b)
        for field,wrong in [('parentGuid','different'),('nativeType','different'),('index',0),('explicit',True)]:
            st=copy.deepcopy(self.b)
            next(n for n in st['nativeTree'] if n['guid']==hw)[field]=wrong
            with self.subTest(field=field),self.assertRaises(ValueError):phase.transition(self.a,st,shape='appear')
        for field in ['connector_role','interface','ownerGuid','host_path']:
            st=copy.deepcopy(self.b)
            st['snapshot']['connectors'][-1]['fields'][field]['value']='wrong'
            with self.subTest(field=field),self.assertRaises(ValueError):phase.transition(self.a,st,shape='appear')
        self.b['nativeTree'][0]['parentGuid']=hw
        with self.assertRaises(ValueError):phase.transition(self.a,self.b,shape='appear')

    def test_foreign_device_and_original_guids_remain_checked(self):
        self.b['snapshot']['devices'][1]['guid']['value']='other'
        with self.assertRaises(ValueError):phase.transition(self.a,self.b,shape='appear')

    def test_same_handle_cannot_replace_derived_guid(self):
        changed=copy.deepcopy(self.b)
        old=phase.derived(changed)
        new='12345678-1234-1234-1234-123456789abc'
        changed=json.loads(json.dumps(changed).replace(old,new))
        with self.assertRaisesRegex(ValueError,'GUID'):phase.transition(self.b,changed)

    def test_export_channels_source_and_tasks_not_exempt(self):
        for key in ('sources','tasks','sourceSnapshot'):
            st=copy.deepcopy(self.b)
            if key=='sourceSnapshot':st[key]+='x'
            elif key=='sources':st[key][0]['implementation']='changed'
            else:st[key]['unexpected']=True
            with self.subTest(key=key),self.assertRaises(ValueError):phase.transition(self.a,st,shape='appear')
        self.b['export']['rows'][1]['rawMappings']=[{}]
        with self.assertRaises(ValueError):phase.transition(self.a,self.b,shape='appear')

    def test_persisted_leaf_no_longer_last_has_no_approval(self):
        changed=copy.deepcopy(self.b)
        hw=phase.derived(self.b)
        row=next(n for n in changed['nativeTree'] if n['guid']==hw)
        siblings=[n for n in changed['nativeTree'] if n['parentGuid']==row['parentGuid']]
        displaced=siblings[-2]
        row['index'],displaced['index']=displaced['index'],row['index']
        i,j=map(changed['nativeTree'].index,(row,displaced))
        changed['nativeTree'][i],changed['nativeTree'][j]=displaced,row
        with self.assertRaises(ValueError):
            phase.transition(self.b,changed,cross=True)

    def test_unexpected_reopen_and_extra_channel_rejected(self):
        with self.assertRaises(ValueError):phase.transition(self.mb,self.ma,positive=True,cross=True,shape='same')
        self.b['snapshot']['channels'].pop()
        with self.assertRaises(ValueError):phase.transition(self.a,self.b,shape='appear')

if __name__=='__main__':
    DATA=sources()
    unittest.main(argv=[sys.argv[0]],verbosity=2)
