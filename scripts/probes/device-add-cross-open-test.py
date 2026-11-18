"""Replay the two archived reads without opening either fixture."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from zipfile import ZipFile

from device_add_preflight import (ProbeRejected, STYLE_NAME, rejection, style_leaf,
                                  tree_difference, verify_preflight, verify_saved_tree)


ARCHIVE_SHA256 = 'bb0210333e8d965ce05920963137d8e048b14cbef3d1d9ba6a48d513a7f6fbab'


def archived(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Unexpected original review ZIP')
    with ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError('Original review ZIP is unreadable')
        plan = json.loads(archive.read('evidence/plan.json'))
        second = json.loads(archive.read('evidence/recheck-result.json'))
    completed = {event['step']:event['evidence'] for event in second['events'] if event['state']=='completed'}
    return plan, second['primaryFailure'], completed


class RepositoryDouble:
    def create_device_identification(self, type_id, device_id, version):
        return SimpleNamespace(type=type_id,id=device_id,version=version)

    def get_device(self, key):
        raise AssertionError('Rejected evidence reached native exact lookup')


class ArchiveGuardTests(unittest.TestCase):
    def setUp(self):
        self.plan, self.failure, observations = archived(self.archive)
        self.nodes = observations['native-tree']
        self.parents = observations['native-parents-and-append-indexes']
        self.repo = observations['directory-identities']
        self.controls = dict(tasks=observations['readable-task-settings'],snapshot=observations['readable-st-snapshot'])
        self.style = style_leaf(self.nodes)
        self.parent = next(i for i,row in enumerate(self.nodes) if row['guid']==self.plan['parentGuid'])

    def check_tree_rejects(self, replacement):
        self.assertEqual(rejection(self.plan,replacement,self.parents,self.repo,cross_open=True),'TREE_CHANGED')
        with self.assertRaisesRegex(ProbeRejected,'SAVED_TREE_CHANGED'):
            verify_saved_tree(self.plan['nodes'],replacement)

    def test_original_rejection_preserved_but_cross_open_replay_passes(self):
        self.assertEqual(self.failure['error']['code'],'TREE_CHANGED')
        self.assertEqual(rejection(self.plan,self.nodes,self.parents,self.repo),'TREE_CHANGED')
        self.assertNotEqual(self.plan['nodes'][self.style]['guid'],self.nodes[self.style]['guid'])
        self.assertIsNone(rejection(self.plan,self.nodes,self.parents,self.repo,cross_open=True))
        self.assertIsNotNone(tree_difference(self.plan['nodes'],self.nodes,cross_open=False,task_proxy_rule=False))
        verify_saved_tree(self.plan['nodes'],self.nodes)

    def test_style_exemption_refuses_duplicates_types_positions_children_and_collisions(self):
        for change in ('duplicate','type','move','position','child','field','guid-conflict'):
            with self.subTest(change=change):
                actual=deepcopy(self.nodes)
                style=actual[self.style]
                if change=='duplicate':
                    actual.append(dict(style,guid='duplicate',name=STYLE_NAME.lower(),path=['Device',STYLE_NAME.lower()]))
                elif change=='type':
                    style['nativeType']='different'
                elif change=='move':
                    style.update(parentGuid=self.plan['parentGuid'],path=['Device',STYLE_NAME])
                elif change=='position':
                    style['index']+=1
                elif change=='child':
                    actual.append(dict(style,guid='child',name='child',parentGuid=style['guid'],path=[STYLE_NAME,'child']))
                elif change=='field':
                    style['explicit']=True
                elif change=='guid-conflict':
                    style['guid']=actual[self.parent]['guid']
                self.check_tree_rejects(actual)

    def test_original_parent_and_sibling_order_remain_exact(self):
        changed=deepcopy(self.nodes)
        changed[self.parent]['guid']='changed-parent-guid'
        self.check_tree_rejects(changed)
        changed=deepcopy(self.nodes)
        siblings=[i for i,row in enumerate(changed) if row['parentGuid']==self.plan['parentGuid']]
        left,right=siblings[:2]
        changed[left],changed[right]=changed[right],changed[left]
        self.check_tree_rejects(changed)

    def test_connector_and_occupancy_remain_guards_with_unchanged_tree(self):
        parents=deepcopy(self.parents)
        target=next(row for row in parents if row['node']['guid']==self.plan['parentGuid'])
        target['observedConnectors']=[]
        self.assertEqual(rejection(self.plan,self.nodes,parents,self.repo,cross_open=True),'PARENT_INCOMPATIBLE')
        parents=deepcopy(self.parents)
        target=next(row for row in parents if row['node']['guid']==self.plan['parentGuid'])
        child=next(child for child in target['children'] if child['device'])
        child_observation=next(row for row in parents if row['node']['guid']==child['guid'])
        upstream=next(row for row in child_observation['observedConnectors'] if row['role']=='Child')
        upstream['interface']=self.plan['parentConnector']['interface']
        self.assertEqual(rejection(self.plan,self.nodes,parents,self.repo,cross_open=True),'POSITION_OCCUPIED_OR_UNCONFIRMED')

    def test_task_call_and_st_changes_reject_before_native_lookup(self):
        for key in ('tasks','snapshot'):
            with self.subTest(key=key):
                actual=deepcopy(self.controls)
                if key=='tasks':
                    actual['tasks'][0]['tasks'][0]['rawCalls'][0][0]='ChangedProgram'
                else:
                    actual['snapshot']=hashlib.sha256(b'changed ST').hexdigest()
                with self.assertRaisesRegex(ProbeRejected,'TASK_OR_ST_CHANGED'):
                    verify_preflight({'file_hash':lambda path:self.plan['mainSha256']},'fixture',self.plan['mainSha256'],
                                     RepositoryDouble(),self.plan,self.nodes,self.parents,self.repo,actual,cross_open=True)

    def test_save_reopen_never_normalizes_added_device_guid_identity_or_parent(self):
        added=dict(guid='inserted-guid',nativeType=self.nodes[self.parent]['nativeType'],name=self.plan['name'],
                   device=True,explicit=False,path=self.nodes[self.parent]['path']+[self.plan['name']],
                   parentGuid=self.plan['parentGuid'],index=self.plan['index'],identity=self.plan['candidate']['identity'])
        before=self.plan['nodes']+[added]
        after=self.nodes+[added]
        verify_saved_tree(before,after)
        for key,value in (('guid','foreign-device'),('identity',None),('parentGuid',None),('index',0)):
            with self.subTest(key=key), self.assertRaisesRegex(ProbeRejected,'SAVED_TREE_CHANGED'):
                verify_saved_tree(before,self.nodes+[dict(added,**{key:value})])


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('archive',type=Path)
    parser.add_argument('--evidence',type=Path)
    args=parser.parse_args()
    ArchiveGuardTests.archive=args.archive
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ArchiveGuardTests))
    if args.evidence and result.wasSuccessful():
        plan,failure,events=archived(args.archive)
        second=events['native-tree']
        evidence=dict(archiveSha256=ARCHIVE_SHA256,originalRejection=failure,
                      originalTrees=[plan['nodes'],second],savedTreeComparison='match',
                      crossOpenRejection=rejection(plan,second,events['native-parents-and-append-indexes'],
                                                   events['directory-identities'],cross_open=True),
                      exactLookupOnOldSecondOpen='not reached')
        with args.evidence.open('x',encoding='utf-8') as output:
            json.dump(evidence,output,indent=2,ensure_ascii=False)
    raise SystemExit(0 if result.wasSuccessful() else 1)
