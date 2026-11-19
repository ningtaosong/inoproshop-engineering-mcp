"""Inspect installed CLR metadata and selected CIL. Does not load OEM code or open projects.

Requires Python, dnfile and dncil. Supply the installation's CODESYS directory.
The JSON is a bounded inventory for manual review, not a write authorisation.
"""
import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path

import dnfile
from dncil.cil.body.reader import read_method_body_from_bytes
from dncil.clr.token import Token


def digest(data):
    return hashlib.sha256(data).hexdigest()


def token(value):
    return f"0x{value:08x}"


class Metadata:
    def __init__(self, path):
        self.path = path
        self.pe = dnfile.dnPE(str(path), clr_lazy_load=True)
        self.tables = self.pe.net.mdtables
        self.owners = {}
        self.tokens = {}
        for t in self.tables.TypeDef.rows:
            for item in t.MethodList + t.FieldList:
                self.owners[id(item.row)] = t
        for kind in ("MethodDef", "Field", "TypeDef", "TypeRef", "TypeSpec", "MemberRef", "MethodSpec"):
            table = getattr(self.tables, kind, None)
            if table:
                for i, item in enumerate(table.rows, 1):
                    self.tokens[id(item)] = (table.number << 24) + i

    def signature(self, raw):
        """Decode the small ECMA-335 type subset used here; retain the raw blob for other types."""
        primitive = {1: "void", 2: "bool", 4: "int8", 5: "uint8", 6: "int16", 7: "uint16",
                     8: "int32", 9: "uint32", 10: "int64", 11: "uint64", 14: "string", 28: "object"}
        i = 0

        def byte():
            nonlocal i
            x = raw[i]
            i += 1
            return x

        def integer():
            a = byte()
            if a < 128:
                return a
            if a < 192:
                return ((a & 63) << 8) | byte()
            if a < 224:
                return ((a & 31) << 24) | (byte() << 16) | (byte() << 8) | byte()
            raise ValueError("invalid compressed integer")

        def typename():
            k = byte()
            if k in primitive:
                return primitive[k]
            if k in (0x11, 0x12):
                ref = integer()
                tbl = (self.tables.TypeDef, self.tables.TypeRef, self.tables.TypeSpec)[ref & 3]
                return self.label(tbl.rows[(ref >> 2) - 1])
            if k == 0x15:
                base = typename()
                return base + "<" + ", ".join(typename() for _ in range(integer())) + ">"
            if k == 0x1d:
                return typename() + "[]"
            if k in (0x13, 0x1e):
                return ("!" if k == 0x13 else "!!") + str(integer())
            raise ValueError("unsupported element " + hex(k))

        try:
            if raw[0] == 0x15:  # Generic interface TypeSpec
                value = typename()
            else:
                flags = byte()
                if flags & 0x10:
                    integer()
                count = integer()
                result = typename()
                value = result + " (" + ", ".join(typename() for _ in range(count)) + ")"
            if i == len(raw):
                return value
        except (IndexError, ValueError):
            pass
        return "undecoded:" + raw.hex()

    def label(self, r):
        if r is None:
            return None
        if hasattr(r, "TypeName"):
            return (str(r.TypeNamespace) + "." + str(r.TypeName)).lstrip(".")
        if hasattr(r, "Class") and hasattr(r, "Name"):
            return self.label(r.Class.row) + "::" + str(r.Name)
        if hasattr(r, "Method") and not hasattr(r, "Name"):
            return self.label(r.Method.row)
        if hasattr(r, "Signature") and not hasattr(r, "Name"):
            return self.signature(r.Signature.value)
        if hasattr(r, "Name"):
            return (self.label(self.owners.get(id(r))) or "") + "::" + str(r.Name)
        return type(r).__name__

    def inherited(self, t):
        table = self.tables.InterfaceImpl
        return [self.label(r.Interface.row) for r in table.rows if r.Class.row is t] if table else []

    def method(self, m):
        return {"name": str(m.Name), "token": token(self.tokens[id(m)]),
                "signature": self.signature(m.Signature.value), "rawSignature": m.Signature.value.hex(),
                "parameters": [str(p.row.Name) for p in m.ParamList if p.row.Sequence],
                "public": m.Flags.mdPublic, "private": m.Flags.mdPrivate}

    def trace(self, m):
        # Read the method at its metadata RVA without loading the target assembly.
        data = self.pe.get_data(m.Rva)
        body = read_method_body_from_bytes(data)
        ops = []
        for op in body.instructions:
            operand = op.operand
            if isinstance(operand, Token):
                table = self.tables.tables.get(operand.value >> 24)
                label = self.label(table.rows[(operand.value & 0xffffff) - 1]) if table else None
                operand = token(operand.value) + (" " + label if label else "")
            elif op.opcode.operand_type.name in ("InlineBrTarget", "ShortInlineBrTarget"):
                operand = "IL_%04x" % (operand - body.header_size)
            elif op.opcode.operand_type.name == "InlineSwitch":
                operand = ["IL_%04x" % (v - body.header_size) for v in operand]
            elif operand is not None:
                operand = str(operand)
            ops.append([f"{op.offset-body.header_size:04x}", op.opcode.name, operand])
        return {"owner": self.label(self.owners[id(m)]), **self.method(m), "il": ops,
                "exceptionRegions": [{"kind": h.exception_type, "tryStart": h.try_start, "tryEnd": h.try_end,
                                      "handlerStart": h.handler_start, "handlerEnd": h.handler_end}
                                     for h in body.exception_handlers]}

    def identities(self):
        return {"file": self.path.name, "path": str(self.path), "sha256": digest(self.path.read_bytes()),
                "mvid": str(self.tables.Module.rows[0].Mvid)}


