# -*- coding: utf-8 -*-
"""Offline observer doubles plus unchanged production rejection regressions."""
import copy
import importlib.util
import os
import sys
import tempfile
import unittest
from unittest import mock
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('save_observer', os.path.join(ROOT, 'scripts', 'diagnostics', 'resident_save_observer.py'))
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)
sys.path.insert(0, os.path.join(ROOT, 'tests'))
from test_resident_core import Native, APP, OBJ, c


class Value(object):
    def __init__(self, **values):
        self.__dict__.update(values)


class CoreImportTests(unittest.TestCase):
    def setUp(self):
        self.assembly = Value(Location='verified/Core.dll', GetName=lambda: Value(Name='Core'))
        self.assemblies = [self.assembly]
        self.instances = object()
        self.references = []
        self.clr = types.ModuleType('clr')
        self.clr.AddReference = self.references.append
        self.clr.GetClrType = lambda value: Value(Assembly=self.assembly)
        system = types.ModuleType('System')
        system.AppDomain = Value(CurrentDomain=Value(GetAssemblies=lambda: self.assemblies))
        core = types.ModuleType('_3S.CoDeSys.Core')
        core.SystemInstances = self.instances
        self.modules = mock.patch.dict(sys.modules, {'clr':self.clr, 'System':system,
            '_3S':types.ModuleType('_3S'), '_3S.CoDeSys':types.ModuleType('_3S.CoDeSys'), '_3S.CoDeSys.Core':core})
        self.modules.start()
        self.hash = mock.patch.object(o, 'file_hash', return_value=o.CORE_SHA256)
        self.hash.start()
        self.addCleanup(self.modules.stop)
        self.addCleanup(self.hash.stop)

    def test_registers_exact_verified_loaded_assembly(self):
        self.assertIs(o.load_public_system_instances(), self.instances)
        self.assertEqual(self.references, [self.assembly])

    def test_missing_or_duplicate_core_stops_before_registration(self):
        for assemblies in [[], [self.assembly, self.assembly]]:
            self.assemblies = assemblies
            with self.assertRaisesRegex(ValueError, 'Unverified'):
                o.load_public_system_instances()
            self.assertEqual(self.references, [])

    def test_changed_core_stops_before_registration(self):
        with mock.patch.object(o, 'file_hash', return_value='0' * 64):
            with self.assertRaisesRegex(ValueError, 'Unverified'):
                o.load_public_system_instances()
        self.assertEqual(self.references, [])

    def test_reference_failure_keeps_first_exception(self):
        first = RuntimeError('registration failed')
        self.clr.AddReference = mock.Mock(side_effect=first)
        with self.assertRaises(RuntimeError) as caught:
            o.load_public_system_instances()
        self.assertIs(caught.exception, first)

    def test_import_failure_is_not_ignored(self):
        del sys.modules['_3S.CoDeSys.Core'].SystemInstances
        with self.assertRaises(ImportError):
            o.load_public_system_instances()

    def test_public_type_from_different_assembly_is_rejected(self):
        self.clr.GetClrType = lambda value: Value(Assembly=object())
        with self.assertRaisesRegex(ValueError, 'another assembly'):
            o.load_public_system_instances()


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.rows = []
        self.fallback = []
        self.observer = o.Observer(dict(launchId='offline', pid=1, startId='1'),
            lambda: dict(projectHandle=0, diskHash='a' * 64, dirty=False),
            lambda name, row: self.rows.append((name, copy.deepcopy(row))),
            lambda error: self.fallback.append(error), lambda: 'offline-time')

    def test_event_order_is_raw_and_never_write_authorization(self):
        for event in ['command-executing', 'project-saving', 'project-saved', 'command-executed']:
            self.observer.record(event, lambda: dict(diskHash='b' * 64))
        self.assertEqual([r['event'] for _, r in self.rows], ['command-executing', 'project-saving', 'project-saved', 'command-executed'])
        self.assertTrue(all(r['writeAuthorized'] is False for _, r in self.rows))

    def test_null_empty_and_literal_none_are_not_coalesced(self):
        self.assertEqual(o.field(lambda: None), dict(state='null', value=None))
        self.assertEqual(o.field(lambda: ''), dict(state='value', value=''))
        self.assertEqual(o.field(lambda: 'None'), dict(state='value', value='None'))

    def test_missing_or_failed_field_is_not_false(self):
        row = o.field(lambda: Value().missing)
        self.assertEqual(row['state'], 'error')
        self.assertNotIn('value', row)

    def test_cancel_and_exception_are_retained(self):
        t = Value(FullName='Command', Assembly=Value(FullName='Assembly'))
        a = Value(CommandGuid='guid', Command=Value(GetType=lambda: t),
                  Exception=Value(GetType=lambda: Value(FullName='Failure'), Message='first'), ExcecutionCancelled=True)
        r = self.observer.command_event('command-executed', a)
        self.assertEqual(r['details']['exception']['value']['message'], 'first')
        self.assertEqual(r['details']['cancelled']['value'], True)
        self.assertEqual(r['writeAuthorized'], False)

    def test_stream_is_observed_without_read_seek_flush_or_dispose(self):
        class Stream(object):
            CanRead = True
            CanSeek = True
            Position = 17
            Length = 20
            def GetType(self): return Value(FullName='MemoryStream')
            def Read(self, *args): raise AssertionError('no stream consumption')
            def Seek(self, *args): raise AssertionError('no stream mutation')
            def Flush(self): raise AssertionError('no flush')
            def Dispose(self): raise AssertionError('not owned')
        stream = Stream()
        r = self.observer.project_event('project-saved', Value(Stream=stream, ProjectHandle=0, StreamName='owned.project', WorkingFolder='work'))
        self.assertEqual(r['details']['stream']['position']['value'], '17')
        self.assertEqual(stream.Position, 17)

    def test_owner_mismatch_stops_recording_and_keeps_first_error(self):
        def fail(): raise ValueError('wrong handle')
        self.observer.owner = fail
        self.assertIsNone(self.observer.record('first', lambda: {}))
        self.assertIsNone(self.observer.record('second', lambda: {}))
        self.assertEqual(self.observer.first_error['event'], 'first')
        self.assertEqual(self.rows, [])

    def test_evidence_failure_does_not_escape_into_native_save(self):
        def fail(*args): raise IOError('publish failed')
        self.observer.publish = fail
        self.observer.fallback = fail
        self.assertIsNone(self.observer.record('project-saved', lambda: {}))
        self.assertEqual(self.observer.first_error['message'], 'publish failed')
        self.assertEqual(len(self.observer.secondary_errors), 1)

    def test_property_error_is_preserved_not_a_success_signal(self):
        r = self.observer.command_event('command-executed', Value())
        self.assertEqual(r['details']['cancelled']['state'], 'error')
        self.assertFalse(r['writeAuthorized'])
        self.assertFalse(r['complete'])
        self.assertIsNotNone(self.observer.first_error)

    def test_memory_read_occurs_only_after_command_not_during_stream_save(self):
        calls = []
        self.observer.after_command = lambda: calls.append('read') or dict(implementation='// marker')
        self.observer.command_event('command-executing', Value())
        self.assertEqual(calls, [])
        r = self.observer.command_event('command-executed', Value())
        self.assertEqual(calls, ['read'])
        self.assertEqual(r['details']['memory']['value']['implementation'], '// marker')

    def test_after_command_memory_failure_is_an_explicit_gap(self):
        def fail(): raise ValueError('source unavailable')
        self.observer.after_command = fail
        r = self.observer.command_event('command-executed', Value())
        self.assertEqual(r['details']['memory']['state'], 'error')
        self.assertFalse(r['writeAuthorized'])


