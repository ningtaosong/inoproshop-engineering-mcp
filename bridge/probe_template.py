# -*- coding: utf-8 -*-
import io, json, traceback
out = {}
p = None
try:
    p = projects.open(r"D:\InoPro\.local\sample\Standard.project", primary=True)
    out["objects"] = []
    def walk(parent, path):
        for x in parent.get_children(False):
            names = path + [unicode(x.get_name())]
            r = {"path": names, "guid": str(x.guid)}
            for key in ("is_application", "has_textual_declaration", "has_textual_implementation", "compiler_version", "build", "clean", "generate_code"):
                if hasattr(x, key):
                    value = getattr(x, key)
                    r[key] = unicode(value.__doc__) if callable(value) else unicode(value)
            out["objects"].append(r)
            walk(x, names)
    walk(p, [])
    out["close_doc"] = p.close.__doc__
except Exception as e:
    out["error"] = unicode(e.clsException.ToString()) if hasattr(e, "clsException") else traceback.format_exc()
finally:
    with io.open(r"D:\InoPro\docs\evidence\template-inspect.json", "w", encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
    if p: p.close()
    system.exit()
