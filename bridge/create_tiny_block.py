# -*- coding: utf-8 -*-
"""独立硬件无关小块探测，避免缺失旧样例设备依赖；不属于产品工具入口。"""
import io, json, traceback, os
import scriptengine
out = {}
def publish():
    with io.open(r"D:\InoPro\docs\evidence\tiny-block.json","w",encoding="utf-8") as f:
        f.write(unicode(json.dumps(out,ensure_ascii=False,indent=2)))
def create():
    p = None
    try:
        if os.path.exists(r"D:\InoPro\.local\sample\Phase1Block.project"):
            out["existingPreserved"] = True
            return
        p = projects.create(r"D:\InoPro\.local\sample\Phase1Block.project", primary=True)
        out["created"] = True
        publish()
        pou = p.create_pou("F_Phase1AddOne", scriptengine.PouType.Function, scriptengine.ImplementationLanguages.st, "INT")
        pou.textual_declaration.replace(u"FUNCTION F_Phase1AddOne : INT\nVAR_INPUT\n    Value : INT;\nEND_VAR")
        pou.textual_implementation.replace(u"// 硬件无关小块：输入加一\nF_Phase1AddOne := Value + 1;")
        out["objectId"] = str(pou.guid)
        out["declaration"] = unicode(pou.textual_declaration.text)
        out["implementation"] = unicode(pou.textual_implementation.text)
        out["factories"] = dir(system.factories)
        out["check_doc"] = p.check_all_pool_objects.__doc__ if hasattr(p,"check_all_pool_objects") else None
        publish()
        p.save()
        out["saved"] = True
        if hasattr(p,"check_all_pool_objects"):
            p.check_all_pool_objects()
            out["checked"] = True
        out["messages"] = [{"category":str(c),"messages":[{"severity":str(m.severity),"text":unicode(m.text)} for m in system.get_message_objects(c)]} for c in system.get_message_categories(False)]
        p.close()
        p = projects.open(r"D:\InoPro\.local\sample\Phase1Block.project",primary=True)
        reopened = [x for x in p.get_children(False) if str(x.guid)==out["objectId"]][0]
        out["reopenedImplementation"] = unicode(reopened.textual_implementation.text)
        out["reopened"] = out["reopenedImplementation"] == out["implementation"]
    except Exception as e:
        out["error"] = unicode(e.clsException.ToString()) if hasattr(e,"clsException") else traceback.format_exc()
    finally:
        publish()
        if p: p.close()
system.execute_on_primary_thread(create)
system.exit()
