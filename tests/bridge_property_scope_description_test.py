"""Current production search descriptions with object substitutes, not IDE proof."""
import unittest
import bridge_properties_test as fixtures

class ScopeDescriptions(unittest.TestCase):
    def inventory(self, writable=False, unsupported=False):
        x=fixtures.Properties();x.setUp()
        if writable:x.args.update(propertyMode='read-write',setDeclaration='VAR\nEND_VAR',setImplementation='State := CurrentState;')
        created,p=x.create();self.assertEqual(created['status'],'succeeded',created)
        if unsupported:
            prop=next(n for n in x.e['walk'](p) if str(n[0].guid).lower()==created['data']['objectId'])[0]
            prop.children[0].embedded_object_types=[]
        return x.e['search_inventory'](p,dict(projectId='scope-description-test',applicationId=x.app.guid)),created['data']

    def assert_scope(self,r):
        self.assertEqual(r['scope']['propertyCoverageVersion'],'fb-properties-v2')
        self.assertIn('read-only Property/Get',r['scope']['description'])
        self.assertIn('read-write Property/Get/Set',r['scope']['description'])
        self.assertIn('native accessor structure evidence',r['scope']['description'])

    def test_readonly_description_and_get_only_results(self):
        r,p=self.inventory();self.assert_scope(r)
        kinds=[x['objectType'] for x in r['corpus']]
        self.assertIn('property_get',kinds);self.assertNotIn('property_set',kinds)

    def test_writable_description_and_independent_get_set_results(self):
        r,p=self.inventory(writable=True);self.assert_scope(r)
        rows={x['objectId']:x['objectType'] for x in r['corpus']}
        self.assertEqual(rows[p['getter']['objectId']],'property_get')
        self.assertEqual(rows[p['setter']['objectId']],'property_set')

    def test_unsupported_structure_is_a_gap_not_a_readonly_only_claim(self):
        r,p=self.inventory(writable=True,unsupported=True);self.assert_scope(r)
        self.assertFalse(r['scope']['coverageComplete'])
        gaps=r['scope']['unsupportedChildren'];self.assertTrue(gaps)
        for gap in gaps:
            self.assertIn('read-only Property/Get or read-write Property/Get/Set',gap['reason'])
            self.assertIn('existing accessors are never changed',gap['reason'])

if __name__=='__main__':unittest.main()
