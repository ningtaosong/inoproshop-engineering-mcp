# -*- coding: utf-8 -*-
import io, sys, json
with io.open(r"D:\InoPro\docs\evidence\args-probe.json","w",encoding="utf-8") as f:
    f.write(unicode(json.dumps({"argv":list(sys.argv),"python":sys.version},ensure_ascii=False,indent=2)))
system.exit()
