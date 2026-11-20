"""File-backed CLR metadata/CIL inventory only. Never load OEM code or open projects.
Uses the existing metadata reader and caller-supplied dnfile/dncil installation.
A public CLR member is not a proven ScriptEngine runtime endpoint.
"""
import argparse
import json
import re
import runpy
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--install", type=Path, required=True)
    p.add_argument("--dependencies", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    if args.out.exists():
        raise ValueError("OUTPUT_MUST_BE_NEW")
    sys.path.insert(0, str(args.dependencies))
    Metadata = runpy.run_path(str(Path(__file__).with_name("task-call-reorder-metadata.py")))["Metadata"]
    paths = [args.install / ("Common/" + n) for n in
             ("ScriptEngine.dll", "DeviceEditorEthercat.dll", "InoDeviceEditorEthercat.dll", "EthercatModularDevice.dll")]
    paths += sorted((args.install / "PlugIns").rglob("ScriptDriver*.plugin.dll"))
    paths += sorted((args.install / "PlugIns").rglob("*Ethercat.plugin.dll"))
    records = []
    traces = []
    choose = {
        "EthercatProcessDataPage": {"get_PDOItems", "get_Editor", "GetHost"},
        "SyncManager": {"GetNumberofSyncManagers", "GetSyncManagersFromDevice"},
        "EL6224Provider": {"CreateProfile", "get_PDOList"},
        "Common": {"GetSlaveConnector", "GetParemId"},
    }
    for path in paths:
        a = Metadata(path)
        try:
            types = []
            for t in a.tables.TypeDef.rows:
                methods = [i.row for i in t.MethodList]
                named = re.search(r"(Pdo|Ethercat|SyncManager|ProcessData)", a.label(t), re.I)
                selected = methods if named else [m for m in methods if
                    re.search(r"(Pdo|Ethercat|SyncManager|ProcessData)", str(m.Name), re.I)]
                if selected:
                    types.append(dict(name=a.label(t), public=bool(t.Flags.tdPublic),
                                      interface=bool(t.Flags.tdInterface), inherited=a.inherited(t),
                                      methods=[a.method(m) for m in selected]))
                if path.name == "InoDeviceEditorEthercat.plugin.dll":
                    traces.extend(a.trace(m) for m in methods if str(m.Name) in choose.get(str(t.TypeName), set()))
            records.append(dict(artifact=a.identities(), types=types))
        finally:
            a.pe.close()
    result = dict(assemblies=records, oemSelectedTraces=traces, executedTarget=False,
                  scope="bounded names and selected file-backed CIL; no proof of runtime script callability")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(dict(assemblies=len(records), selectedTraces=len(traces), targetExecuted=False)))


if __name__ == "__main__":
    main()
