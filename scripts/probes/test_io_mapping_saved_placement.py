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

if __name__=='__main__':
    archive=Path(sys.argv[1])
    assert hashlib.sha256(archive.read_bytes()).hexdigest()=='3326c57ba07f6e21e38ea9d8e265d1bf8658d2e9b6c1be215b46564b6498f9a1'
    with ZipFile(archive) as z:
        STATES=[json.loads(z.read('control/'+label+'-state.json')) for label in ('control-compiled-unsaved','controlread-reopened-uncompiled')]
    unittest.main(argv=[sys.argv[0]],verbosity=2)
