# -*- coding: utf-8 -*-
import io, json, traceback
out = {"mode":"real-ide-pool-check", "checks":[]}
def publish():
    with io.open(r"D:\InoPro\docs\evidence\tiny-block-validation.json","w",encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
def collect():
    rows = []
    for c in system.get_message_categories():
        try:
            rows.append({"category":str(c),"messages":[{"severity":str(m.severity),"text":unicode(m.text)} for m in system.get_message_objects(c)]})
        except Exception as e: rows.append({"category":str(c),"error":unicode(e)})
    return rows
def validate():
    p = None
    try:
        p = projects.open(r"D:\InoPro\.local\sample\Phase1Block.project",primary=True)
        pou = [x for x in p.get_children(False) if x.get_name()=="F_Phase1AddOne"][0]
        original = unicode(pou.textual_implementation.text)
        out["readImplementation"] = original
        for label,code in [("baseline",original),("syntax-error",u"F_Phase1AddOne := ;"),("fixed",original+u"\n// 已修改并重新打开确认。")]:
            for c in system.get_message_categories(): system.clear_messages(c)
            pou.textual_implementation.replace(code)
            result = p.check_all_pool_objects()
            out["checks"].append({"label":label,"returnValue":str(result),"categories":collect()})
            publish()
        p.save()
        expected = unicode(pou.textual_implementation.text)
        p.close()
        p = projects.open(r"D:\InoPro\.local\sample\Phase1Block.project",primary=True)
        reopened = [x for x in p.get_children(False) if x.get_name()=="F_Phase1AddOne"][0]
        out["reopenedImplementation"] = unicode(reopened.textual_implementation.text)
        out["savedAndReopened"] = out["reopenedImplementation"]==expected
    except Exception as e:
        out["error"] = unicode(e.clsException.ToString()) if hasattr(e,"clsException") else traceback.format_exc()
    finally:
        publish()
        if p: p.close()
system.execute_on_primary_thread(validate)
system.exit()
