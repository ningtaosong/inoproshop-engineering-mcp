# -*- coding: utf-8 -*-
"""只读探测；不打开或修改用户工程。兼容 IronPython 2.7。"""
import sys
import json
import io
import traceback

result = {"python": sys.version, "argv": list(sys.argv)}
try:
    result["system_members"] = list(dir(system))
    result["projects_members"] = list(dir(projects))
    result["application_members"] = list(dir(application)) if "application" in globals() else []
    result["scriptengine_members"] = list(dir(scriptengine)) if "scriptengine" in globals() else []
    result["primary"] = str(projects.primary)
except Exception:
    result["error"] = traceback.format_exc()
with io.open(r"D:\InoPro\docs\evidence\ide-probe.json", "w", encoding="utf-8") as stream:
    stream.write(unicode(json.dumps(result, ensure_ascii=False, indent=2)))
