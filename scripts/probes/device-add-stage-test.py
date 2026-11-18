"""Replay the archived AM610 A/A2/B/C observations without opening a project."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from zipfile import ZipFile

from device_add_preflight import ProbeRejected, native_site
from device_add_stage_guard import PRECOMPILE, require_attachment_control, verify_stage


DIGEST = '95432d84c5918008d6726c8640fea3aa691756c73a3390373bf7646b23e955ff'
IDENTITY = dict(type='1152', id='FFFF 0001', deviceDescriptionVersion='3.5.5.0')


def load_snapshots(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != DIGEST:
        raise ValueError('Unexpected A/A2/B/C evidence archive')
    with ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError('Unreadable archive')
        return {name:json.loads(archive.read('evidence/'+name+'.json')) for name in ('A','A2','B','C')}


def observations(snapshot):
    root = snapshot['root']
    root_children = [entry['node'] for entry in snapshot['directChildren']]
    entries = [dict(node=root['node'], children=root_children, appendIndex=snapshot['appendIndex'],
                   allowedAtAppend=snapshot['allowedAtAppend']['value'], nativeMethods={'insert':'synthetic binding'},
                   observedConnectors=root['connectors']['rows'])]
    entries.extend(dict(node=entry['node'], observedConnectors=entry['connectors']['rows'])
                   for entry in snapshot['directChildren'] if entry['node']['device'])
    return entries


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.rows = load_snapshots(self.archive)
        self.controls = dict(tasks=[dict(rawCalls=[['PLC_PRG','']])], snapshot='synthetic ST fingerprint')
        upstream = dict(id=1,role='Child',interface='Common.SoftMotion.General',hostPath=-1,explicit=False)
        self.candidate = dict(identity=IDENTITY, installedMatches=[IDENTITY], module=False, compatibleChildConnectors=[upstream])
        self.catalog = dict(scope=dict(truncated=False,enumerationFailures=[]), matches=[self.candidate])
        ident = SimpleNamespace(type=IDENTITY['type'], id=IDENTITY['id'], version=IDENTITY['deviceDescriptionVersion'])
        connector = SimpleNamespace(connector_id=upstream['id'], connector_role=upstream['role'], interface=upstream['interface'],
                                    host_path=upstream['hostPath'], is_explicit=upstream['explicit'])
        description = SimpleNamespace(device_id=ident, connectors=[connector])
        self.repo = SimpleNamespace(create_device_identification=lambda *args: ident, get_device=lambda _: description)

    def plan(self, name):
        row = self.rows[name]
        parent=row['root']['node']['guid']
        return dict(stage=PRECOMPILE if not row['compileCallsInThisHandle'] else 'after-compile', name='S6bProbeDevice',
                    nodes=row['nodes'], parentGuid=parent, index=row['appendIndex'], parentConnector=row['root']['connectors']['rows'][0],
                    candidate=self.candidate, readableTasksAndST=self.controls, nativeSite=native_site(observations(row),parent))

    def verify(self, plan, name, nodes=None, placements=None, controls=None):
        row=self.rows[name]
        seed=row['mainSha256']
        return verify_stage({'file_hash':lambda _:seed},'fixture',seed,self.repo,plan,
                            PRECOMPILE if not row['compileCallsInThisHandle'] else 'after-compile',
                            row['nodes'] if nodes is None else nodes,
                            observations(row) if placements is None else placements,self.catalog,
                            self.controls if controls is None else controls,cross_open=name=='C')

    def test_a_plan_survives_same_phase_a2_and_c(self):
        plan=self.plan('A')
        self.assertEqual(self.verify(plan,'A2'),IDENTITY)
        self.assertEqual(self.verify(plan,'C'),IDENTITY)

    def test_compiled_b_plan_cannot_gate_live_c_or_be_relabeled(self):
        with self.assertRaisesRegex(ProbeRejected,'PLAN_STAGE_MISMATCH'):
            self.verify(self.plan('B'),'C')
        with self.assertRaisesRegex(ProbeRejected,'LIVE_STAGE_MISMATCH'):
            self.verify(self.plan('A'),'B')
        with self.assertRaisesRegex(ProbeRejected,'TREE_CHANGED'):
            self.verify(dict(self.plan('B'),stage=PRECOMPILE),'C')

    def test_append_index_requires_live_children_no_constant(self):
        # Synthetic untouched stage with a different root child count. The
        # guard takes the canonical count from the supplied native snapshot.
        row=deepcopy(self.rows['A'])
        for index in range(row['appendIndex'],row['appendIndex']+2):
            name='Extra ordinary node '+str(index)
            extra=dict(row['directChildren'][-1]['node'],name=name,guid='synthetic-extra-'+str(index),
                       path=['Device',name],index=index)
            row['directChildren'].append(dict(node=extra,connectors=dict(status='not-a-device-or-connector')))
            row['nodes'].append(extra)
        row['appendIndex']=len(row['directChildren'])
        self.rows['A']=row
        plan=self.plan('A')
        self.assertEqual(self.verify(plan,'A'),IDENTITY)
        with self.assertRaisesRegex(ProbeRejected,'POSITION_OCCUPIED_OR_UNCONFIRMED'):
            self.verify(dict(plan,index=plan['index']+1),'A')

    def test_same_stage_rejects_device_missing_added_or_reordered(self):
        row=self.rows['A2']; plan=self.plan('A'); root=plan['parentGuid']
        slots=[i for i,node in enumerate(row['nodes']) if node['parentGuid']==root and node['device']]
        for change in ('missing','added','reordered'):
            with self.subTest(change=change), self.assertRaisesRegex(ProbeRejected,'TREE_CHANGED'):
                nodes=deepcopy(row['nodes'])
                a,b=slots[:2]
                if change=='missing':
                    del nodes[a]
                elif change=='added':
                    nodes.append(dict(nodes[a], guid='another-device', name='AnotherDevice'))
                else:
                    nodes[a],nodes[b]=nodes[b],nodes[a]
                self.verify(plan,'A2',nodes=nodes)

    def test_same_stage_keeps_exact_connector_and_occupancy_guards(self):
        plan=self.plan('A')
        layout=deepcopy(observations(self.rows['A2']))
        layout[0]['observedConnectors'][0]['id']+=1
        with self.assertRaisesRegex(ProbeRejected,'PARENT_INCOMPATIBLE'):
            self.verify(plan,'A2',placements=layout)
        layout=deepcopy(observations(self.rows['A2']))
        next(c for c in layout[1]['observedConnectors'] if c['role']=='Child')['interface']=plan['parentConnector']['interface']
        with self.assertRaisesRegex(ProbeRejected,'POSITION_OCCUPIED_OR_UNCONFIRMED'):
            self.verify(plan,'A2',placements=layout)

    def test_task_and_st_remain_exact_and_attachment_control_is_mandatory(self):
        for key,value in [('tasks',[]),('snapshot','changed')]:
            with self.assertRaisesRegex(ProbeRejected,'TASK_OR_ST_CHANGED'):
                self.verify(self.plan('A'),'A2',controls=dict(self.controls,**{key:value}))
        with self.assertRaisesRegex(ProbeRejected,'PARENT_CONNECTOR_READBACK_UNPROVEN'):
            require_attachment_control([dict(status='interface-compatible-only')])


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('archive',type=Path)
    ArchiveTests.archive=parser.parse_args().archive
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ArchiveTests))
    raise SystemExit(0 if result.wasSuccessful() else 1)
