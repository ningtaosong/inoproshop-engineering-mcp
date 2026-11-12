"""Production set-type partial-write behavior with native API substitutes, not an IDE test."""
import unittest
from types import SimpleNamespace

import bridge_pou_test as fixtures


class VariableTypePartialWrite(unittest.TestCase):
    def run_failure(self, mode, stage, cleanup_error=False):
        f = fixtures.BridgeCreation('test_real_function_saves_reopens_and_verifies_new_guid')
        f.setUp()
        f.manager.primary = None
        original_open = f.manager.open
        calls = {'open': 0, 'declaration': 0, 'implementation': 0,
                 'save': 0, 'close': 0, 'checkpoint': 0}
        initial = f.app.children[0]
        before = f.env['read_object'](initial, ['Application', 'PLC_PRG'], f.app.guid)
        original_read = f.env['read_object']
        reads = [0]

        def read(*args):
            reads[0] += 1
            if stage == 'readback' and reads[0] == 2:
                raise RuntimeError('original readback failure')
            result = original_read(*args)
            if stage == 'mismatch' and reads[0] == 2:
                return dict(result, contentHash='0' * 64)
            return result

        def opened(path, primary):
            calls['open'] += 1
            if stage == 'reopen' and calls['open'] == 2:
                raise RuntimeError('original reopen failure')
            project = original_open(path, primary)
            project.path = path
            target = project.children[0].children[0]
            original_declaration = target.textual_declaration.replace
            original_implementation = target.textual_implementation.replace

            def declaration(value):
                calls['declaration'] += 1
                original_declaration(value)
                if stage == 'declaration':
                    raise RuntimeError('original declaration failure after mutation')

            def implementation(value):
                calls['implementation'] += 1
                if stage == 'implementation':
                    raise RuntimeError('original implementation failure')
                original_implementation(value)
                if stage == 'implementation_after':
                    raise RuntimeError('original implementation_after failure')

            def save():
                calls['save'] += 1
                if stage == 'save':
                    raise RuntimeError('original save failure')
                project.manager.saved = [x.dump() for x in project.children]

            def close():
                calls['close'] += 1
                if cleanup_error:
                    raise RuntimeError('final cleanup failure')

            target.textual_declaration.replace = declaration
            target.textual_implementation.replace = implementation
            project.save = save
            project.close = close
            return project

        f.manager.open = opened
        f.env.update(read_object=read,
                     shutil=SimpleNamespace(copyfile=lambda *a: calls.__setitem__('checkpoint', calls['checkpoint'] + 1)),
                     file_hash=lambda path: 'disk-version',
                     direct_file_guard=lambda req, state: {'beforeDiskHash': 'disk-version'} if req.get('fileGuard') else None)
        req = dict(f.req, command='change', args=dict(
            applicationId=f.app.guid, objectId=initial.guid,
            expectedHash=before['contentHash'],
            expectedSnapshot=f.env['snapshot'](f.project),
            expectedDiskHash='disk-version', variableEdit=True,
            action='set-type', declaration=before['declaration'] + '\n// changed type',
            implementation=before['implementation']))
        if mode == 'direct':
            req['fileGuard'] = {'mode': 'direct', 'expectedDiskHash': 'disk-version'}
        result = f.env['dispatch'](req)
        if cleanup_error:
            self.assertEqual(result['error']['code'], 'CLOSE_FAILED')
            self.assertEqual(result['data']['priorResult']['error']['code'], 'PARTIAL_WRITE')
            self.assertIn('final cleanup failure', result['data']['cleanupException']['message'])
            partial = result['data']['priorResult']
        else:
            partial = result
        self.assertEqual(partial['status'], 'unknown', (mode, stage, result))
        self.assertEqual(partial['error']['code'], 'PARTIAL_WRITE')
        self.assertIn('Write readback does not match' if stage == 'mismatch' else 'original ' + stage + ' failure',
                      partial['data']['primaryException']['message'])
        self.assertEqual(partial['data']['recovery']['status'], 'unknown')
        self.assertEqual(calls['checkpoint'], 1)
        self.assertEqual(calls['declaration'], 1, calls)
        self.assertLessEqual(calls['implementation'], 1, calls)
        self.assertEqual(calls['save'], 1 if stage in ('save', 'reopen') else 0, calls)
        self.assertEqual(calls['open'], 2 if stage == 'reopen' else 1, calls)
        self.assertFalse(any(x['stage'].startswith('recovery-') for x in result['data']['lifecycle']['events']))
        return result, calls

    def test_direct_and_old_copy_preserve_partial_write_at_each_failure(self):
        for mode in ('direct', 'copy'):
            for stage in ('declaration', 'implementation', 'implementation_after', 'readback', 'mismatch', 'save', 'reopen'):
                with self.subTest(mode=mode, stage=stage):
                    self.run_failure(mode, stage)

    def test_cleanup_error_preserves_original_partial_write_error(self):
        self.run_failure('copy', 'implementation', cleanup_error=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