SURFACES = {
    "ScriptEngine.dll": r"^(IScript(Task|PouObjectCollection)|IScript(Object|TreeObject)$)",
    "ScriptDriverProjects.plugin.dll": r"^(ScriptTask.*|ScriptPouObjectList|PouObjectListExtensions|ScriptObject)$",
    "ScriptDriverApplicationComposer.plugin.dll": r"^ScriptModule(Std|Custom)TaskInfo$",
    "TaskConfig.dll": r"^I(Task(Object|POUCallObject)|PouObject(List)?)(\d+)?$",
    "TaskObject.plugin.dll": r"^(TaskObjectSynchronizer|PouObjectList|TaskPOUCallObject)$",
    "TaskEditor.plugin.dll": r"^TaskConfigWindow$",
    "InoTaskConfigObject.dll": r"^ITask.*",
    "InoTaskConfigObject.plugin.dll": r"^(.*Script.*|.*POUCallObject)$",
}
TRACES = {
    "ScriptObject": {"move"},
    "ScriptPouObjectList": {"get_Item", "get_PouObjectList", "PerformWithWriteableCopy"},
    "ScriptTaskObject": {"get_pous"},
    "TaskObjectSynchronizer": {"OnProjectStructureChanged", "TaskCallsEqualized", "EqualizeTaskCallList"},
    "TaskConfigWindow": {"OnMoveDownPOUCallButtonClicked", "OnMoveUpPOUCallButtonClicked"},
}
FOCUSED = re.compile(r"pou|move|sort|reorder|index", re.I)


def inspect(root):
    results = []
    drivers = sorted(p for p in root.rglob("ScriptDriver*.plugin.dll") if "resources" not in p.name.lower())
    named = {}
    for n in SURFACES:
        hits = [p for p in root.rglob(n) if p.name == n]
        if len(hits) != 1:
            raise ValueError(f"{n}: expected one installed artifact, found {hits}")
        named[n] = hits[0]
    for path in sorted(set(named.values()) | set(drivers)):
        a = Metadata(path)
        pattern = SURFACES.get(path.name)
        record = {**a.identities(), "surfaces": [], "traces": [],
                  "scriptExtensionsWithTaskOrCallNames": [], "rowContractReferences": []}
        for t in a.tables.TypeDef.rows:
            name = str(t.TypeName)
            hit = pattern is not None and re.search(pattern, name)
            if hit:
                ms = [e.row for e in t.MethodList]
                for m in ms:
                    if str(m.Name) in TRACES.get(name, set()) and m.Rva:
                        record["traces"].append(a.trace(m))
                focused = name in {"ScriptObject", "IScriptObject", "IScriptTreeObject", "TaskConfigWindow"}
                record["surfaces"].append({"name": a.label(t), "token": token(a.tokens[id(t)]),
                    "interfaces": a.inherited(t), "focused": focused, "declaredCount": len(ms),
                    "methods": [a.method(m) for m in ms if not focused or FOCUSED.search(str(m.Name))]})
            if path in drivers and re.search(r"(?:task|pouobjectlist|pouobjectcollection|poucall)", name, re.I):
                record["scriptExtensionsWithTaskOrCallNames"].append(a.label(t))
        if a.tables.TypeRef:
            record["rowContractReferences"] = [a.label(t) for t in a.tables.TypeRef.rows
                                                if str(t.TypeName) in {"IScriptPouObjectCollection", "IScriptTaskObject", "IPouObjectList"}]
        results.append(record)
        a.pe.close()
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("codesys", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = {"scope": "Static installed CLR definitions, inheritance and selected CIL, not an IDE invocation.",
              "readerVersions": {d: importlib.metadata.version(d) for d in ("dnfile", "dncil")},
              "artifacts": inspect(args.codesys)}
    with args.output.open("x", encoding="utf8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
