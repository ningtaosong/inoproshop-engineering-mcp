"""Synthetic XML/reporting checks, not native IDE PDO acceptance."""
import unittest
from ethercat_pdo_definition_probe import inspect_esi

BASE = """<EtherCATInfo><Vendor><Id>#x20</Id><Name>Vendor</Name></Vendor>
<Descriptions><Devices><Device><Type ProductCode="#x123" RevisionNo="#x2">Model</Type>
<Sm StartAddress="#x1000">Outputs</Sm>
<RxPdo Sm="2"><Index>#x1600</Index><Name>Same</Name>
<Entry><Index>#x6040</Index><SubIndex>0</SubIndex><BitLen>16</BitLen><DataType>UINT</DataType><Name>Item</Name></Entry></RxPdo>
<TxPdo><Index>#x1A00</Index><Name>Same</Name>
<Entry><Index>#x6041</Index><SubIndex>1</SubIndex><BitLen>13</BitLen><DataType>VENDOR_TYPE</DataType></Entry></TxPdo>
</Device></Devices></Descriptions></EtherCATInfo>"""


def read(s=BASE):
    return inspect_esi(s.encode(), "#x123", "#x2")


class EvidenceTests(unittest.TestCase):
    def test_definition_not_project_or_online(self):
        r=read()
        self.assertEqual(r["evidenceLayer"], "device-description-definition")
        self.assertFalse(r["projectConfigurationRead"]);self.assertFalse(r["onlineStateRead"])
        self.assertFalse(r["publicRuntimeEntryProven"]);self.assertFalse(r["writeAuthorized"])
    def test_pdo_and_entry_indices_separate(self):
        row=read()["pdoDefinitions"][0]
        self.assertEqual(row["pdoIndex"]["raw"],"#x1600")
        self.assertEqual(row["entries"][0]["objectIndex"]["raw"],"#x6040")
        self.assertEqual(row["entries"][0]["subIndex"]["raw"],"0")
    def test_duplicate_names_do_not_merge_identity(self):
        r=read();self.assertEqual(len(r["pdoDefinitions"]),2)
        self.assertEqual(r["coverage"]["fieldGaps"],[])
    def test_raw_order_is_not_sorted(self):
        s=BASE.replace("RxPdo","TEMP").replace("TxPdo","RxPdo").replace("TEMP","TxPdo")
        rows=read(s)["pdoDefinitions"]
        self.assertEqual([p["rawDirection"]for p in rows],["TxPdo","RxPdo"])
        self.assertEqual([p["sourceOrdinal"]for p in rows],[0,1])
    def test_raw_type_and_bits_preserved(self):
        e=read()["pdoDefinitions"][1]["entries"][0]
        self.assertEqual(e["dataType"]["raw"],"VENDOR_TYPE");self.assertEqual(e["bitLength"]["raw"],"13")
    def test_missing_field_is_gap(self):
        r=read(BASE.replace("<SubIndex>0</SubIndex>",""))
        self.assertEqual(r["pdoDefinitions"][0]["entries"][0]["subIndex"],{"state":"missing"})
        self.assertTrue(any(x["field"]=="subIndex"for x in r["coverage"]["fieldGaps"]))
    def test_empty_field_not_missing_or_literal(self):
        r=read(BASE.replace("<SubIndex>0</SubIndex>","<SubIndex/>"))
        self.assertEqual(r["pdoDefinitions"][0]["entries"][0]["subIndex"]["state"],"empty")
        s=read(BASE.replace("<SubIndex>0</SubIndex>","<SubIndex>None</SubIndex>"))
        self.assertEqual(s["pdoDefinitions"][0]["entries"][0]["subIndex"]["raw"],"None")
    def test_description_sm_not_current_assignment(self):
        p=read()["pdoDefinitions"][0]
        self.assertEqual(p["descriptionSyncManager"]["raw"],"2")
        self.assertEqual(p["projectAssignment"]["state"],"not-read")
        self.assertEqual(p["projectEnabled"]["state"],"not-read")
        self.assertEqual(p["directionReference"],"not-established-by-this-probe")
    def test_duplicate_pdo_identity_reported(self):
        s=BASE.replace("</RxPdo>","</RxPdo><RxPdo><Index>#x1600</Index></RxPdo>",1)
        self.assertTrue(any(x["state"]=="duplicate"for x in read(s)["coverage"]["fieldGaps"]))
    def test_ambiguous_device_rejected(self):
        device=BASE.split("<Devices>")[1].split("</Devices>")[0]
        with self.assertRaisesRegex(ValueError,"DEVICE_IDENTITY_NOT_UNIQUE"):
            read(BASE.replace("</Devices>",device+"</Devices>"))
    def test_wrong_version_rejected(self):
        with self.assertRaisesRegex(ValueError,"DEVICE_IDENTITY_NOT_UNIQUE"):
            inspect_esi(BASE.encode(),"#x123","#x3")
    def test_wrapper_not_empty_pdo_result(self):
        with self.assertRaisesRegex(ValueError,"NOT_ESI_DEFINITION"):
            read("<DeviceDescription/>")
    def test_no_definitions_not_no_project_pdos(self):
        s="<EtherCATInfo><Vendor><Id>1</Id></Vendor><Descriptions><Devices><Device><Type ProductCode='#x123' RevisionNo='#x2'/></Device></Devices></Descriptions></EtherCATInfo>"
        r=read(s);self.assertEqual(r["coverage"]["pdoCount"],0);self.assertFalse(r["projectConfigurationRead"])
    def test_malformed_xml_not_empty(self):
        with self.assertRaises(Exception):read(BASE[:-20])


if __name__=="__main__":
    unittest.main(verbosity=2)
