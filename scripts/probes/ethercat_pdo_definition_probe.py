"""Read an explicitly selected installed ESI definition; never opens an IDE project.
This is an independent probe, not a product tool or current PDO configuration reader.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit("}", 1)[-1]


def children(node, name):
    return [c for c in node if local(c.tag) == name]


def one(node, name):
    rows = children(node, name)
    if len(rows) != 1:
        raise ValueError("EXPECTED_ONE_" + name)
    return rows[0]


def text_field(node, name):
    rows = children(node, name)
    if not rows:
        return {"state": "missing"}
    if len(rows) != 1:
        return {"state": "ambiguous", "count": len(rows)}
    value = rows[0].text
    return {"state": "empty" if value is None or value == "" else "value",
            "raw": value, "attributes": dict(rows[0].attrib)}


def attr_field(node, name):
    return {"state": "value", "raw": node.attrib[name]} if name in node.attrib else {"state": "missing"}


def names(node):
    return [{"raw": x.text, "attributes": dict(x.attrib)} for x in children(node, "Name")]


def inspect_esi(raw, product_code, revision):
    root = ET.fromstring(raw)
    if local(root.tag) != "EtherCATInfo":
        raise ValueError("NOT_ESI_DEFINITION")
    vendor = one(root, "Vendor")
    devices = children(one(one(root, "Descriptions"), "Devices"), "Device")
    candidates = []
    for i, device in enumerate(devices, 1):
        ts = children(device, "Type")
        if len(ts) == 1 and ts[0].get("ProductCode") == product_code and ts[0].get("RevisionNo") == revision:
            candidates.append((i, device, ts[0]))
    if len(candidates) != 1:
        raise ValueError("DEVICE_IDENTITY_NOT_UNIQUE")
    device_ordinal, dev, typ = candidates[0]
    base = "/EtherCATInfo/Descriptions/Devices/Device[%d]" % device_ordinal
    pdos, gaps, keys = [], [], set()
    group_ordinals = {"RxPdo": 0, "TxPdo": 0}
    for child in dev:
        kind = local(child.tag)
        if kind not in group_ordinals:
            continue
        group_ordinals[kind] += 1
        source = base + "/%s[%d]" % (kind, group_ordinals[kind])
        idx = text_field(child, "Index")
        row = {"sourcePath": source, "sourceOrdinal": len(pdos),
               "rawDirection": kind, "directionReference": "not-established-by-this-probe",
               "pdoIndex": idx, "names": names(child), "attributes": dict(child.attrib),
               "descriptionSyncManager": attr_field(child, "Sm"), "entries": [],
               "projectEnabled": {"state": "not-read"},
               "projectAssignment": {"state": "not-read"}}
        if idx["state"] != "value":
            gaps.append({"sourcePath": source, "field": "PDO.Index", "state": idx["state"]})
        else:
            key = (kind, idx["raw"])
            if key in keys:
                gaps.append({"sourcePath": source, "field": "PDO.identity", "state": "duplicate"})
            keys.add(key)
        for i, entry in enumerate(children(child, "Entry")):
            er = {"sourcePath": source + "/Entry[%d]" % (i + 1), "sourceOrdinal": i,
                  "objectIndex": text_field(entry, "Index"), "subIndex": text_field(entry, "SubIndex"),
                  "names": names(entry), "dataType": text_field(entry, "DataType"),
                  "bitLength": text_field(entry, "BitLen"), "attributes": dict(entry.attrib)}
            for field in ("objectIndex", "subIndex", "dataType", "bitLength"):
                if er[field]["state"] != "value":
                    gaps.append({"sourcePath": er["sourcePath"], "field": field, "state": er[field]["state"]})
            row["entries"].append(er)
        pdos.append(row)
    return {
        "evidenceLayer": "device-description-definition",
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "vendorId": text_field(vendor, "Id"), "vendorNames": names(vendor),
        "device": {"sourcePath": base, "typeText": typ.text, "names": names(dev),
                   "productCode": attr_field(typ, "ProductCode"), "revisionNo": attr_field(typ, "RevisionNo")},
        "pdoDefinitions": pdos,
        "syncManagerDefinitions": [{"sourceOrdinal": i, "raw": x.text, "attributes": dict(x.attrib)}
                                   for i, x in enumerate(children(dev, "Sm"))],
        "coverage": {"scope": "direct RxPdo/TxPdo/Entry children of selected ESI Device only",
                     "enumerationComplete": True, "truncated": False, "fieldGaps": gaps,
                     "pdoCount": len(pdos), "entryCount": sum(len(p["entries"]) for p in pdos),
                     "otherDeviceCount": len(devices) - 1,
                     "nestedModuleDefinitions": "not-enumerated"},
        "projectConfigurationRead": False, "onlineStateRead": False,
        "publicRuntimeEntryProven": False, "writeAuthorized": False,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--esi", type=Path, required=True)
    p.add_argument("--product-code", required=True)
    p.add_argument("--revision", required=True)
    p.add_argument("--expected-sha256", required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    raw = args.esi.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.expected_sha256:
        raise ValueError("SOURCE_VERSION_CHANGED")
    result = inspect_esi(raw, args.product_code, args.revision)
    result["sourceFile"] = str(args.esi.resolve())
    if args.out.resolve() == args.esi.resolve() or args.out.exists():
        raise ValueError("OUTPUT_MUST_BE_NEW_AND_DISTINCT")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({"pdoDefinitions": result["coverage"]["pdoCount"],
                      "entries": result["coverage"]["entryCount"],
                      "fieldGaps": len(result["coverage"]["fieldGaps"]),
                      "projectOpened": False}))


if __name__ == "__main__":
    main()
