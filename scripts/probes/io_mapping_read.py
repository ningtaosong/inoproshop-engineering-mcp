# -*- coding: utf-8 -*-
"""Offline I/O observation. Only public project/connector/element getters are used."""
from __future__ import unicode_literals

try:
    string_type = basestring
    int_types = (int, long)
    as_text = unicode
except NameError:
    string_type = str
    int_types = (int,)
    as_text = str


def val(fn, convert=None):
    try:
        v = fn()
        if v is None:
            return {"state": "null", "value": None}
        if convert:
            v = convert(v)
        if not isinstance(v, (string_type, bool, float) + int_types):
            native_type = getattr(v, "GetType", lambda: None)()
            if getattr(native_type, "FullName", None) in (
                    "System.Int64", "System.UInt64", "System.Int32", "System.UInt32",
                    "System.Int16", "System.UInt16", "System.Byte", "System.SByte"):
                return {"state": "value", "value": int(as_text(v)), "nativeType": as_text(native_type.FullName)}
        if not isinstance(v, (string_type, bool, float) + int_types):
            # A structure without a verified scalar representation is not a type name.
            raise TypeError("No supported scalar representation: " + type(v).__name__)
        return {"state": "value", "value": v}
    except Exception as exc:
        return {"state": "error", "errorType": type(exc).__name__, "message": as_text(exc)}


def read(obj, key, convert=None):
    return val(lambda: getattr(obj, key), convert)


def fields(obj, names):
    return dict((name, read(obj, name)) for name in names.split())


def value(field):
    return field.get("value") if field and field["state"] == "value" else None


def native_text(x):
    return as_text(x)


def mapping_state(f):
    """Local 1.9.1.6 first-entry getter semantics, corroborated separately on this sample."""
    keys = ("Id", "variable", "maps_to_existing_variable", "mapping_creates_variable")
    if any(f[k]["state"] == "error" for k in keys):
        return "mapping-field-unavailable"
    mid, variable, existing, creates = [value(f[k]) for k in keys]
    if mid == -1 and f["variable"]["state"] == "null" and existing is True and creates is False:
        return "no-first-mapping-native-sentinel"
    if f["variable"]["state"] == "value" and variable == "":
        return "empty-expression"
    if (isinstance(mid, int_types) and not isinstance(mid, bool) and mid >= -1 and
            isinstance(variable, string_type) and variable and
            isinstance(existing, bool) and isinstance(creates, bool) and existing != creates):
        return "mapping-text-read"
    return "mapping-state-undetermined"


