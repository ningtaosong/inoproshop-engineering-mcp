# -*- coding: utf-8 -*-
import io, json, traceback
import scriptengine
out = {}
def create():
    p = None
    try:
        p = projects.open(r"D:\InoPro\.local\sample\Phase1TinyUI.project", primary=True)
        p.add("TestController", 4102, "0000 0001", "3.5.11.10")
        out["objects"] = []
        def walk(parent, names):
            for x in parent.get_children(False):
                path = names + [unicode(x.get_name())]
                out["objects"].append({"path": path, "guid": str(x.guid), "application": bool(getattr(x, "is_application", False))})
                walk(x,path)
        walk(p,[])
        p.save()
    except Exception as e:
        out["error"] = unicode(e.clsException.ToString()) if hasattr(e, "clsException") else traceback.format_exc()
    finally:
        if p: p.close()
try:
    system.execute_on_primary_thread(create)
finally:
    with io.open(r"D:\InoPro\docs\evidence\tiny-device.json", "w", encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
    system.exit()
