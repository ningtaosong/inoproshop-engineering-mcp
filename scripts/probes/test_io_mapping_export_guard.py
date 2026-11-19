"""Bounded fixture for the serializer structure; this is not a native positive result."""
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET
from io_mapping_export_guard import mapping_matches, parse_export


def put(owner, tag, name, value=None, typ=None):
    el = ET.SubElement(owner, tag, Name=name)
    if typ:
        el.set("Type",typ)
    el.text = value
    return el


def mapping_list(el):
    return put(put(put(el,"Single","IoMapping"),"Single","Mappings"),"List2","Mappings")


def fixture():
    doc=ET.Element("ExportFile")
    entries=put(ET.SubElement(ET.SubElement(doc,"StructuredView"),"Single"),"List2","EntryList")
    record=ET.SubElement(entries,"Single")
    meta=put(record,"Single","MetaObject")
    put(meta,"Single","Guid","uid")
    put(meta,"Single","Name","Device")
    obj=put(record,"Single","Object")
    dev=put(obj,"Single","Id")
    for n,v in (("Type","test"),("Id","one"),("Version","1")):
        put(dev,"Single",n,v)
    put(put(obj,"Single","DeviceParameterSet"),"List2","Params")
    conn=ET.SubElement(put(put(obj,"Single","ConnectorList"),"List","InnerList"),"Single")
    put(conn,"Single","ConnectorId","2")
    p=ET.SubElement(put(put(conn,"Single","HostParameterSet"),"List2","Params"),"Single")
    put(p,"Single","Id","13")
    put(p,"Single","ChannelType","Input")
    root=put(p,"Single","DalaElement")
    def populate(el,ident):
        put(el,"Single","Identifier",ident)
        put(put(el,"Single","VisibleName"),"Single","Default",ident)
        rows=mapping_list(el)
        children=put(put(el,"Single","SubElements"),"List2","elements")
        return rows,children
    _,children=populate(root,"root")
    bit=ET.SubElement(children,"Single")
    rows,_=populate(bit,"Bit0")
    template_root=put(bit,"Single","BaseType")
    populate(template_root,"Template")
    return doc,rows


class ExportGuardTests(unittest.TestCase):
    def read(self,doc):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/"fixture.export"
            ET.ElementTree(doc).write(target,encoding="utf8")
            return parse_export(str(target),["uid"])

    def test_count_all_list_entries_and_exclude_templates(self):
        doc,maps=fixture()
        for i,var in enumerate(("GVL_IOProbe.Input0","")):
            item=ET.SubElement(maps,"Single")
            put(item,"Single","Id",str(i),"long")
            put(item,"Single","Variable",var,"string")
            put(item,"Single","CreateVariable","False","bool")
        result=self.read(doc)["rows"]
        self.assertEqual([r["elementPath"] for r in result],[[],["Bit0"]])
        self.assertEqual(result[0]["rawMappings"],[])
        rows=result[1]["rawMappings"]
        self.assertEqual(len(rows),2)
        self.assertTrue(mapping_matches(rows[0],"GVL_IOProbe.Input0"))
        self.assertEqual(rows[1]["variable"],"")
        self.assertEqual(rows[0]["xml"]["children"][1]["attrs"]["Name"],"Variable")

    def test_missing_list_and_missing_entry_field_are_rejected(self):
        doc,maps=fixture()
        item=ET.SubElement(maps,"Single")
        put(item,"Single","Id","1","long")
        put(item,"Single","CreateVariable","False","bool")
        with self.assertRaisesRegex(ValueError,"Variable"):
            self.read(doc)
        maps.set("Name","wrong")
        with self.assertRaisesRegex(ValueError,"Mappings"):
            self.read(doc)

    def test_native_null_and_a_created_variable_are_not_existing_expression(self):
        doc,maps=fixture()
        item=ET.SubElement(maps,"Single")
        put(item,"Single","Id","1","long")
        put(item,"Null","Variable")
        put(item,"Single","CreateVariable","True","bool")
        row=self.read(doc)["rows"][1]["rawMappings"][0]
        self.assertIsNone(row["variable"])
        self.assertTrue(row["createVariable"])
        self.assertFalse(mapping_matches(row,"GVL_IOProbe.Input0"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
