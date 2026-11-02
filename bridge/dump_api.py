# -*- coding: utf-8 -*-
import io, json
import scriptengine
out = {"dump_doc": system.dump_scripting_api.__doc__, "create_doc": projects.create.__doc__, "prompt_doc": str(system.prompt_handling)}
try:
    out["prompt_names"] = dir(scriptengine.PromptHandling)
except Exception as e:
    out["error"] = str(e)
with io.open(r"D:\InoPro\docs\evidence\api-probe.json", "w", encoding="utf-8") as f:
    f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
system.dump_scripting_api(r"D:\InoPro\.local\scripting-api.txt")
