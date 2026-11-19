# -*- coding: utf-8 -*-
"""Admission and postconditions for one disposable AM610 fixture, never a product endpoint."""
from __future__ import unicode_literals
import copy
from io_mapping_read import binding_key, string_type, int_types

EXPRESSION = "GVL_IOProbe.Input0"
GVL_NAME = "GVL_IOProbe"
DECL = "VAR_GLOBAL\n    Input0 : BOOL := FALSE;\nEND_VAR"
MODEL = (4102, "10f4 0002", "3.5.11.11")
MODULE = (40600, "10F4 0600", "00.00.00.20")


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def raw(group, k):
    field = group[k]
    require(field["state"] == "value", k + ": missing or unreadable")
    return field["value"]


def unique(items, reason):
    items = list(items)
    require(len(items) == 1, reason)
    return items[0]


def rowkey(r):
    key = binding_key(r)
    require(key and key[1] == "connector.host_parameters" and r["identityStatus"] == "unique-in-view",
            "Fixture channel lacks a unique connector-relative identity")
    return (key[0], key[2], key[3], key[4])


def xmlkey(r):
    return (r["deviceGuid"], r["connectorId"], r["parameterId"], tuple(r["elementPath"]))


def index(rows, key):
    out = {}
    for row in rows:
        k = key(row)
        require(k not in out, "Duplicate scoped channel identity")
        out[k] = row
    return out


def exported_empty_default(entry):
    # An explicit empty, typed scalar is distinguishable from a missing/Null XML node.
    children = entry.get("xml", {}).get("children", [])
    fields = [c for c in children if c.get("attrs", {}).get("Name") == "DefaultVariable"]
    return (len(fields) == 1 and fields[0].get("tag") == "Single"
            and fields[0]["attrs"].get("Type") == "string"
            and fields[0].get("children") == [] and fields[0].get("value") == "")


def validate_state(state, positive, match_export=None):
    snap, export = state["snapshot"], state["export"]
    gvl = state["declaration"]
    require(gvl["typeGuid"] == "ffbfa93a-b94d-45fc-a329-229860183b1d" and
            gvl["text"].strip() == DECL and gvl["parentGuid"] == state["applicationId"] and
            gvl["name"] == GVL_NAME and gvl["guid"], "Existing unique root BOOL declaration differs")
    cov = snap["coverage"]
    require(cov["enumerationComplete"] and not cov["truncated"] and not snap["issues"] and
            not snap["unclassified"] and all(s["endObserved"] for s in snap["scans"]),
            "Incomplete channel enumeration")
    require(export.get("complete") is True, "Incomplete independent export")
    native, xml = index(snap["channels"], rowkey), index(export["rows"], xmlkey)
    require(native and set(native) == set(xml), "Getter/export channel coverage differs")
    def model(d):
        return tuple(raw(d["identification"], k) for k in ("type","id","version"))
    root = unique((d for d in snap["devices"] if d["path"] == ["Device"] and model(d) == MODEL),
                  "AM610 instance identity differs")
    mod = unique((d for d in snap["devices"] if d["path"] == root["path"]+["HIGH_SPEED_IO"] and model(d) == MODULE),
                 "HIGH_SPEED_IO instance identity differs")
    guid = raw(mod, "guid")
    conn = unique((c for c in snap["connectors"] if c["enumeratedFromDeviceGuid"] == guid and
                   raw(c["fields"], "connector_id") == 2), "Connector 2 is ambiguous or absent")
    require(raw(conn["fields"], "ownerGuid") == guid and raw(conn["fields"],"interface") == "Common.inovance2",
            "Unexpected connector owner or interface")
    target = (guid,2,13,("Bit0",))
    require(target in native, "Complete target channel key not found")
    t = native[target]
    require(raw(t["parameter"],"ownerGuid")==guid and raw(t["parameter"],"name")=="InputData" and
            raw(t["parameter"],"channel_type")=="Input" and raw(t["element"],"base_type")=="BOOL" and
            raw(t["element"],"bit_size")==1 and raw(t,"identifier")=="Bit0",
            "Channel owner, direction or BOOL type differs")
    for k,row in native.items():
        entries = xml[k]["rawMappings"]
        require(isinstance(entries,list), "Independent mapping list unreadable")
        m=row["mapping"]
        if k == target:
            expected_default = ({"state": "value", "value": ""} if positive
                                else {"state": "null", "value": None})
            require(m.get("default_variable") == expected_default,
                    "Target default_variable is missing or differs from the expected native state")
        if k==target and positive:
            require(row["mappingState"]=="mapping-text-read" and raw(m,"variable")==EXPRESSION and
                    raw(m,"mapping_creates_variable") is False and raw(m,"maps_to_existing_variable") is True,
                    "Setter did not establish the requested existing-variable expression")
            require(len(entries)==1 and match_export is not None and match_export(entries[0],EXPRESSION),
                    "Getter disagrees with the independently exported mapping entry")
            require(exported_empty_default(entries[0]), "Export DefaultVariable disagrees with target getter")
        else:
            require(not entries and row["mappingState"]=="no-first-mapping-native-sentinel" and
                    m["variable"]["state"]=="null" and raw(m,"Id")==-1 and
                    raw(m,"mapping_creates_variable") is False and raw(m,"maps_to_existing_variable") is True,
                    "Existing mapping, nonempty export, or conflicting empty read")
    return target


def invariant(state, target, cross_open=False):
    # Exclude only the selected first mapping's four mutable fields and its exported list.
    snap = copy.deepcopy(state["snapshot"])
    snap["coverage"].pop("mappingStates")
    r = index(snap["channels"],rowkey)[target]
    r.pop("mappingState")
    for name in ("Id","variable","maps_to_existing_variable","mapping_creates_variable"):
        r["mapping"].pop(name)
    rows = copy.deepcopy(state["export"]["rows"])
    index(rows,xmlkey)[target].pop("rawMappings")
    devices, connectors = snap["devices"], snap["connectors"]
    if cross_open:
        # IDE project-tree enumeration can reorder these two views after save.
        # Preserve every row and field; duplicate or incomplete keys cannot join.
        d = index(devices, lambda v: raw(v,"guid"))
        c = index(connectors, lambda v: (v["enumeratedFromDeviceGuid"],raw(v["fields"],"connector_id")))
        devices = [d[k] for k in sorted(d)]
        connectors = [c[k] for k in sorted(c)]
    return (state["applicationId"],state["declaration"],state["sources"],state["tasks"],
            devices,connectors,snap["channels"],rows)


def change_only(before, after, match_export, cross_open=False):
    first=validate_state(before,False)
    second=validate_state(after,True,match_export)
    # Model the one expected metadata transition on a copy of the original target.
    # Equal-phase comparisons in invariant() still compare this field verbatim.
    expected = copy.deepcopy(before)
    target = index(expected["snapshot"]["channels"], rowkey)[first]
    target["mapping"]["default_variable"] = {"state": "value", "value": ""}
    require(first==second and invariant(expected,first,cross_open)==invariant(after,second,cross_open),
            "Source, declaration, task, address, connector or another channel changed")
