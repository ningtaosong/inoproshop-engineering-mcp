# -*- coding: utf-8 -*-
import io, json, traceback, os
import scriptengine
out = {}
evidence = r"D:\InoPro\docs\evidence\tiny-am521.json"
def publish():
    with io.open(evidence,"w",encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
def create():
    p = None
    try:
        p = projects.create(r"D:\InoPro\.local\sample\Phase1AM521.project", primary=True)
        out["created"] = True
        publish()
        p.add("TestController", 4102, "10f4 0051", "3.5.11.50")
        out["deviceAdded"] = True
        out["objects"] = []
        def walk(parent, names):
            for x in parent.get_children(False):
                path = names + [unicode(x.get_name())]
                out["objects"].append({"path":path,"guid":str(x.guid),"application":bool(getattr(x,"is_application",False))})
                walk(x,path)
        walk(p,[])
        publish()
        p.save()
        out["saved"] = True
    except Exception as e:
        out["error"] = unicode(e.clsException.ToString()) if hasattr(e,"clsException") else traceback.format_exc()
    finally:
        publish()
        if p: p.close()
system.execute_on_primary_thread(create)
system.exit()
