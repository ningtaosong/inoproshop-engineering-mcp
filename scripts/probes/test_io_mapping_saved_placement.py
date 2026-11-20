"""Offline counterexamples derived from the original control's raw B and C."""
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path
from zipfile import ZipFile
from io_mapping_phase_guard import transition, derived, reopen_shape, NAME

def compare(b,c):
    transition(b,c,cross=True,shape='saved-placement')

class SavedPlacement(unittest.TestCase):
    def setUp(self):
        self.b,self.c=copy.deepcopy(STATES)
        self.guid=derived(self.b)
        self.leaf=next(n for n in self.c['nativeTree'] if n['guid']==self.guid)

    def test_original_states_and_nonmutation(self):
        original=copy.deepcopy((self.b,self.c))
        self.assertEqual((8,6),tuple(next(n['index'] for n in s['nativeTree'] if n['name']==NAME) for s in original))
        self.assertEqual(reopen_shape(self.b,self.c),'saved-placement')
        compare(self.b,self.c)
        self.assertEqual(original,(self.b,self.c))

    def test_same_handle_and_write_transitions_reject(self):
        for kwargs in ({},{'cross':True},{'shape':'saved-placement'},{'shape':'saved-placement','cross':True,'setting':True}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):
                transition(self.b,self.c,**kwargs)

    def test_changed_guid_in_all_views(self):
        c=json.loads(json.dumps(self.c).replace(self.guid,'12345678-1234-4234-8234-123456789abc'))
        with self.assertRaises(ValueError):compare(self.b,c)

    def test_wrong_parent_description_or_native_type(self):
        for k,v in [('parentGuid','other'),('nativeType','other'),('identity',{})]:
            c=copy.deepcopy(self.c);next(n for n in c['nativeTree'] if n['guid']==self.guid)[k]=v
            with self.subTest(key=k),self.assertRaises((ValueError,KeyError)):compare(self.b,c)

    def test_connector_role_owner_or_export(self):
        for kind in ('ownerGuid','connector_role','export'):
            c=copy.deepcopy(self.c)
            if kind=='export':next(n for n in c['export']['devices'] if n['guid']==self.guid)['connectorHandling']=[]
            else:next(n for n in c['snapshot']['connectors'] if n['enumeratedFromDeviceGuid']==self.guid)['fields'][kind]['value']='other'
            with self.subTest(field=kind),self.assertRaises(ValueError):compare(self.b,c)

    def test_distinct_sibling_reordered_with_consistent_indices(self):
        tree=self.c['nativeTree']
        siblings=[n for n in tree if n['parentGuid']==self.leaf['parentGuid']]
        a,b=siblings[7:9]
        i,j=map(tree.index,(a,b))
        tree[i],tree[j]=b,a
        a['index'],b['index']=b['index'],a['index']
        with self.assertRaises(ValueError):compare(self.b,self.c)

    def test_extra_node_or_changed_sibling_content(self):
        c=copy.deepcopy(self.c);c['nativeTree'].append(dict(self.leaf,guid='extra',parentGuid='unrelated',name='extra'))
        with self.assertRaises(ValueError):compare(self.b,c)
        self.c['nativeTree'][1]['nativeType']='other'
        with self.assertRaises(ValueError):compare(self.b,self.c)

    def test_incomplete_coverage_or_unrelated_channel_change(self):
        for kind in ('incomplete','scans','count','field','mapping','export'):
            c=copy.deepcopy(self.c);snap=c['snapshot']
            if kind=='incomplete':snap['coverage']['enumerationComplete']=False
            if kind=='scans':snap['scans']=[]
            if kind=='count':snap['coverage']['observedMappableRows']=25
            if kind=='field':snap['channels'][1]['element']['unit']={'state':'value','value':'unexpected'}
            if kind=='mapping':snap['channels'][1]['mapping']['default_variable']={'state':'value','value':''}
            if kind=='export':c['export']['rows'][1]['rawMappings']=[{'variable':'other'}]
            with self.subTest(kind=kind),self.assertRaises(ValueError):compare(self.b,c)

