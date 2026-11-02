# -*- coding: utf-8 -*-
import io, json, traceback
import scriptengine
out = {}
def check():
    p = None
    try:
        p = projects.create(r"D:\InoPro\.local\sample\LanguageProbe.project",primary=True)
        out["languages"] = []
        for name,language in [("ST",scriptengine.ImplementationLanguages.st),("IL",scriptengine.ImplementationLanguages.il)]:
            item = p.create_pou("F_Test"+name,scriptengine.PouType.Function,language,"INT")
            row = {"language":name,"hasTextualImplementation":bool(item.has_textual_implementation),"exportDoc":item.export_xml.__doc__}
            try:
                row["xml"] = unicode(item.export_xml())
            except Exception as e:
                row["exportError"] = unicode(e)
            out["languages"].append(row)
        p.save()
    except Exception as e:
        out["error"] = unicode(e.clsException.ToString()) if hasattr(e,"clsException") else traceback.format_exc()
    finally:
        with io.open(r"D:\InoPro\docs\evidence\language-probe.json","w",encoding="utf-8") as f:
            f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
        if p: p.close()
system.execute_on_primary_thread(check)
system.exit()
