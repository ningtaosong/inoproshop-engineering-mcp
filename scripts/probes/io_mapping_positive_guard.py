# -*- coding: utf-8 -*-
"""Admission and postconditions for one disposable AM610 fixture, never a product endpoint."""
from __future__ import unicode_literals
import copy
import re
from io_mapping_read import binding_key, string_type, int_types

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


def target_names(state):
    app = unique(state["applications"], "Expected one native Application in the fixture")
    name = app["name"]
    require(app["isApplication"] is True and app["guid"] == state["applicationId"] and app["guid"]
            and app["typeGuid"] and isinstance(name, string_type) and re.match(r"\A[A-Za-z_][A-Za-z0-9_]*\Z", name)
            and app["path"] and app["path"][-1] == name, "Native Application identity, name or path differs")
    require(state["tasks"]["applicationId"] == app["guid"] and state["tasks"]["applicationPath"] == app["path"],
            "Task inventory identifies a different Application")
    root = unique((d for d in state["snapshot"]["devices"] if d["path"] == ["Device"]),
                  "Fixture root device not unique")
    require(app["deviceGuid"] == raw(root, "guid") and app["path"][:1] == root["path"],
            "Application does not belong to the selected device")
    exported_root = unique((d for d in state["export"]["devices"] if d["guid"] == app["deviceGuid"]),
                           "Root device is missing or ambiguous in the export")
    require(exported_root["ioApplicationSet"] is True and exported_root["ioApplicationId"] == app["guid"],
            "Root device I/O handling Application differs")
    gvl = state["declaration"]
    require(gvl["typeGuid"] == "ffbfa93a-b94d-45fc-a329-229860183b1d" and
            gvl["text"].strip() == DECL and gvl["parentGuid"] == state["applicationId"] and
            gvl["name"] == GVL_NAME and gvl["guid"], "Existing unique root BOOL declaration differs")
    require(gvl["path"] == app["path"] + [gvl["name"]], "GVL is not at the verified Application path")
    source = unique((s for s in state["sources"] if s["app"] == app["guid"] and
                     s["path"][-1].lower() == GVL_NAME.lower()), "GVL source absent or ambiguous")
    require(source["guid"] == gvl["guid"] and source["path"] == gvl["path"] and
            source["typeGuid"] == gvl["typeGuid"] and source["declaration"] == gvl["text"],
            "Declaration differs from the source inventory")
    # The exact one-declaration fixture above authorizes this spelling and BOOL type.
    return name, gvl["name"], "Input0"


def mapping_expression(state, planned=None):
    expression = ".".join(target_names(state))
    if planned is not None:
        require(expression == planned, "Authorized expression differs from the actual Application and GVL declaration")
    return expression


def validate_state(state, positive, match_export=None):
    snap, export = state["snapshot"], state["export"]
    expression = mapping_expression(state)
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
    exported_mod = unique((d for d in export["devices"] if d["guid"] == guid),
                          "Target device driver metadata absent or ambiguous")
    connector_driver = unique((c for c in exported_mod["connectorHandling"] if c["connectorId"] == 2),
                              "Target connector driver metadata absent or ambiguous")
    for driver in (exported_mod, connector_driver):
        require(driver["ioApplicationSet"] is False and driver["ioApplicationId"] == "00000000-0000-0000-0000-000000000000",
                "I/O Application selection differs on target device or connector")
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
            require(row["mappingState"]=="mapping-text-read" and raw(m,"variable")==expression and
                    raw(m,"mapping_creates_variable") is False and raw(m,"maps_to_existing_variable") is True,
                    "Setter did not establish the requested existing-variable expression")
            require(len(entries)==1 and match_export is not None and match_export(entries[0],expression),
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
    export_devices = sorted(state["export"]["devices"], key=lambda dev: dev["guid"])
    return ((state["applicationId"],state["applications"]),state["declaration"],state["sources"],state["tasks"],
            devices,connectors,snap["channels"],rows,export_devices)


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