class ProductionProtectionTests(unittest.TestCase):
    def setup_session(self):
        native = Native()
        disk = ['a' * 64]
        records = {}
        session = c.ResidentSession(native, lambda: disk[0], lambda n, v: records.update({n:copy.deepcopy(v)}), lambda: None)
        req = dict(command='read', args=dict(applicationId=APP, objectId=OBJ), operationId='read', requestId='read', directory='offline')
        result = session.handle(req)
        self.assertEqual(result['status'], 'succeeded')
        return native, disk, session, result['data']

    def test_dirty_false_and_new_disk_are_still_rejected_in_production(self):
        native, disk, session, old = self.setup_session()
        native.dirty = False
        disk[0] = 'b' * 64
        r = session.handle(dict(command='read', args=dict(applicationId=APP,objectId=OBJ), operationId='next', requestId='next', directory='offline'))
        self.assertEqual(r['status'], 'conflict')
        self.assertEqual(native.writes, 0)
        self.assertEqual(native.saves, 0)

    def test_old_request_does_not_bypass_disk_change(self):
        native, disk, session, old = self.setup_session()
        disk[0] = 'b' * 64
        r = session.handle(dict(command='change', args=dict(applicationId=APP,objectId=OBJ,
            expectedHash=old['contentHash'], expectedResidentVersion=old['residentVersion'],
            declaration=old['declaration'], implementation='x := 2;'), operationId='change', requestId='change', directory='offline'))
        self.assertEqual(r['status'], 'conflict')
        self.assertEqual(native.writes, 0)
        self.assertEqual(native.saves, 0)


class FixedEntryTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('save_probe_entry', os.path.join(ROOT, 'scripts', 'diagnostics', 'resident_save_probe_entry.py'))
        self.entry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.entry)

    def test_fixed_namespace_is_shared_between_helper_functions(self):
        raw = b'number=7\ndef first(): return number\ndef second(): return first()\n'
        with tempfile.TemporaryDirectory() as root:
            p = os.path.join(root, 'fixed.py')
            with open(p, 'wb') as f: f.write(raw)
            loaded = self.entry.load_fixed(p, o.hashlib.sha256(raw).hexdigest(), 'fixed')
            self.assertEqual(loaded['second'](), 7)
            self.assertEqual(loaded['__file__'], p)

    def test_changed_fingerprint_rejects_before_fixed_body_execution(self):
        with tempfile.TemporaryDirectory() as root:
            p = os.path.join(root, 'fixed.py')
            with open(p, 'wb') as f: f.write(b'raise AssertionError("must not execute")\n')
            with self.assertRaisesRegex(ValueError, 'dependency changed'):
                self.entry.load_fixed(p, '0' * 64, 'changed')

    def test_load_failure_keeps_original_exception(self):
        raw = b'raise ValueError("first load error")\n'
        with tempfile.TemporaryDirectory() as root:
            p = os.path.join(root, 'fixed.py')
            with open(p, 'wb') as f: f.write(raw)
            with self.assertRaisesRegex(ValueError, 'first load error'):
                self.entry.load_fixed(p, o.hashlib.sha256(raw).hexdigest(), 'fixed')


if __name__ == '__main__':
    unittest.main()
