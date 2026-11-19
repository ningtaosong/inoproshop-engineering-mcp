"""Check the saved metadata evidence, without IDE, project or write adapter."""
import argparse
import json
from collections import Counter
from pathlib import Path


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def check(record):
    artifacts = record["artifacts"]

    def single(items):
        (item,) = items
        return item

    def surface(dll, name):
        a = single(x for x in artifacts if x["file"] == dll)
        return single(t for t in a["surfaces"] if t["name"].split(".")[-1] == name)

    def traces(dll, owner, name):
        a = single(x for x in artifacts if x["file"] == dll)
        return [t for t in a["traces"] if t["owner"].endswith("." + owner) and t["name"] == name]

    def invokes(t):
        return [(i, str(v).split(" ", 1)[-1]) for i, op, v in t["il"] if op in ("callvirt", "call", "newobj")]

    def in_order(t, symbols):
        calls = iter(v for _, v in invokes(t))
        return all(any(v.endswith(symbol) for v in calls) for symbol in symbols)

    engine = "ScriptEngine.dll"
    driver = "ScriptDriverProjects.plugin.dll"
    collection = surface(engine, "IScriptPouObjectCollection")
    expected = Counter([
        ("add", "void (string, string)"), ("insert", "void (int32, string, string)"),
        ("replace", "void (int32, string, string)"), ("remove", "void (int32)"),
        ("remove", "void (string)"), ("__len__", "int32 ()"),
        ("get_Item", "System.Collections.Generic.IList`1<object> (int32)"),
    ])
    methods = Counter((m["name"], m["signature"]) for m in collection["methods"] if m["public"])
    require(not collection["focused"] and methods == expected, "review changed collection members")
    enumeration = {"System.Collections.Generic.IEnumerable`1<string>", "System.Collections.IEnumerable"}
    require(set(collection["interfaces"]) == enumeration, "review changed collection inheritance")
    task = surface(engine, "IScriptTaskObject")
    property_methods = [m for m in task["methods"] if m["name"] in ("get_pous", "set_pous")]
    require(len(property_methods) == 1 and property_methods[0]["signature"].endswith(".IScriptPouObjectCollection ()"),
            "review changed POUs property")
    concrete = surface(driver, "ScriptPouObjectList")
    require(Counter((m["name"], m["signature"]) for m in concrete["methods"] if m["public"]) ==
            expected + Counter({("GetEnumerator", "System.Collections.Generic.IEnumerator`1<string> ()"): 1}),
            "review changed concrete public methods")
    require(set(concrete["interfaces"]) == enumeration | {collection["name"]}, "review changed implementation interfaces")
    getter = single(traces(driver, "ScriptPouObjectList", "get_Item"))
    require(in_order(getter, ["IPouObjectList::get_Item", "IPouObject::get_Name", "IPouObject::get_Comment",
                              "IScriptEngine::CreatePythonTuple"]), "missing indexed row construction")
    moves = traces(driver, "ScriptObject", "move")
    require(len(moves) == 2 and all(in_order(t, ["IProjectStructure::FindNode", "IPSNode::Move"]) for t in moves),
            "review changed tree move semantics")
    sync = single(traces("TaskObject.plugin.dll", "TaskObjectSynchronizer", "EqualizeTaskCallList"))
    require(in_order(sync, ["IList::Clear", "PouObject::.ctor", "PouObject::set_Name", "PouObject::set_Id",
                            "PouObject::set_Comment", "IPouObjectList::Add", "IObjectManager::SetObject"]),
            "review changed synchronizer")
    for direction in ("Up", "Down"):
        fn = "OnMove" + direction + "POUCallButtonClicked"
        handler = single(traces("TaskEditor.plugin.dll", "TaskConfigWindow", fn))
        require(handler["private"] and in_order(handler, ["GetSelectedPOUNodes", "GetTaskToModify", "GetPOUIndex",
                "IPouObjectList::get_Item", "IPouObjectList::Remove", "IPouObjectList::Insert", "IObjectManager::SetObject"]),
                "review changed editor handler")
    return {"checked": ["public collection signatures", "inherited enumerable interfaces", "task.pous getter",
                        "concrete public methods and interfaces", "indexed name/comment tuple",
                        "both tree move overloads", "task list rebuild", "private editor up/down handlers"],
            "conclusion": "No qualifying public row move established on the inspected surface."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    args = parser.parse_args()
    print(json.dumps(check(json.loads(args.metadata.read_text("utf8"))), indent=2))


if __name__ == "__main__":
    main()
