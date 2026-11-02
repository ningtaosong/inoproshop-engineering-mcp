# -*- coding: utf-8 -*-
"""一次性创建可丢弃测试工程；仅由开发验收显式启动，不是 MCP 通用执行工具。"""
import io, json, traceback
import scriptengine
out = {}
p = None
def create():
    global p
    p = projects.create(r"D:\InoPro\.local\sample\Phase1TinyUI.project", primary=True)
    out["created"] = True
    out["add_doc"] = p.add.__doc__ if hasattr(p, "add") else None
    out["create_pou_doc"] = p.create_pou.__doc__ if hasattr(p, "create_pou") else None
    out["repository_members"] = dir(scriptengine.device_repository) if hasattr(scriptengine, "device_repository") else []
    out["device_id_doc"] = scriptengine.DeviceID.__doc__ if hasattr(scriptengine, "DeviceID") else None
    p.save()
    p.close()
    p = None
try:
    out["main_thread_doc"] = system.execute_on_primary_thread.__doc__
    system.execute_on_primary_thread(create)
except Exception as e:
    out["error"] = unicode(e.clsException.ToString()) if hasattr(e, "clsException") else traceback.format_exc()
finally:
    with io.open(r"D:\InoPro\docs\evidence\tiny-create.json", "w", encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
    if p: p.close()
    system.exit()