class MappedPlacement(unittest.TestCase):
    def setUp(self):
        self.before,self.after=copy.deepcopy(MAPPED)

    def check(self,after):
        transition(self.before,after,positive=True,cross=True,shape='saved-placement')

    def test_mapped_archive_and_round_trip(self):
        before,after=copy.deepcopy((self.before,self.after))
        gid=derived(before)
        self.assertEqual([8,5],[next(n['index'] for n in s['nativeTree'] if n['guid']==gid) for s in (before,after)])
        self.check(after)
        transition(after,before,positive=True,cross=True,shape='saved-placement')
        self.check(before)
        self.assertEqual((self.before,self.after),(before,after))
        with self.assertRaises(ValueError):
            transition(before,after,positive=True)

    def test_unordered_views_remain_strict_within_handle(self):
        changed=copy.deepcopy(self.before)
        changed['snapshot']['connectors'].reverse()
        self.check(changed)
        with self.assertRaises(ValueError):
            transition(self.before,changed,positive=True)

    def test_missing_or_duplicate_observations(self):
        for section,field in [('snapshot','devices'),('snapshot','connectors'),('export','devices'),('snapshot','scans')]:
            for how in ('missing','duplicate'):
                changed=copy.deepcopy(self.after)
                rows=changed[section][field]
                if how=='missing':rows.pop()
                else:rows.append(copy.deepcopy(rows[0]))
                with self.subTest(section=section,field=field,how=how),self.assertRaises(ValueError):
                    self.check(changed)

    def test_connector_reassigned_and_incomplete_handling(self):
        c=self.after['snapshot']['connectors'][0]
        c['enumeratedFromDeviceGuid']='other'
        with self.assertRaises(ValueError):self.check(self.after)
        changed=copy.deepcopy(self.before)
        dev=next(d for d in changed['export']['devices'] if d['connectorHandling'])
        dev['connectorHandling'].pop()
        with self.assertRaises(ValueError):self.check(changed)

    def test_bad_ordinals_outside_moved_leaf(self):
        for value in (0,-1,8,True):
            changed=copy.deepcopy(self.after)
            row=next(n for n in changed['nativeTree'] if n['index']==1 and len(n['path'])>2)
            row['index']=value
            with self.subTest(value=value),self.assertRaises(ValueError):self.check(changed)

    def test_changed_subtree_source_task_or_mapping(self):
        for which in ('tree','source','task','mapping'):
            changed=copy.deepcopy(self.after)
            if which=='tree':
                row=next(n for n in changed['nativeTree'] if len(n['path'])>2 and not n['device'])
                row['explicit']=not row['explicit']
            elif which=='source':changed['sources'].pop()
            elif which=='task':changed['tasks']['tasks'].pop()
            else:next(row for row in changed['export']['rows'] if row['rawMappings'])['rawMappings'].clear()
            with self.subTest(which=which),self.assertRaises(ValueError):self.check(changed)

if __name__=='__main__':
    archive=Path(sys.argv[1])
    assert hashlib.sha256(archive.read_bytes()).hexdigest()=='3326c57ba07f6e21e38ea9d8e265d1bf8658d2e9b6c1be215b46564b6498f9a1'
    with ZipFile(archive) as z:
        STATES=[json.loads(z.read('control/'+label+'-state.json')) for label in ('control-compiled-unsaved','controlread-reopened-uncompiled')]
    mapped=Path(sys.argv[2]) if len(sys.argv)>2 else archive.with_name('InoPro-review-20261120-094734.zip')
    assert hashlib.sha256(mapped.read_bytes()).hexdigest()=='75fbe4f6c15a8000fceec1d98c3814efa02864342c28db164b5c7d07864f1b77'
    with ZipFile(mapped) as z:
        MAPPED=[json.loads(z.read('mapping/'+label+'-state.json')) for label in ('mapping-before-save','mappedread-saved-reopen')]
    unittest.main(argv=[sys.argv[0]],verbosity=2)
