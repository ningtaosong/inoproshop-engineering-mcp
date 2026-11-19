# -*- coding: utf-8 -*-
"""Synthetic inputs to the same collector as the native probe. No IDE or project files."""
import unittest
from io_mapping_read import binding_key, snapshot, val


class Obj:
    def __init__(self, **fields):
        self.__dict__.update(fields)


class Element(Obj):
    def __iter__(self):
        return iter(self.elements)


def make_field(identifier, **options):
    unmapped = Obj(Id=-1, variable=None, default_variable=None, maps_to_existing_variable=True,
                   mapping_creates_variable=False, automatic_iec_address=True, manual_iec_address="")
    data = dict(identifier=identifier, visible_name=identifier, is_mappable_io=True, has_sub_elements=False,
                bit_size=1, base_type="Boolean", unit="", io_mapping=unmapped)
    data.update(options)
    return Element(**data)


def fixture(children=None):
    children = [make_field("A"), make_field("B")] if children is None else children
    dev = Obj(guid="D1", is_device=True, get_name=lambda: "Device", get_children=lambda recursive: [],
              get_device_identification=lambda: Obj(type=4102, id="test", version="v"))
    p = make_field("parent", id=115, name="Parameter", type_string="X", iec_type="X", param_type="PT",
                   channel_type="Input", has_sub_elements=True, elements=children,
                   get_device_object=lambda: dev, is_mappable_io=False)
    c = Obj(connector_id=2, interface="demo", interface_name="demo", connector_role="Parent", host_path=1,
            host_parameters=[p], get_device_object=lambda: dev)
    dev.device_parameters, dev.connectors = [], [c]
    return Obj(get_children=lambda recursive: [dev])


class Tests(unittest.TestCase):
    def test_boxed_64bit_integers_are_read_losslessly_without_accepting_text_as_ids(self):
        class Box:
            def __init__(self, type_name, spelling):
                self.type_name, self.spelling = type_name, spelling
            def GetType(self):
                return Obj(FullName=self.type_name)
            def __str__(self):
                return self.spelling
        for typ, text in (("System.Int64", "-1"), ("System.UInt64", "18446744073709551615")):
            obs=val(lambda: Box(typ,text))
            self.assertEqual(obs, {"state":"value","value":int(text),"nativeType":typ})
        self.assertEqual(val(lambda: Box("System.Custom", "1"))["state"],"error")

    def test_same_display_names_stay_distinct_by_scoped_identity(self):
        data=snapshot(fixture([make_field("A",visible_name="same"),make_field("B",visible_name="same")]))
        a,b=data["channels"]
        self.assertNotEqual(binding_key(a),binding_key(b))
        self.assertEqual([a["identityStatus"],b["identityStatus"]],["unique-in-view"]*2)

    def test_duplicate_identifiers_cannot_confirm_unique(self):
        a,b=snapshot(fixture([make_field("A"),make_field("A")]))["channels"]
        self.assertEqual((a["identityStatus"],b["identityStatus"]),("duplicate-in-view",)*2)

    def test_missing_type_and_failed_getter_are_distinct_from_empty_value(self):
        class Broken(Element):
            @property
            def unit(self):
                raise ValueError("read failed")
        e=make_field("A")
        del e.base_type
        row=snapshot(fixture([Broken(**e.__dict__)]))["channels"][0]
        self.assertEqual(row["element"]["unit"]["message"],"read failed")
        self.assertEqual(row["element"]["base_type"]["state"],"error")
        self.assertEqual(row["mapping"]["manual_iec_address"], {"state":"value","value":""})

    def test_null_empty_positive_and_unavailable_first_entry(self):
        elems=[make_field(str(i)) for i in range(5)]
        for idx in (1,2):
            elems[idx].io_mapping.Id=3
        elems[1].io_mapping.variable=""
        elems[2].io_mapping.variable="GVL.Input"
        elems[3].io_mapping=None
        del elems[4].io_mapping.variable
        r=snapshot(fixture(elems))
        self.assertEqual([x["mappingState"] for x in r["channels"]],[
            "no-first-mapping-native-sentinel","empty-expression","mapping-text-read",
            "null-mapping-object","mapping-field-unavailable"])
        self.assertEqual(r["channels"][2]["mapping"]["variable"]["value"], "GVL.Input")
        self.assertEqual(r["coverage"]["nativeDeclarationBinding"], "unavailable")

    def test_end_of_enumeration_and_cap_have_different_totals(self):
        r=snapshot(fixture([]))
        self.assertEqual(r["coverage"]["totalInTraversedViews"],0)
        r=snapshot(fixture(),max_items=4)
        self.assertTrue(r["coverage"]["truncated"])
        self.assertIsNone(r["coverage"]["totalInTraversedViews"])
        self.assertFalse(r["coverage"]["enumerationComplete"])
        self.assertEqual(r["coverage"]["pagination"],"none")

    def test_interrupted_enumeration_preserves_observed_prefix(self):
        def broken():
            yield make_field("first")
            raise RuntimeError("enumeration failed")
        r=snapshot(fixture(broken()))
        self.assertEqual(len(r["channels"]),1)
        self.assertEqual(r["issues"][0]["detail"]["message"],"enumeration failed")
        self.assertFalse(r["coverage"]["enumerationComplete"])
        self.assertFalse(r["coverage"]["truncated"])

    def test_truncated_page_source_cannot_report_full_count(self):
        def pages():
            for item in (make_field("A"), make_field("B")):
                yield item
            raise IOError("next source page unavailable")
        r=snapshot(fixture(pages()))
        self.assertEqual([row["elementIdentifiers"] for row in r["channels"]], [["A"],["B"]])
        self.assertIsNone(r["coverage"]["totalInTraversedViews"])
        self.assertFalse(r["coverage"]["enumerationComplete"])
        self.assertIn("next source page",r["issues"][0]["detail"]["message"])

    def test_changed_channel_identity_does_not_compare_as_same(self):
        first=snapshot(fixture([make_field("A")]))["channels"][0]
        later=snapshot(fixture([make_field("B")]))["channels"][0]
        self.assertNotEqual(binding_key(first),binding_key(later))
        self.assertEqual(first["enumerationOrdinals"],later["enumerationOrdinals"])

    def test_nonmappable_parameters_and_unknown_capability_are_not_channels(self):
        a,b=make_field("A",is_mappable_io=False),make_field("B")
        del b.is_mappable_io
        r=snapshot(fixture([a,b]))
        self.assertFalse(r["channels"])
        self.assertEqual(len(r["unclassified"]),1)
        self.assertFalse(r["coverage"]["enumerationComplete"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
