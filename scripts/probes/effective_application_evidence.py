"""Offline evidence-shape guard, not a native collector or product authorization.

A trusted API route must be established independently. Synthetic flags in tests
do not establish that the installed host offers such a route.
"""
import hashlib
import json

RULE = "effective-io-application-evidence-v1"
CONTEXT = ("operationId", "processId", "processStartId", "handle", "openEpoch",
           "projectPath", "fileIdentity", "diskHash", "phase")


class Gap(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Gap(code)


def version(record):
    raw = json.dumps({"rule": RULE, "record": record}, sort_keys=True,
                     ensure_ascii=False, separators=(",", ":")).encode("utf8")
    return hashlib.sha256(raw).hexdigest()


def assess(record, expected, expected_version=None):
    try:
        current = version(record)
        need(expected_version is None or current == expected_version, "EVIDENCE_CHANGED")
        need(record.get("basis") == "current-native-effective-provider", "NOT_EFFECTIVE_RETURN")
        api = record.get("api", {})
        need(api.get("publicEntryConfirmed") is True, "SCRIPT_ENTRY_UNCONFIRMED")
        need(api.get("readOnly") is True, "READONLY_UNCONFIRMED")
        need(api.get("configModeSelection") is True and
             api.get("parentDelegation") is True and
             api.get("scope") == "target-provider", "SELECTION_PATH_INCOMPLETE")
        ctx = record.get("context", {})
        need(all(k in ctx and k in expected and ctx[k] == expected[k]
                 for k in CONTEXT), "STALE_OR_FOREIGN_CONTEXT")
        need(record.get("capturedWhileOpen") is True, "HANDLE_NOT_OPEN")
        need(record.get("target") == expected.get("target") and
             record.get("target") is not None, "TARGET_PROVIDER_MISMATCH")
        inventory = record.get("applications", {})
        need(inventory.get("complete") is True and not inventory.get("errors"),
             "APPLICATION_ENUMERATION_INCOMPLETE")
        rows = inventory.get("items")
        need(isinstance(rows, list), "APPLICATION_ENUMERATION_MISSING")
        ids = [r.get("guid") for r in rows]
        need(all(isinstance(g, str) and g for g in ids) and len(ids) == len(set(ids)),
             "APPLICATION_IDENTITY_AMBIGUOUS")
        value = record.get("effective")
        need(isinstance(value, dict), "RETURN_MISSING")
        state = value.get("state")
        if state == "error":
            raise Gap("RETURN_READ_FAILED")
        if state == "null":
            raise Gap("RETURN_NULL")
        need(state == "value", "RETURN_MISSING")
        need(value.get("kind") in ("object", "guid"), "RETURN_TYPE_UNSUPPORTED")
        matches = [r for r in rows if r["guid"] == value.get("guid")]
        need(len(matches) == 1, "RETURN_NOT_IN_APPLICATIONS")
        app = matches[0]
        need(app.get("isApplication") is True and app.get("typeGuid") and
             app.get("projectHandle") == ctx["handle"] and
             app.get("deviceGuid") == expected["target"]["rootDeviceGuid"],
             "APPLICATION_OWNERSHIP_MISMATCH")
        if value["kind"] == "object":
            need(all(value.get(k) == app.get(k) and value.get(k) is not None
                     for k in ("name", "parentGuid", "projectHandle")),
                 "RETURN_OBJECT_IDENTITY_MISMATCH")
        persisted = record.get("persistentSelection", {})
        stored_id = persisted.get("ioApp")
        return dict(status="effective-selection-evidence", guid=app["guid"],
                    version=current, phase=ctx["phase"],
                    differsFromPersistentSelection=stored_id is not None and stored_id != app["guid"],
                    configModeState=record.get("configModeState", {"state": "not-read"}),
                    basis="native-effective-return-matched-to-same-handle-application",
                    validForFutureHandle=False, writeAuthorized=False)
    except Gap as err:
        return dict(status="insufficient", code=str(err), writeAuthorized=False)
    except (TypeError, KeyError, ValueError):
        return dict(status="insufficient", code="EVIDENCE_MALFORMED", writeAuthorized=False)
