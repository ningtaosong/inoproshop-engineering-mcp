# -*- coding: utf-8 -*-
import io
import json
import traceback
import scriptengine

out = {}
project = None
try:
    out["open_doc"] = projects.open.__doc__
    project = projects.open(r"D:\InoPro\.local\sample\002_Marquee(ST).project", primary=True)
    out["project_members"] = dir(project)
    out["project_path"] = str(project.path)
    out["objects"] = []
    def walk(parent, path):
        for item in parent.get_children(False):
            name = item.get_name()
            p = path + [name]
            row = {"path": p, "guid": str(item.guid), "members": dir(item)}
            if hasattr(item, "textual_declaration"):
                row["declaration"] = item.textual_declaration.text
            if hasattr(item, "textual_implementation"):
                row["implementation"] = item.textual_implementation.text
                row["text_members"] = dir(item.textual_implementation)
            if hasattr(item, "is_application") and item.is_application:
                row["application"] = True
            out["objects"].append(row)
            walk(item, p)
    walk(project, [])
    out["categories"] = [{"id": str(c), "description": system.get_message_category_description(c)} for c in system.get_message_categories()]
except Exception as e:
    out["error"] = traceback.format_exc()
    out["dotnet_error"] = str(e.clsException.ToString()) if hasattr(e, "clsException") else str(e)
    out["messages"] = []
    for c in system.get_message_categories():
        out["messages"].append({"category": str(c), "messages": [str(m) for m in system.get_messages(c)]})
finally:
    with io.open(r"D:\InoPro\docs\evidence\sample-inspect.json", "w", encoding="utf-8") as f:
        f.write(unicode(json.dumps(out, ensure_ascii=False, indent=2)))
    if project:
        project.close()
    system.exit()
