"""Exercise the production native repository read under controlled doubles."""
import unittest
from pathlib import Path
from types import SimpleNamespace as Obj

probe = {'unicode': str}
path = Path('bridge/device_catalog.py')
exec(compile(path.read_text(encoding='utf8'), str(path), 'exec'), probe)


def device(version, name='Controller'):
    return Obj(device_id=Obj(type=4102, id='10f4 0002', version=version),
               device_info=Obj(name=name, vendor='原生厂商'))


class DeviceCatalog(unittest.TestCase):
    def setUp(self):
        self.sources = [Obj(name='System', is_internal=True), Obj(name='Vendor', is_internal=False)]
        self.repository = Obj(sources=self.sources, get_all_devices=self.enumerate,
                              get_device=self.lookup, create_device_identification=self.identify)
        self.reads = []
        self.detail = dict(type='4102', id='10f4 0002', deviceDescriptionVersion='1.0')

    def enumerate(self, source):
        self.reads.append(source.name)
        yield device('1.0' if source is self.sources[0] else '2.0')

    def identify(self, kind, ident, version):
        self.reads.append((kind, ident, version))
        return version

    def lookup(self, version):
        self.reads.append('exact')
        return device(version)

    def call(self, detail=None):
        return probe['device_catalog_inventory'](self.repository, detail)

    def test_per_source_with_exact_lookup(self):
        result = self.call(self.detail)
        self.assertEqual(self.reads, ['System', 'Vendor', (4102, '10f4 0002', '1.0'), 'exact'])
        self.assertEqual([r['source']['name'] for r in result['entries']], ['System', 'Vendor'])
        self.assertEqual(result['detailLookup']['fields']['deviceDescriptionVersion'], '1.0')
        self.assertFalse(result['projectOpened'])

    def test_late_source_error_preserves_rows_and_blocks_detail(self):
        def failing(source):
            yield device('1.0' if source is self.sources[0] else '2.0')
            if source is self.sources[0]:
                raise RuntimeError('partial native enumerator')
        self.repository.get_all_devices = failing
        result = self.call(self.detail)
        self.assertEqual(len(result['entries']), 2)
        self.assertEqual(result['scope']['enumerationFailures'], [dict(stage='source-devices', sourceIndex=0)])
        self.assertEqual(result['detailLookup']['status'], 'coverage-incomplete')
        self.assertNotIn('exact', self.reads)

    def test_unreadable_fields_and_missing_source_list(self):
        self.repository.get_all_devices = lambda source: iter([Obj(device_id=None, device_info=None)])
        result = self.call(self.detail)
        self.assertIn('deviceDescriptionVersion', result['entries'][0]['unavailableFields'])
        self.assertEqual(result['detailLookup']['status'], 'coverage-incomplete')
        del self.repository.sources
        self.assertEqual(self.call()['scope']['enumerationFailures'], [dict(stage='repository-sources', sourceIndex=None)])

    def test_native_capture_truncation(self):
        old_limit = probe['ENTRY_LIMIT']
        self.addCleanup(probe.__setitem__, 'ENTRY_LIMIT', old_limit)
        probe['ENTRY_LIMIT'] = 1
        result = self.call(self.detail)
        self.assertTrue(result['scope']['truncated'])
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual(result['detailLookup']['status'], 'coverage-incomplete')


if __name__ == '__main__':
    unittest.main()