def snapshot(project, max_items=100000, max_depth=96):
    out = {"devices": [], "connectors": [], "channels": [], "scans": [], "issues": [],
           "nonMappableByView": {}, "unclassified": [], "objectsVisited": 0,
           "elementsVisited": 0, "parameterRootsVisited": 0}
    budget = [max_items]
    complete = [True]
    truncated = [False]

    def issue(where, stage, detail):
        complete[0] = False
        out["issues"].append({"path": where, "stage": stage, "detail": detail})

    def walk(get_items, where, visit, depth):
        scan = {"path": where, "enumerated": 0, "endObserved": False}
        out["scans"].append(scan)
        if depth > max_depth:
            truncated[0] = True
            issue(where, "depth-cap", max_depth)
            return
        try:
            for obj in get_items():
                if budget[0] <= 0:
                    truncated[0] = True
                    issue(where, "item-cap", max_items)
                    return
                budget[0] -= 1
                visit(obj, scan["enumerated"])
                scan["enumerated"] += 1
            scan["endObserved"] = True
        except Exception as exc:
            issue(where, "enumeration", {"type": type(exc).__name__, "message": as_text(exc)})

    def root_fields(param):
        p = fields(param, "id name type_string iec_type")
        p["channel_type"] = read(param, "channel_type", native_text)
        p["param_type"] = read(param, "param_type", native_text)
        p["ownerGuid"] = val(lambda: param.get_device_object().guid, native_text)
        return p

    def scan_parameters(get_set, owner, connector_id, path, view, depth):
        def root(param, ordinal):
            out["parameterRootsVisited"] += 1
            raw = root_fields(param)
            p_id = value(raw["id"])
            def element(e, sub_ids, indices, layer):
                out["elementsVisited"] += 1
                identifier = read(e, "identifier")
                segments = sub_ids + ([value(identifier)] if indices else [])
                loc = path + [p_id] + segments
                flag = read(e, "is_mappable_io")
                expanded = read(e, "has_sub_elements")
                if value(flag) is True:
                    row = {"deviceGuid": owner, "view": view, "connectorId": connector_id,
                           "path": loc, "parameter": raw, "elementIdentifiers": segments,
                           "enumerationOrdinals": [ordinal] + indices, "is_mappable_io": flag,
                           "has_sub_elements": expanded, "identifier": identifier,
                           "element": fields(e, "visible_name bit_size unit")}
                    if value(expanded) is False:
                        row["element"]["base_type"] = read(e, "base_type", native_text)
                    try:
                        m = e.io_mapping
                        if m is None:
                            row["mappingState"] = "null-mapping-object"
                            row["mapping"] = None
                        else:
                            mf = fields(m, "Id variable default_variable maps_to_existing_variable mapping_creates_variable automatic_iec_address manual_iec_address")
                            row["mapping"] = mf
                            row["mappingState"] = mapping_state(mf)
                    except Exception as exc:
                        row["mappingState"] = "mapping-object-unavailable"
                        row["mappingError"] = {"type": type(exc).__name__, "message": as_text(exc)}
                    out["channels"].append(row)
                elif value(flag) is False:
                    counts = out["nonMappableByView"]
                    counts[view] = counts.get(view, 0) + 1
                else:
                    issue(loc, "is_mappable_io", flag)
                    out["unclassified"].append({"path": loc, "parameterId": p_id, "is_mappable_io": flag})
                if value(expanded) is True:
                    walk(lambda: iter(e), loc, lambda c, i: element(c, segments, indices+[i], layer+1), layer+1)
                elif value(expanded) is not False:
                    issue(loc, "has_sub_elements", expanded)
            element(param, [], [], depth)
        walk(get_set, path, root, depth)

    def inspect_connector(c, device_guid, parent_path, depth):
        f = fields(c, "connector_id interface interface_name")
        f["host_path"] = read(c, "host_path", native_text)
        f["connector_role"] = read(c, "connector_role", native_text)
        f["ownerGuid"] = val(lambda: c.get_device_object().guid, native_text)
        ident = value(f["connector_id"])
        loc = parent_path + ["connectors", ident]
        out["connectors"].append({"path": loc, "enumeratedFromDeviceGuid": device_guid, "fields": f})
        scan_parameters(lambda: iter(c.host_parameters), device_guid, ident,
                        loc+["host_parameters"], "connector.host_parameters", depth+1)

    def nodes(obj, parent_path, depth):
        def visit(child, unused):
            out["objectsVisited"] += 1
            name = val(child.get_name)
            loc = parent_path + [value(name)]
            is_device = read(child, "is_device")
            if value(is_device) is True:
                g = read(child, "guid", native_text)
                des = {}
                try:
                    native_id = child.get_device_identification()
                    des = fields(native_id, "type id version")
                except Exception as exc:
                    des["error"] = as_text(exc)
                guid = value(g)
                out["devices"].append({"path": loc, "guid": g, "name": name, "identification": des})
                scan_parameters(lambda: iter(child.device_parameters), guid, None,
                                loc+["device_parameters"], "device.device_parameters", depth+1)
                walk(lambda: iter(child.connectors), loc+["connectors"],
                     lambda c, i: inspect_connector(c, guid, loc, depth+1), depth+1)
            elif value(is_device) is not False:
                issue(loc, "is_device", is_device)
            nodes(child, loc, depth+1)
        walk(lambda: obj.get_children(False), parent_path, visit, depth)

    nodes(project, [], 0)
    states = {}
    counts = {}
    for row in out["channels"]:
        state = row["mappingState"]
        states[state] = states.get(state, 0)+1
        k = binding_key(row)
        if k is not None:
            counts[k] = counts.get(k, 0)+1
    for row in out["channels"]:
        k = binding_key(row)
        row["identityStatus"] = ("incomplete" if k is None else
                                 "unique-in-view" if counts[k] == 1 else "duplicate-in-view")
    out["coverage"] = {"enumerationComplete": complete[0], "truncated": truncated[0],
                       "maxItems": max_items, "maxDepth": max_depth, "pagination": "none",
                       "observedMappableRows": len(out["channels"]), "mappingStates": states,
                       "totalInTraversedViews": len(out["channels"]) if complete[0] else None,
                       "projectWideChannelTotal": None, "nativeDeclarationBinding": "unavailable"}
    return out


def binding_key(row):
    owner = row["deviceGuid"]
    conn = row["connectorId"]
    param = row["parameter"]
    leaf = row["elementIdentifiers"]
    if (not owner or value(param["id"]) is None or
            any(not isinstance(s, string_type) or not s for s in leaf) or
            (row["view"] == "connector.host_parameters" and conn is None)):
        return None
    return (owner, row["view"], conn, value(param["id"]), tuple(leaf))
