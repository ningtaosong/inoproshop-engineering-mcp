# -*- coding: utf-8 -*-
"""固定命令的批处理桥接。IronPython 2.7；不执行传入脚本，不接入 PLC。"""
import io
import os
import sys
import json
import hashlib
import shutil
import traceback
import re
import scriptengine

CONTRACT = "1.0.0"

def text(value):
    return unicode(value)

def normalize(value):
    return value.replace(u"\r\n", u"\n").replace(u"\r", u"\n")

def sha(value):
    if isinstance(value, unicode):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

def content_hash(declaration, implementation):
    return sha(encode([normalize(declaration), normalize(implementation)]))

def file_hash(file_path):
    # IronPython binary str may satisfy isinstance(value, unicode); never text-encode project bytes.
    with open(file_path,"rb") as stream:return hashlib.sha256(stream.read()).hexdigest()

def publish(file_path, value):
    # 新操作目录仅发布一次结果；Move 在同一卷内原子发布，不覆盖半写结果。
    temp = file_path + ".tmp"
    from System.IO import File, FileStream, FileMode, FileAccess, FileShare
    from System.Text import UTF8Encoding
    File.WriteAllText(temp, text(json.dumps(value, ensure_ascii=False, indent=2)), UTF8Encoding(False))
    stream = FileStream(temp, FileMode.Open, FileAccess.ReadWrite, getattr(FileShare, "None"))
    try:
        stream.Flush(True)
    finally:
        stream.Dispose()
    File.Move(temp, file_path)

def success(summary, data):
    return {"contractVersion": CONTRACT, "status": "succeeded", "summary": summary, "data": data}

def failure(status, code, message, data=None):
    r = {"contractVersion": CONTRACT, "status": status, "summary": message, "error": {"code": code, "message": message}}
    if data is not None:
        r["data"] = data
    return r

def native_children(parent):
    return parent.get_children(False)

def walk(parent, names=None, application_id=None):
    names = names or []
    for item in native_children(parent):
        current = names + [text(item.get_name())]
        app_id = text(item.guid).lower() if getattr(item, "is_application", False) else application_id
        yield item, current, app_id
        for row in walk(item, current, app_id):
            yield row

def st_object(item):
    # 真实 POU 类型白名单；方法/属性及任意声明对象不因有文本而成为可编辑对象。
    return bool(text(item.type).lower()=="6f9dac99-8de1-4efc-8465-68ac443b7d08" and
                getattr(item, "has_textual_declaration", False) and getattr(item, "has_textual_implementation", False))

def declaration_code(source):
    # Ordered masking, mirrored in contracts.ts. Quotes in comments are inert;
    # strings hide comment markers, but remain opaque tokens, never whitespace.
    # Balanced nested blocks accepted; unclosed tokens/stray block ends rejected.
    out=[];i=0
    while i<len(source):
        pair=source[i:i+2];char=source[i]
        if pair=='//':
            i+=2
            while i<len(source) and source[i] not in '\r\n':i+=1
            out.append(' ')
        elif pair=='(*':
            depth=1;i+=2
            while i<len(source) and depth:
                nested=source[i:i+2]
                if nested=='(*':depth+=1;i+=2
                elif nested=='*)':depth-=1;i+=2
                else:i+=1
            if depth:return None
            out.append(' ')
        elif pair=='*)':return None
        elif char in "'\"":
            quote=char;closed=False;i+=1
            while i<len(source):
                if source[i]=='$':
                    if i+1>=len(source):return None
                    i+=2
                elif source[i]==quote:
                    if source[i+1:i+2]==quote:i+=2
                    else:i+=1;closed=True;break
                else:i+=1
            if not closed:return None
            out.append(quote+'literal'+quote)
        else:out.append(char);i+=1
    return ''.join(out)

def array_bounds(name,declaration):
    source=declaration_code(declaration)
    if source is None:return None
    source=source.strip()
    match=re.match(r"^TYPE\s+([A-Za-z_][A-Za-z0-9_]{0,62})\s*:\s*ARRAY\s*\[\s*([+-]?[0-9]+)\s*\.\.\s*([+-]?[0-9]+)\s*\]\s+OF\s+DINT\s*;\s*END_TYPE\s*$",source,re.I)
    if not match or match.group(1).lower()!=name.lower():return None
    low,high=int(match.group(2)),int(match.group(3))
    return (low,high) if 0<=low<=high<=255 and high-low+1<=256 else None

def declaration_matches(kind, name, declaration, writing=False):
    source = declaration_code(declaration)
    if source is None:return False
    if (kind=="array" or kind=="enum" and writing) and re.search(r"[{}]",source):return False
    source = re.sub(r"\{[^{}]*\}", " ", source).strip()
    if kind=="gvl":
        return bool(re.match(r"^VAR_GLOBAL\b[\s\S]*\bEND_VAR\s*$",source,re.I) and not re.search(r"\b(TYPE|END_TYPE|STRUCT|END_STRUCT|UNION|END_UNION|PROGRAM|FUNCTION_BLOCK|FUNCTION)\b",source,re.I))
    if kind=="array":return array_bounds(name,declaration) is not None
    if kind=="enum":
        match=re.match(r"^TYPE\s+([A-Za-z_][A-Za-z0-9_]{0,62})\s*:\s*\(([\s\S]*)\)\s*;\s*END_TYPE\s*$",source,re.I)
        if not match or match.group(1).lower()!=name.lower():return False
        names,values=set(),set()
        for part in match.group(2).split(','):
            member=re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]{0,62})\s*:=\s*([+-]?[0-9]+)\s*$",part)
            if not member:return False
            value=int(member.group(2));key=member.group(1).lower()
            if not -32768<=value<=32767 or key in names or value in values:return False
            names.add(key);values.add(value)
        return bool(names)
    match = re.match(r"^TYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*STRUCT\b[\s\S]*\bEND_STRUCT\s*END_TYPE\s*$",source,re.I)
    return bool(kind=="structure" and match and match.group(1).lower()==name.lower() and not re.search(r"\b(UNION|END_UNION|EXTENDS|VAR_GLOBAL)\b",source,re.I) and len(re.findall(r"\bSTRUCT\b",source,re.I))==1)

def object_kind(item):
    if st_object(item):return "function_block" if function_block_name(text(item.textual_declaration.text)) else "st_pou"
    if not getattr(item,"has_textual_declaration",False) or getattr(item,"has_textual_implementation",False):return None
    native = text(item.type).lower()
    kind = {"ffbfa93a-b94d-45fc-a329-229860183b1d":"gvl","2db5746d-d284-4425-9f7f-2663a34b0ebc":"structure"}.get(native)
    if kind=="structure" and declaration_matches("array",text(item.get_name()),text(item.textual_declaration.text)):return "array"
    if kind=="structure" and declaration_matches("enum",text(item.get_name()),text(item.textual_declaration.text)):return "enum"
    return kind if kind and declaration_matches(kind,text(item.get_name()),text(item.textual_declaration.text)) else None

def editable(project,item,aid):
    kind = object_kind(item)
    if kind in ("gvl","structure","enum","array"):
        # 本轮声明类对象仅精确 Application 直接根节点，不包括池/文件夹。
        return aid is not None and any(text(x.guid).lower()==text(item.guid).lower() for x in application(project,aid).get_children(False))
    return kind is not None

def read_object(item, names, app_id):
    d = normalize(text(item.textual_declaration.text))
    i = normalize(text(item.textual_implementation.text)) if getattr(item,"has_textual_implementation",False) else ""
    result = {"objectId": text(item.guid).lower(), "applicationId": app_id, "path": names,
            "language": "ST", "objectType":object_kind(item),"hasImplementation":bool(getattr(item,"has_textual_implementation",False)),
            "nativeTypeId":text(item.type).lower(),"declaration": d, "implementation": i, "contentHash": content_hash(d, i)}
    result.update(pou_fields(item))
    return result

def snapshot(project):
    # 所有可读取文本对象，含其他 Application、GVL/DUT；文件哈希额外绑定非文本配置。
    rows = []
    for item, names, app_id in walk(project):
        d = normalize(text(item.textual_declaration.text)) if getattr(item, "has_textual_declaration", False) else None
        i = normalize(text(item.textual_implementation.text)) if getattr(item, "has_textual_implementation", False) else None
        # 编译器生成的非持久辅助节点不进入文本快照；完整工程另由 diskHash 绑定。
        if d is not None or i is not None:
            rows.append([text(item.guid).lower(), names, app_id, d, i])
    rows.sort(key=lambda r: r[0])
    return sha(encode(rows))

def application(project, app_id, target_kind="application"):
    if target_kind == "pool":
        if app_id is not None or any(getattr(item, "is_application", False) for item, names, aid in walk(project)):
            raise ValueError("Pool build requires applicationId=null and no Application objects")
        if not hasattr(project, "check_all_pool_objects"):
            raise ValueError("Pool check API unavailable")
        return project
    matches = [item for item, names, aid in walk(project) if text(item.guid).lower() == app_id and getattr(item, "is_application", False)]
    if len(matches) != 1:
        raise ValueError("Application GUID must match exactly one application")
    return matches[0]

def locate(project, app_id, object_id):
    matches = [(item, names, aid) for item, names, aid in walk(project)
               if aid == app_id and text(item.guid).lower() == object_id and editable(project,item,aid)]
    if len(matches) != 1:
        raise ValueError("Supported ST POU / root GVL / structure, enum or array DUT GUID not found in selected Application")
    return matches[0]

def metadata(project):
    apps, devices, libraries = [], [], []
    for item, names, aid in walk(project):
        if getattr(item, "is_application", False):
            row = {"applicationId": aid, "path": names}
            for key in ("compiler_version", "compiler_version_string"):
                if hasattr(item, key):
                    row[key] = text(getattr(item, key))
            apps.append(row)
        if getattr(item, "is_device", False):
            row = {"path": names, "objectId": text(item.guid).lower()}
            try:
                ident = item.get_device_identification()
                row["identification"] = {k: text(getattr(ident, k)) for k in ("type", "id", "version") if hasattr(ident, k)}
            except Exception as e:
                row["unverified"] = text(e)
            devices.append(row)
        if hasattr(item, "get_libraries"):
            try:
                libraries.extend([text(lib) for lib in item.get_libraries()])
            except Exception as e:
                libraries.append({"path": names, "unverified": text(e)})
    pool = not apps and hasattr(project, "check_all_pool_objects") and any(st_object(item) for item, names, aid in walk(project))
    return {"applications": apps, "poolBuildAvailable": pool, "devices": devices, "libraries": libraries,
            "compilerVersion": {"status": "unverified", "reason": "compiler version is not exposed by the inspected scripting members; engine version is separate"},
            "python": sys.version, "snapshot": snapshot(project), "projectPath": text(project.path)}

def query_rows(project, args):
    app = application(project,args["applicationId"],args.get("targetKind","application"))
    prefix = []
    if args["applicationId"] is not None:
        prefix = next(names for item,names,aid in walk(project) if text(item.guid).lower()==args["applicationId"])
    rows, errors = [], []
    try:
        for item,names,aid in walk(app,prefix,args["applicationId"]):
            if aid==args["applicationId"]:rows.append((item,names,aid))
    except Exception as error:errors.append({"path":prefix,"stage":"enumeration","reason":text(error)})
    return app,prefix,rows,errors

def library_inventory(project,args):
    # Verified on 1.9.1.6: IScriptLibManObject.references enumerates direct
    # IScriptLibraryReference entries. get_libraries() only returns strings.
    app,prefix,rows,errors = query_rows(project,args)
    managers,entries = [],[]
    candidates=[]
    for item,names,aid in rows:
        try:
            if text(item.type).lower()=="adb5cb65-8e1d-4a00-b70a-375ea27582f3":
                candidates.append((item,names,aid))
        except Exception as e:errors.append({"path":names,"stage":"manager-identification","reason":text(e)})
    candidates.sort(key=lambda row:(row[1],text(row[0].guid)))
    truncated=False
    for item,names,aid in candidates:
        manager={"managerId":text(item.guid).lower(),"path":names,"nativeTypeId":text(item.type).lower(),
          "enumerationComplete":False,"capturedReferences":0,"unavailableFields":[]}
        managers.append(manager)
        try:
            if item.is_libman is not True:raise ValueError("Native manager marker not confirmed")
            for order,ref in enumerate(item.references):
                if len(entries)>=args["maxReferences"]:
                    truncated=True;break
                fields={};issues=[]
                def field(key,boolean=False):
                    try:
                        value=getattr(ref,key)
                        if value is not None and boolean and not isinstance(value,bool):raise ValueError("Expected native Boolean")
                        fields[key]=None if value is None else bool(value) if boolean else text(value)
                    except Exception as e:
                        fields[key]=None;issues.append({"field":key,"reason":text(e)})
                for key in ("id","name","namespace"):field(key)
                for key in ("is_placeholder","is_managed","system_library","optional","qualified_only"):field(key,True)
                if fields["is_placeholder"] is True:
                    for key in ("placeholder_name","default_resolution","effective_resolution","resolution_info","resolver_guid"):field(key)
                    field("is_redirected",True)
                entries.append({"index":len(entries),"parentIndex":None,"managerId":manager["managerId"],"managerPath":names,
                  "order":order,"path":names+["references",text(order)],"rawFields":fields,"unavailableFields":issues,
                  "resolutionStatus":"effective-resolution-reported" if fields.get("effective_resolution") else "unknown",
                  "resolutionBasis":"Native effective_resolution string only; not an independent loaded/missing flag",
                  "installedStatus":"not-queried"})
                manager["capturedReferences"]+=1
            else:manager["enumerationComplete"]=True
        except Exception as e:manager["unavailableFields"].append({"field":"references","reason":text(e)})
    enumeration_complete=not errors and not truncated and all(m["enumerationComplete"] for m in managers)
    return {"projectId":args["projectId"],"applicationId":args["applicationId"],"targetKind":"application",
      "projectPath":text(project.path),"applicationPath":prefix,"managers":managers,"references":entries,
      "scope":{"description":"Direct references of each native library manager in the exact Application; no recursive dependencies or installed repository query",
        "maxReferences":args["maxReferences"],"capturedReferences":len(entries),"enumerationComplete":enumeration_complete,
        "fieldReadComplete":not any(m["unavailableFields"] for m in managers) and not any(r["unavailableFields"] for r in entries),
        "truncated":truncated,"enumerationFailures":errors},
      "unavailableMetadata":["Independent declared version/constraint and vendor getters not verified: retain native name/default_resolution strings without parsing",
        "Independent resolved version/library-loaded-or-missing flag not verified: retain effective_resolution and resolution_info strings",
        "Non-placeholder references have no verified placeholder resolution getters; status remains unknown"],
      "limitations":["Not a complete transitive dependency tree","Installed, referenced and resolved are different facts",
        "No active resolve/repair/install/download/build/save call","Absence of CmpLog from direct references does not rule out indirect dependencies or resolve a historical compiler warning"]}


def search_inventory(project,args):
    app,prefix,rows,errors = query_rows(project,args)
    corpus,skipped,failed = [],[],[]
    direct = set(text(x.guid).lower() for x,n,aid in rows if len(n)==len(prefix)+1)
    eligible = 0
    for item,names,aid in rows:
        row = {"objectId":text(item.guid).lower(),"path":names}
        try:
            native = text(item.type).lower()
            row["nativeTypeId"]=native
            if native not in ("6f9dac99-8de1-4efc-8465-68ac443b7d08","ffbfa93a-b94d-45fc-a329-229860183b1d","2db5746d-d284-4425-9f7f-2663a34b0ebc"):
                skipped.append(dict(row,stage="unsupported-type",reason="Not a supported POU/GVL/structure/enum/array native type"));continue
            if native!="6f9dac99-8de1-4efc-8465-68ac443b7d08" and (aid is None or row["objectId"] not in direct):
                skipped.append(dict(row,stage="unsupported-location",reason="Declaration object is not an exact Application root child"));continue
            eligible += 1
            if object_kind(item) is None:
                eligible -= 1;skipped.append(dict(row,stage="unsupported-form",reason="No supported textual POU or structure/enum/array/GVL declaration form"));continue
            corpus.append(read_object(item,names,aid))
        except Exception as error:failed.append(dict(row,stage="object-read",reason=text(error)))
    corpus.sort(key=lambda x:x["objectId"])
    for values in (skipped,failed):values.sort(key=lambda x:x["objectId"])
    return {"projectId":args["projectId"],"applicationId":args["applicationId"],"targetKind":args.get("targetKind","application"),"projectPath":text(project.path),"corpus":corpus,
      "scope":{"description":"Only currently supported readable ST POU and exact Application-root GVL/structure/enum/array; not all engineering objects or semantic references",
      "applicationPath":prefix,"treeComplete":not errors,"eligibleObjects":eligible,"readObjects":len(corpus),"coverageComplete":not errors and not failed,
      "skippedObjects":skipped,"readFailures":failed,"enumerationFailures":errors}}

def task_inventory(project,args):
    app,prefix,rows,errors = query_rows(project,args)
    tasks,programs,failures = [],[],[]
    fields = ("kind_of_task","priority","interval","interval_unit","event_pou_guid","event","external_event","core_binding","parent_synchron_task")
    for item,names,aid in rows:
        if getattr(item,"is_task",False):
            task={"taskId":text(item.guid).lower(),"path":names,"rawFields":{},"watchdog":{},"unavailableFields":[],"rawCalls":[],"callsComplete":True}
            for field in fields:
                try:task["rawFields"][field]=text(getattr(item,field))
                except Exception as error:task["unavailableFields"].append({"field":field,"reason":text(error)})
            for field in ("enabled","time","time_unit","sensitivity"):
                try:task["watchdog"][field]=text(getattr(item.watchdog,field))
                except Exception as error:task["unavailableFields"].append({"field":"watchdog."+field,"reason":text(error)})
            try:
                calls=item.pous
                for index in range(len(calls)):task["rawCalls"].append([text(v) for v in calls[index]])
            except Exception as error:
                task["callsComplete"]=False;task["unavailableFields"].append({"field":"pous","reason":text(error)})
            tasks.append(task)
        if text(item.type).lower()=="6f9dac99-8de1-4efc-8465-68ac443b7d08":
            try:
                if getattr(item,"has_textual_declaration",False):
                    declaration=re.sub(r"\(\*.*?\*\)"," ",text(item.textual_declaration.text),flags=re.S)
                    declaration=re.sub(r"//[^\r\n]*"," ",declaration)
                    declaration=re.sub(r"\{[^{}]*\}"," ",declaration)
                    match=re.match(r"\s*PROGRAM\s+([A-Za-z_][A-Za-z0-9_]*)\b",declaration,re.I)
                    if match and match.group(1).lower()==text(item.get_name()).lower():programs.append({"objectId":text(item.guid).lower(),"path":names})
                else:failures.append({"objectId":text(item.guid).lower(),"path":names,"stage":"program-resolution-read","reason":"Native POU has no readable PROGRAM declaration; identity resolution incomplete"})
            except Exception as error:failures.append({"objectId":text(item.guid).lower(),"path":names,"stage":"program-resolution-read","reason":text(error)})
    return {"projectId":args["projectId"],"applicationId":args["applicationId"],"targetKind":"application","projectPath":text(project.path),"applicationPath":prefix,
      "tasks":tasks,"programs":programs,"resolutionReadFailures":failures,"enumerationFailures":errors,
      "coverageComplete":not errors and not failures and not any(t["unavailableFields"] for t in tasks)}

def task_configuration_version(inventory):
    return sha(encode(['task-configuration-v1',inventory['projectId'],inventory['applicationId'],
        sorted(inventory['tasks'],key=lambda t:t['taskId']),inventory['enumerationFailures']]))

def configured_interval_ms(fields):
    if fields.get('interval_unit')!='ms':return None
    match=re.match(r'^(?:t#([0-9]+)ms|([0-9]+))$',fields.get('interval',''),re.I)
    return int(match.group(1) or match.group(2)) if match else None

def task_config_update(project,req,args,state):
    """Existing Cyclic task only. No task factories, calls/watchdog/CPU writes or rollback."""
    allowed=set(('requestId','projectId','targetKind','applicationId','taskId','expectedTaskVersion','expectedDiskHash','intervalMs','priority'))
    for key,low,high in [('intervalMs',1,60000),('priority',0,31)]:
        if key in args and (isinstance(args[key],bool) or not isinstance(args[key],(int,long)) or not low<=args[key]<=high):
            return failure('failed','INVALID_TASK_PATCH',u'仅支持整数毫秒1..60000及整数优先级0..31'),project
    if set(args)-allowed or not any(k in args for k in ('intervalMs','priority')):
        return failure('failed','INVALID_TASK_PATCH',u'仅允许周期和优先级，至少提供一项'),project
    before=task_inventory(project,args)
    version=task_configuration_version(before)
    if version!=args['expectedTaskVersion']:
        return failure('conflict','TASK_VERSION_CHANGED',u'实际任务配置与原版本不符，未写入',{'configurationVersion':version}),project
    if file_hash(req['projectPath'])!=args['expectedDiskHash']:
        return failure('conflict','TASK_DISK_CHANGED',u'磁盘工程与预期不符，未写入'),project
    matches=[t for t in before['tasks'] if t['taskId']==args['taskId']]
    native=[x for x,n,aid in walk(project) if aid==args['applicationId'] and text(x.guid).lower()==args['taskId'] and getattr(x,'is_task',False)]
    if len(matches)!=1 or len(native)!=1:
        return failure('conflict','TASK_NOT_UNIQUE',u'精确Application内任务身份不唯一，未写入'),project
    row=matches[0];fields=row['rawFields']
    required=set(('kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task'))
    if before['enumerationFailures'] or any(t['unavailableFields'] or not t['callsComplete'] or not required.issubset(t['rawFields']) or not set(('enabled','time','time_unit','sensitivity')).issubset(t['watchdog']) for t in before['tasks']):
        return failure('unsupported','TASK_CONFIGURATION_INCOMPLETE',u'原生任务字段或枚举不完整，未写入'),project
    if fields.get('kind_of_task')!='Cyclic':
        return failure('unsupported','TASK_NOT_CYCLIC',u'只支持已有周期型任务，未写入'),project
    old_interval=configured_interval_ms(fields)
    if old_interval is None or not re.match(r'^[0-9]+$',fields.get('priority','')):
        return failure('unsupported','TASK_UNITS_UNCONFIRMED',u'原周期单位或优先级文本无法可靠解释，未写入'),project
    if not 1<=old_interval<=60000 or not 0<=int(fields['priority'])<=31:
        return failure('unsupported','TASK_CURRENT_RANGE_UNSUPPORTED',u'原任务值超出首版已验证范围，未写入'),project
    from System.IO import File,FileAttributes,FileStream,FileMode,FileAccess,FileShare
    if int(File.GetAttributes(req['projectPath'])) & int(FileAttributes.ReadOnly):
        return failure('unsupported','TASK_PROJECT_READ_ONLY',u'工程文件只读，未写入'),project
    try:
        # Native projects.open defaults allow_readonly=False; also require write ACL
        # before any setter. No permission/security setting is changed.
        handle=FileStream(req['projectPath'],FileMode.Open,FileAccess.ReadWrite,FileShare.ReadWrite);handle.Dispose()
    except Exception as e:
        return failure('unsupported','TASK_PROJECT_READ_ONLY',text(e)),project
    task=native[0];old_snapshot=snapshot(project);actions=[]
    changes={}
    if 'intervalMs' in args and old_interval!=args['intervalMs']:changes['interval']='t#%dms'%args['intervalMs']
    if 'priority' in args and int(fields['priority'])!=args['priority']:changes['priority']=str(args['priority'])
    common={'projectId':args['projectId'],'applicationId':args['applicationId'],'taskId':args['taskId'],'before':before,'snapshot':old_snapshot,
        'configurationVersionScheme':'task-configuration-v1','configurationOnly':True,'runtimeObserved':False}
    if not changes:
        return success(u'请求值与原配置一致；未调用setter、保存或重开',dict(common,changed=False,noOp=True,after=before,actions=[],
            configurationVersion=version,taskConfigurationVersion=version,reopened=False)),project
    directory=os.path.dirname(req['resultPath'])
    shutil.copyfile(req['projectPath'],req['checkpointPath'])
    publish(os.path.join(directory,'task-before.json'),dict(common,configurationVersion=version))
    try:
        for field in ('interval','priority'):
            if field not in changes:continue
            event={'field':field,'nativeValue':changes[field],'status':'started'};actions.append(event)
            publish(os.path.join(directory,'task-set-%s-start.json'%field),dict(event))
            setattr(task,field,changes[field])
            event.update(status='succeeded',readback=text(getattr(task,field)))
            publish(os.path.join(directory,'task-set-%s-end.json'%field),dict(event))
        expected=json.loads(encode(before))
        for t in expected['tasks']:
            if t['taskId']==args['taskId']:t['rawFields'].update(changes)
        after_set=task_inventory(project,args)
        if task_configuration_version(after_set)!=task_configuration_version(expected) or snapshot(project)!=old_snapshot:
            raise ValueError('Task write readback or preserved task/source fields differ')
        publish(os.path.join(directory,'task-after-set.json'),after_set)
        project=lifecycle_save_reopen(state)
        after=task_inventory(project,args)
        if task_configuration_version(after)!=task_configuration_version(expected) or snapshot(project)!=old_snapshot:
            raise ValueError('Reopened task identity/configuration or preserved source differs')
        publish(os.path.join(directory,'task-after-reopen.json'),after)
        return success(u'已有周期任务配置已写入、保存关闭重开并核对可读保留字段；需真实新编译',dict(common,
            changed=True,noOp=False,after=after,actions=actions,configurationVersion=task_configuration_version(after),
            taskConfigurationVersion=task_configuration_version(after),checkpoint=req['checkpointPath'],persistedToWorkingCopy=True,reopened=True)),project
    except Exception as e:
        partial=None
        if state['project'] is not None:
            try:partial=task_inventory(state['project'],args)
            except Exception:pass
        return failure('unknown','TASK_WRITE_INCOMPLETE',text(e),dict(common,actions=actions,partial=partial,
            checkpoint=req['checkpointPath'],primaryException=exception_evidence(e),automaticRollback=False)),state['project']

def native_structure(project, args):
    """Same native child API as walk; retain non-ST objects and per-branch failures."""
    nodes, failures, native = [], [], {}
    limit=args.get("maxNodes",20000)
    state={"truncated":False}
    known={"6f9dac99-8de1-4efc-8465-68ac443b7d08":"pou", "ffbfa93a-b94d-45fc-a329-229860183b1d":"gvl",
      "2db5746d-d284-4425-9f7f-2663a34b0ebc":"dut", "413e2a7d-adb1-4d2c-be29-6ae6e4fab820":"program-call"}
    def children(parent,parent_row,depth):
        prefix=parent_row["path"] if parent_row else []
        if depth>128:
            state["truncated"]=True;failures.append({"path":prefix,"stage":"depth-limit","reason":"Native tree depth exceeds 128"});return False
        try:
            for item in native_children(parent):
                if len(nodes)>=limit:state["truncated"]=True;return False
                row={"index":len(nodes),"parentIndex":parent_row["index"] if parent_row else None,
                  "parentId":parent_row["objectId"] if parent_row else None,"objectId":None,"nativeTypeId":None,
                  "name":None,"path":prefix[:],"pathComplete":True,"kind":"unknown","typeBasis":"unconfirmed",
                  "isDevice":None,"unavailableFields":[],"childrenRead":False}
                def get(field,fn):
                    try:return fn()
                    except Exception as e:row["unavailableFields"].append({"field":field,"reason":text(e)});return None
                row["name"]=get("name",lambda:text(item.get_name()))
                row["path"]=prefix+[row["name"]];row["pathComplete"]=all(x is not None for x in row["path"])
                row["objectId"]=get("objectId",lambda:text(item.guid).lower())
                row["nativeTypeId"]=get("nativeTypeId",lambda:text(item.type).lower())
                row["isDevice"]=get("isDevice",lambda:bool(item.is_device))
                if row["nativeTypeId"] in known:row.update(kind=known[row["nativeTypeId"]],typeBasis="native-type-id")
                for flag,kind in (("is_application","application"),("is_task","task")):
                    try:
                        if getattr(item,flag):row.update(kind=kind,typeBasis="native-"+flag)
                    except AttributeError:pass
                    except Exception as e:row["unavailableFields"].append({"field":flag,"reason":text(e)})
                if row["isDevice"]:row.update(kind="device",typeBasis="native-is_device")
                nodes.append(row);native[row["index"]]=item
                row["childrenRead"]=children(item,row,depth+1)
                if state["truncated"]:return False
            return True
        except Exception as e:
            failures.append({"path":prefix,"stage":"children-enumeration","reason":text(e)})
            return False
    complete=children(project,None,0)
    data={"projectId":args["projectId"],"projectPath":text(project.path),"nodes":nodes,
      "scope":{"description":"Whole native project tree, including non-editable and unknown types; project itself is the implicit root",
      "maxNodes":limit,"capturedNodes":len(nodes),"treeComplete":complete and not failures and not state["truncated"],
      "coverageComplete":complete and not failures and not state["truncated"] and not any(r["unavailableFields"] for r in nodes),
      "truncated":state["truncated"],"enumerationFailures":failures},
      "identityLimitations":"Native GUIDs are observed identities; some generated metadata/call wrappers can change on reopening. Page indices are relative to this inventory only."}
    return data,native

def device_inventory(project,args):
    tree,native=native_structure(project,{"projectId":args["projectId"],"maxNodes":20000})
    matches=[r for r in tree["nodes"] if r["objectId"]==args["deviceId"]]
    if len(matches)!=1:return failure("conflict","DEVICE_ID_NOT_UNIQUE",u"设备 GUID 未在本次结构中唯一定位",{"matches":matches,"treeScope":tree["scope"]})
    device=matches[0];item=native[device["index"]]
    if device["isDevice"] is not True:return failure("unsupported","NOT_DEVICE",u"指定原生对象未确认为设备，未读取参数",{"device":device})
    unavailable=[]
    def field(obj,name,path):
        try:
            value=getattr(obj,name)
            return None if value is None else text(value)
        except Exception as e:unavailable.append({"path":path,"field":name,"reason":text(e)});return None
    ident=None;identification={"type":None,"id":None,"deviceDescriptionVersion":None}
    try:
        ident=item.get_device_identification()
        identification={"type":field(ident,"type",device["path"]),"id":field(ident,"id",device["path"]),"deviceDescriptionVersion":field(ident,"version",device["path"])}
    except Exception as e:unavailable.append({"path":device["path"],"field":"get_device_identification","reason":text(e)})
    info={"name":None,"vendor":None,"description":None,"orderNumber":None}
    try:
        if ident is None:raise ValueError("No confirmed device identification")
        description=device_repository.get_device(ident)
        description_id=description.device_id
        if any(text(getattr(description_id,k))!=text(getattr(ident,k)) for k in ("type","id","version")):raise ValueError("Repository description identification differs")
        info={"name":field(description.device_info,"name",device["path"]),"vendor":field(description.device_info,"vendor",device["path"]),
          "description":field(description.device_info,"description",device["path"]),"orderNumber":field(description.device_info,"order_number",device["path"])}
    except Exception as e:unavailable.append({"path":device["path"],"field":"device_repository.get_device(...).device_info","reason":text(e)})
    params,connectors,parameter_failures=[],[],[]
    state={"truncated":False};cap=args["maxParameters"]
    def parameters(values,source,owner_path,parent_index=None,depth=0):
        if depth>64:
            state["truncated"]=True;parameter_failures.append({"path":owner_path,"field":"sub-elements","reason":"Parameter depth exceeds 64"});return
        try:
            for p in values:
                if len(params)>=cap:state["truncated"]=True;return
                errors=[]
                def get(name,convert=text):
                    try:
                        value=getattr(p,name)
                        if name=="value" and value is not None and not isinstance(value,(str,unicode)):
                            raise ValueError("Offline value getter returned a non-string object; no representation, default or online fallback used")
                        return None if value is None else convert(value)
                    except Exception as e:errors.append({"field":name,"reason":text(e)});return None
                identifier=get("identifier");name=get("visible_name");compound=get("has_sub_elements",bool)
                # Values come only from the offline value getter, never default_value or online APIs.
                value=get("value")
                typ=get("param_type") if depth==0 else (get("base_type") if compound is False else None)
                if depth>0 and compound is not False:errors.append({"field":"type","reason":"No confirmed compound subtype getter for this element; not inferred from value"})
                row={"index":len(params),"parentIndex":parent_index,"source":source,"ownerPath":owner_path,
                  "identifier":identifier,"name":name,"path":owner_path+[identifier],"type":typ,"value":value,
                  "valueSource":source+".value","hasSubElements":compound,"unavailableFields":errors}
                params.append(row)
                if compound:parameters(p,source,row["path"],row["index"],depth+1)
                if state["truncated"]:return
        except Exception as e:parameter_failures.append({"path":owner_path,"field":source,"reason":text(e)})
    try:parameters(item.device_parameters,"device_parameters",device["path"]+["device_parameters"])
    except Exception as e:parameter_failures.append({"path":device["path"],"field":"device_parameters","reason":text(e)})
    try:
        for c in item.connectors:
            cpath=device["path"]+["connectors"]
            cid=field(c,"connector_id",cpath);cpath=cpath+[cid]
            connectors.append({"id":cid,"path":cpath,"interface":field(c,"interface",cpath),"interfaceName":field(c,"interface_name",cpath)})
            if not state["truncated"]:
                try:parameters(c.host_parameters,"connectors.host_parameters",cpath+["host_parameters"])
                except Exception as e:parameter_failures.append({"path":cpath,"field":"host_parameters","reason":text(e)})
    except Exception as e:parameter_failures.append({"path":device["path"],"field":"connectors","reason":text(e)})
    return success(u"已读取设备描述及离线参数；不是完整设备配置或运行观测",{
      "projectId":args["projectId"],"projectPath":text(project.path),"device":device,"identification":identification,"deviceInfo":info,
      "identificationSource":"get_device_identification(); version means device description version, not firmware",
      "modelSource":"device_repository.get_device(exact identification).device_info.name; not object instance name",
      "firmwareVersion":None,"firmwareStatus":"not-provided-by-verified-offline-api","unavailableFields":unavailable,
      "connectors":connectors,"parameters":params,"parameterReadFailures":parameter_failures,
      "scope":{"description":"Offline device_parameters and each connector.host_parameters, including iterable compound sub-elements; no mapping editor, hidden OEM configuration, online values or defaults lookup",
        "maxParameters":cap,"capturedParameters":len(params),"truncated":state["truncated"],"treeScope":tree["scope"],
        "parameterCoverageComplete":not state["truncated"] and not parameter_failures and not any(p["unavailableFields"] for p in params)},
      "completeDeviceConfiguration":False,"runtimeObserved":False,
      "valueLimitations":"Actual offline API value strings; API may resolve implicit settings. Explicit assignment versus inherited default is not established. No live values or firmware queried."})

def compile_application(project, app_id, target_kind):
    app = application(project, app_id, target_kind)
    input_snapshot = snapshot(project)
    errors, messages = [], []
    categories = list(system.get_message_categories())
    for category in categories:
        system.clear_messages(category)
    completed = False
    try:
        # 目标内核提供的同步离线接口；不调用 online、download 或运行控制。
        if target_kind == "pool":
            project.check_all_pool_objects()
        elif not hasattr(app, "build"):
            return failure("unsupported", "BUILD_API_MISSING", u"目标 Application 没有 build 接口")
        else:
            app.build()
        completed = True
    except Exception as e:
        errors.append(text(e))
    # 编译可能创建新消息类别，必须重新枚举，不复用上一轮计数。
    try:
        categories = list(system.get_message_categories())
        if not categories:
            errors.append(u"本次编译后消息类别仍为空，诊断完整性未确认")
        for category in categories:
            for msg in system.get_message_objects(category):
                severity = text(msg.severity).lower()
                if severity not in ("fatalerror", "error", "warning", "information", "text"):
                    errors.append(u"未知诊断严重级别：" + severity)
                row = {"severity": severity, "text": text(getattr(msg, "text", msg)), "category": text(category)}
                for key in ("prefix", "number", "line", "column", "object_name"):
                    if hasattr(msg, key):
                        row[key] = text(getattr(msg, key))
                messages.append(row)
    except Exception as e:
        errors.append(text(e))
    output_snapshot = snapshot(project)
    if input_snapshot != output_snapshot:
        errors.append(u"编译期间文本内容发生变化")
    data = {"applicationId": app_id, "targetKind": target_kind, "completed": completed, "diagnosticsComplete": not errors,
            "diagnostics": messages, "collectionErrors": errors, "snapshot": output_snapshot,
            "buildPassed": (not any(m["severity"] in ("fatalerror", "error") for m in messages)) if completed and not errors else None}
    return success(u"本次编译已完成，请检查 buildPassed", data) if completed and not errors else failure("unknown", "BUILD_INCOMPLETE", u"编译或诊断读取不完整，不能确认通过", data)

def function_block_name(declaration):
    source = re.sub(r"\(\*.*?\*\)", " ", declaration, flags=re.S)
    source = re.sub(r"//[^\r\n]*", " ", source)
    match = re.match(r"\s*FUNCTION_BLOCK\s+([A-Za-z_][A-Za-z0-9_]*)\b", source, re.I)
    return match.group(1) if match else None

def pou_header(declaration):
    source = re.sub(r"\(\*.*?\*\)", " ", declaration, flags=re.S)
    source = re.sub(r"//[^\r\n]*", " ", source)
    match = re.match(r"\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\b",source,re.I)
    if not match:return None
    result={"pouType":match.group(1).lower(),"name":match.group(2)}
    if result["pouType"]=="function":
        returns=re.match(r"\s*:\s*([^\r\n]+)",source[match.end():])
        if not returns:return None
        result["returnType"]=returns.group(1).strip()
    return result

def pou_matches(kind, name, declaration, return_type=None):
    h=pou_header(declaration)
    return bool(h and h["pouType"]==kind and h["name"].lower()==name.lower() and
        ((return_type in ("DINT","BOOL","INT","REAL","TIME") and h.get("returnType","").upper()==return_type) if kind=="function" else return_type is None))

def pou_fields(item):
    # This OEM has no verified pou_type/return_type getter. Native POU identity plus
    # the actual declaration header is the explicit basis, never a guessed name.
    h=pou_header(text(item.textual_declaration.text)) if st_object(item) else None
    if not h:return {}
    result={"pouType":h["pouType"],"pouTypeSource":"native-pou-type-id-and-declaration-header"}
    if "returnType" in h:result["returnType"]=h["returnType"]
    return result

def creation_collisions(project, app_id, name):
    # Application 内所有对象及工程池中的文本定义均参与保守冲突检查；其他 Application 独立。
    return [{"objectId":text(item.guid).lower(),"applicationId":aid,"path":names}
            for item,names,aid in walk(project)
            if text(item.get_name()).lower() == name.lower() and
               (aid == app_id or (aid is None and getattr(item,"has_textual_declaration",False)))]

def lifecycle_state(project=None, project_path=None):
    return {"project":project,"projectPath":project_path,"events":[],"saveAttempts":0,"closeUnconfirmed":False}

def exception_evidence(error):
    return {"message":text(error),"detail":text(error.clsException.ToString()) if hasattr(error,"clsException") else __import__("traceback").format_exc()}

def native_marker_evidence(state):
    marker = (state.get("projectPath") or "") + ".~u"
    try:
        if not os.path.exists(marker):return {"exists":False}
        with open(marker,"rb") as stream:raw=stream.read()
        lines=raw.decode("utf-8-sig").splitlines()
        return {"exists":True,"sha256":hashlib.sha256(raw).hexdigest(),"ownerPid":int(lines[2]) if len(lines)>2 else None}
    except Exception as error:return {"status":"unverified","reason":text(error)}

def lifecycle_call(state, stage, action):
    event={"stage":stage,"status":"started","markerBefore":native_marker_evidence(state)}
    state["events"].append(event)
    try:
        result=action()
        event["status"]="succeeded"
        return result
    except Exception as error:
        event.update(status="failed",error=exception_evidence(error))
        raise
    finally:event["markerAfter"]=native_marker_evidence(state)

def lifecycle_open(state, project_path, stage="initial-open"):
    if state["project"] is not None:raise ValueError("Refusing to replace an owned open project")
    state["projectPath"]=project_path
    state["project"]=lifecycle_call(state,stage,lambda:projects.open(project_path,primary=True))
    return state["project"]

def lifecycle_close(state, stage):
    owned=state["project"]
    if owned is None:
        state["events"].append({"stage":stage,"status":"skipped","reason":"No owned handle; never retry a closed or uncertain handle"})
        return
    # Detach BEFORE close, including when close throws after partially releasing native state.
    state["project"]=None
    state["closeUnconfirmed"]=True
    lifecycle_call(state,stage,lambda:owned.close())
    state["closeUnconfirmed"]=False

def lifecycle_save_reopen(state, prefix=""):
    if state["project"] is None:raise ValueError("No confirmed open handle for save")
    # A throwing save may already have changed disk. Do not retry or auto-rollback it.
    state["saveAttempts"]+=1
    lifecycle_call(state,prefix+"save",lambda:state["project"].save())
    lifecycle_close(state,prefix+"close-before-reopen")
    return lifecycle_open(state,state["projectPath"],prefix+"reopen")

def lifecycle_report(state):
    return {"events":state["events"],"saveAttempts":state["saveAttempts"],"saveMayHaveOccurred":state["saveAttempts"]>0,
            "closeUnconfirmed":state["closeUnconfirmed"],"ownedHandleRemaining":state["project"] is not None}

def lifecycle_reject(state, response):
    state["rejection"]=response
    raise ValueError(response["summary"])

def create_pou(project, req, args, lifecycle=None):
    return create_text_object(project,req,args,args["pouType"],lifecycle)

def create_declaration(project, req, args, lifecycle=None):
    return create_text_object(project,req,args,args["objectType"],lifecycle)

def create_text_object(project, req, args, kind, lifecycle=None):
    lifecycle=lifecycle if lifecycle is not None else lifecycle_state(project,req["projectPath"])
    app_id = args["applicationId"].lower()
    parent_id = args["parentId"].lower()
    parent = application(project, app_id, "application")
    if parent_id != app_id or text(parent.guid).lower() != parent_id:
        return failure("conflict","PARENT_MISMATCH",u"只允许在选定 Application GUID 根节点创建"), project
    is_pou=kind in ("function_block","program","function")
    valid = pou_matches(kind,args["name"],args["declaration"],args.get("returnType")) if is_pou else declaration_matches(kind,args["name"],args["declaration"],True)
    if not valid or not re.match(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$",args["name"]):
        return failure("failed","INVALID_POU_DECLARATION" if is_pou else "INVALID_DECLARATION",u"声明类型、名称或函数返回类型不符合指定创建类型"), project
    before_snapshot = snapshot(project)
    if before_snapshot != args["expectedSnapshot"]:
        return failure("conflict","SNAPSHOT_CONFLICT",u"创建前工程文本快照已改变，未创建",{"snapshot":before_snapshot}), project
    collisions = creation_collisions(project,app_id,args["name"])
    if collisions:
        return failure("conflict","OBJECT_EXISTS",u"可见命名范围存在同名对象，未覆盖或创建",{"collisions":collisions}), project
    before_ids = set(text(item.guid).lower() for item,names,aid in walk(project))
    directory = os.path.dirname(req["resultPath"])
    publish(os.path.join(directory,"before.json"),{"applicationId":app_id,"parentId":parent_id,"name":args["name"],
            "expectedAbsent":True,"snapshot":before_snapshot,"objectIds":sorted(before_ids)})
    created_id = None
    try:
        if is_pou:
            native_kind={"function_block":scriptengine.PouType.FunctionBlock,"program":scriptengine.PouType.Program,"function":scriptengine.PouType.Function}[kind]
            if kind=="function":created=parent.create_pou(args["name"],native_kind,scriptengine.ImplementationLanguages.st,args["returnType"])
            else:created=parent.create_pou(args["name"],native_kind,scriptengine.ImplementationLanguages.st)
        elif kind=="gvl":created = parent.create_gvl(args["name"])
        else:
            native_kind=scriptengine.DutType.Alias if kind=="array" else scriptengine.DutType.Enumeration if kind=="enum" else scriptengine.DutType.Structure
            base_type="ARRAY [%d..%d] OF DINT" % array_bounds(args["name"],args["declaration"]) if kind=="array" else ""
            created = parent.create_dut(args["name"],native_kind,base_type)
        created_id = text(created.guid).lower()
        publish(os.path.join(directory,"created.json"),{"objectId":created_id,"parentId":parent_id,"name":args["name"]})
        if created_id in before_ids:
            raise ValueError("Factory returned an existing GUID; refusing to write or remove it")
        if not any(text(x.guid).lower()==created_id for x in parent.get_children(False)) or text(created.get_name())!=args["name"]:
            raise ValueError("Factory result is not the exact requested direct child")
        expected_kind="st_pou" if kind in ("program","function") else kind
        if object_kind(created)!=expected_kind:raise ValueError("Factory returned a different native object kind")
        if kind in ("enum","array"):
            publish(os.path.join(directory,"factory.json"),{"arguments":[args["name"],text(native_kind),base_type],
                "objectId":created_id,"parentId":parent_id,"nativeTypeId":text(created.type).lower(),"nativeDeclaration":text(created.textual_declaration.text)})
            if kind=="array" and array_bounds(args["name"],text(created.textual_declaration.text))!=array_bounds(args["name"],args["declaration"]):
                raise ValueError("Native Alias factory array bounds differ before write")
        if is_pou:
            factory_declaration=text(created.textual_declaration.text)
            publish(os.path.join(directory,"factory.json"),{
                "arguments":[args["name"],text(native_kind),text(scriptengine.ImplementationLanguages.st)]+([args["returnType"]] if kind=="function" else []),
                "objectId":created_id,"parentId":parent_id,"nativeDeclaration":factory_declaration})
            if not pou_matches(kind,args["name"],factory_declaration,args.get("returnType")):
                raise ValueError("Factory POU header/return type differs before write")
        created.textual_declaration.replace(normalize(args["declaration"]))
        if is_pou:created.textual_implementation.replace(normalize(args["implementation"]))
        observed = read_object(*locate(project,app_id,created_id))
        if observed["objectType"]!=expected_kind or observed["contentHash"] != content_hash(args["declaration"],args.get("implementation","")):
            raise ValueError("Created ST readback differs from request")
        project = lifecycle_save_reopen(lifecycle)
        parent = application(project,app_id,"application")
        item,names,aid = locate(project,app_id,created_id)
        reopened = read_object(item,names,aid)
        if reopened["objectType"]!=expected_kind or reopened["contentHash"]!=observed["contentHash"] or text(item.get_name())!=args["name"] or not any(text(x.guid).lower()==created_id for x in parent.get_children(False)):
            raise ValueError("Created GUID/parent/name/content differs after reopen")
        if is_pou and not pou_matches(kind,args["name"],reopened["declaration"],args.get("returnType")):
            raise ValueError("Reopened POU header/return type differs from request")
        return success(u"ST 对象已创建，工作副本保存重开并按新 GUID、类型与全文读回一致",dict(reopened,
            name=args["name"],parentId=parent_id,created=True,beforeSnapshot=before_snapshot,
            snapshot=snapshot(project),checkpoint=req["checkpointPath"],persistedToWorkingCopy=True,reopened=True,
            creationMethod={"function_block":"create_pou / PouType.FunctionBlock / ImplementationLanguages.st","program":"create_pou / PouType.Program / ImplementationLanguages.st","function":"create_pou / PouType.Function / ImplementationLanguages.st / explicit "+text(args.get("returnType","")),"gvl":"create_gvl","structure":"create_dut / DutType.Structure","enum":"create_dut / DutType.Enumeration / baseType='' ref: factory.json","array":"create_dut / DutType.Alias / ARRAY baseType ref: factory.json"}[kind])), project
    except Exception as error:
        partial = None
        recovery = {"status":"unknown"}
        detail=exception_evidence(error)
        try:
            if req.get("fileGuard") or lifecycle["saveAttempts"] or lifecycle["closeUnconfirmed"] or lifecycle["project"] is None:
                raise ValueError("Persistence/lifecycle already attempted; preserve checkpoint and freeze, without rollback writes or another open")
            project=lifecycle["project"]
            if created_id is not None and created_id not in before_ids:
                candidates = [(x,n,aid) for x,n,aid in walk(project) if text(x.guid).lower()==created_id]
                if len(candidates)>1: raise ValueError("Ambiguous new GUID during recovery")
                if candidates:
                    x,n,aid = candidates[0]
                    if aid!=app_id:raise ValueError("New GUID is outside selected Application")
                    try: partial = read_object(x,n,aid)
                    except Exception: pass
                    # 只删除本请求明确取得、且创建前不存在的新 GUID，绝不按短名称删除。
                    x.remove()
                lifecycle["saveAttempts"]+=1
                lifecycle_call(lifecycle,"recovery-save",lambda:project.save())
            elif snapshot(project)!=before_snapshot or set(text(x.guid).lower() for x,n,aid in walk(project))!=before_ids:
                raise ValueError("Factory did not return a known new GUID and project changed; cannot safely remove by name")
            lifecycle_close(lifecycle,"recovery-close")
            project = lifecycle_open(lifecycle,req["projectPath"],"recovery-reopen")
            after_ids = set(text(x.guid).lower() for x,n,aid in walk(project))
            if snapshot(project)!=before_snapshot or after_ids!=before_ids or creation_collisions(project,app_id,args["name"]):
                raise ValueError("Recovery did not restore original text/object identities after reopen")
            recovery = {"status":"succeeded","snapshot":before_snapshot,"absentAfterReopen":True,"removedObjectId":created_id if created_id not in before_ids else None}
        except Exception as recovery_error:
            recovery.update(error=text(recovery_error),detail=exception_evidence(recovery_error))
        return failure("failed" if recovery["status"]=="succeeded" else "unknown","PARTIAL_CREATE",text(error),
            {"createdObjectId":created_id,"partialContent":partial,"recovery":recovery,"checkpoint":req["checkpointPath"],"primaryException":detail}), lifecycle["project"]

def direct_exclusive_probe(project_path):
    from System.IO import FileStream, FileMode, FileAccess, FileShare
    handle = FileStream(project_path, FileMode.Open, FileAccess.Read, getattr(FileShare, "None"))
    handle.Dispose()

def direct_file_guard(req, state):
    guard=req.get("fileGuard")
    if not guard:return None
    target=req["projectPath"]
    if guard.get("mode")!="direct" or not guard.get("expectedDiskHash"):
        lifecycle_reject(state,failure("conflict","DIRECT_BINDING_INVALID",u"直接工程绑定信息不完整，未打开"))
    for suffix in (".lock",".lck",".~lock",".~u"):
        if os.path.lexists(target+suffix):
            lifecycle_reject(state,failure("conflict","PROJECT_BUSY",u"指定工程存在外部占用标记；未接管、未删除标记"))
    try:direct_exclusive_probe(target)
    except Exception as error:
        lifecycle_reject(state,failure("conflict","PROJECT_BUSY",u"指定工程无法排他读取，未打开或写入",{"probeError":exception_evidence(error)}))
    before=file_hash(target)
    if before!=guard["expectedDiskHash"]:
        lifecycle_reject(state,failure("conflict","PROJECT_FILE_CHANGED",u"指定工程在派发后发生变化，未打开或写入"))
    return {"projectPath":target,"expectedDiskHash":guard["expectedDiskHash"],"beforeDiskHash":before,"exclusiveProbe":True}

def dispatch(req):
    if req['command']=='new_project':
        sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
        from project_create import create_minimal
        return create_minimal(req,dict(globals(),projects=projects))
    project = None
    lifecycle = lifecycle_state(project_path=req["projectPath"])
    response = None
    command, args = req["command"], req["args"]
    read_only = command in ("search","tasks","structure","device","libraries","compare_capture") or bool(req.get("fileGuard") and command in ("inspect","list","read"))
    direct_evidence = None
    before_hash = None
    if command not in ("inspect", "list", "read", "search", "tasks", "task_update", "structure", "device", "libraries", "compare_capture", "create", "create_declaration", "change", "build", "save"):
        return failure("unsupported", "COMMAND_UNSUPPORTED", u"未支持的固定桥接操作")
    try:
        direct_evidence=direct_file_guard(req,lifecycle)
        if read_only:
            before_hash=file_hash(req["projectPath"])
            if before_hash!=(req.get("fileGuard",{}).get("expectedDiskHash") or args["readDiskHash"]):
                lifecycle_reject(lifecycle,failure("conflict","READ_DISK_CHANGED",u"正式读取前工程文件已变化，未打开或保存",{"beforeDiskHash":before_hash}))
        if projects.primary is not None:
            lifecycle_reject(lifecycle,failure("conflict", "UNOWNED_PROJECT", u"新启动实例已有工程；拒绝接管"))
        if command in ("change", "create", "create_declaration") or req.get("fileGuard") and command=="save":
            shutil.copyfile(req["projectPath"], req["checkpointPath"])
        project = lifecycle_open(lifecycle,req["projectPath"])
        if direct_evidence and file_hash(req["projectPath"])!=direct_evidence["beforeDiskHash"]:
            lifecycle_reject(lifecycle,failure("conflict","PROJECT_FILE_CHANGED",u"打开期间文件发生变化，未提交修改"))
        if os.path.normcase(os.path.abspath(text(project.path))) != os.path.normcase(os.path.abspath(req["projectPath"])):
            lifecycle_reject(lifecycle,failure("conflict", "PROJECT_PATH_MISMATCH", u"IDE 实际工程路径不匹配"))
        if command == "structure":
            response = success(u"已只读枚举原生工程结构",native_structure(project,args)[0])
        elif command == "device":
            response = device_inventory(project,args)
        elif command == "inspect":
            response = success(u"工作副本已打开并读取", metadata(project))
        else:
            app_id = args["applicationId"].lower() if args["applicationId"] is not None else None
            target_kind = args.get("targetKind", "application")
            application(project, app_id, target_kind)
            if command == "compare_capture":
                response = success(u"已只读采集支持源码与任务配置",{"projectId":args["projectId"],"applicationId":args["applicationId"],"targetKind":"application","projectPath":text(project.path),"sourceInventory":search_inventory(project,args),"taskInventory":task_inventory(project,args)})
            elif command == "search":
                response = success(u"已在一次 IDE 读取中取得搜索范围与完整原文",search_inventory(project,args))
            elif command == "tasks":
                response = success(u"已只读取得真实任务字段与程序候选",task_inventory(project,args))
            elif command == 'task_update':
                response,project=task_config_update(project,req,args,lifecycle)
            elif command == "libraries":
                response = success(u"已只读取得精确 Application 的库直接引用与原生解析信息",library_inventory(project,args))
            elif command == "list":
                objects = []
                for item, names, aid in walk(project):
                    if aid == app_id and editable(project,item,aid):
                        objects.append(dict({"objectId": text(item.guid).lower(), "path": names, "applicationId": aid, "language": "ST",
                            "objectType":object_kind(item),"hasImplementation":bool(getattr(item,"has_textual_implementation",False)),"nativeTypeId":text(item.type).lower()},**pou_fields(item)))
                offset, limit = args["offset"], args["limit"]
                response = success(u"已读取 ST 对象列表", {"objects": objects[offset:offset+limit], "total": len(objects),
                    "complete": offset+limit >= len(objects), "nextOffset": offset+limit if offset+limit < len(objects) else None})
            elif command == "read":
                response = success(u"已读取精确 ST 对象", read_object(*locate(project, app_id, args["objectId"])))
            elif command == "create":
                response, project = create_pou(project,req,args,lifecycle)
            elif command == "create_declaration":
                response, project = create_declaration(project,req,args,lifecycle)
            elif command == "change":
                item, names, aid = locate(project, app_id, args["objectId"])
                before = read_object(item, names, aid)
                kind = before["objectType"]
                invalid_type = (args.get("objectType") is not None and args["objectType"]!=kind) or (kind in ("gvl","structure","enum","array") and
                    (args.get("implementation","")!="" or not declaration_matches(kind,text(item.get_name()),args["declaration"],True))) or (before["hasImplementation"] and "implementation" not in args)
                if invalid_type:
                    response = failure("unsupported","OBJECT_TYPE_MISMATCH",u"指定对象类型或声明形态不匹配；声明类无实现，POU 必须提供实现，未写入")
                elif before["contentHash"] != args["expectedHash"]:
                    response = failure("conflict", "HASH_CONFLICT", u"实际内容已改变，未写入", {"actual": before})
                else:
                    publish(os.path.join(os.path.dirname(req["resultPath"]), "before.json"), before)
                    try:
                        item.textual_declaration.replace(normalize(args["declaration"]))
                        if before["hasImplementation"]:item.textual_implementation.replace(normalize(args["implementation"]))
                        observed = read_object(item, names, aid)
                        if observed["objectType"]!=kind or observed["contentHash"] != content_hash(args["declaration"], args.get("implementation","")):
                            raise ValueError("Write readback does not match requested content")
                        project = lifecycle_save_reopen(lifecycle)
                        reopened = read_object(*locate(project, app_id, args["objectId"]))
                        if reopened["objectType"]!=kind or reopened["contentHash"] != observed["contentHash"] or reopened["path"]!=before["path"]:
                            raise ValueError("Disk reopen does not match write readback")
                        response = success(u"修改并读回一致，工作副本已持久化并重开核对", dict(reopened,
                            snapshot=snapshot(project), checkpoint=req["checkpointPath"], persistedToWorkingCopy=True, reopened=True))
                    except Exception as e:
                        observed = None
                        recovery = {"status": "unknown"}
                        detail = exception_evidence(e)
                        try:
                            if req.get("fileGuard") or lifecycle["saveAttempts"] or lifecycle["closeUnconfirmed"] or lifecycle["project"] is None:
                                raise ValueError("Persistence/lifecycle already attempted; preserve checkpoint and freeze, without rollback writes or another open")
                            project = lifecycle["project"]
                            item, names, aid = locate(project, app_id, args["objectId"])
                            observed = read_object(item, names, aid)
                            item.textual_declaration.replace(before["declaration"])
                            if before["hasImplementation"]:item.textual_implementation.replace(before["implementation"])
                            project = lifecycle_save_reopen(lifecycle,"recovery-")
                            restored = read_object(*locate(project, app_id, args["objectId"]))
                            recovery = {"status": "succeeded" if restored["contentHash"] == before["contentHash"] and restored["objectType"]==kind and restored["path"]==before["path"] else "unknown", "observed": restored}
                        except Exception as recover_error:
                            recovery.update(error=text(recover_error),detail=exception_evidence(recover_error))
                        response = failure("failed" if recovery["status"] == "succeeded" else "unknown", "PARTIAL_WRITE", text(e),
                            {"partialContent": observed, "recovery": recovery, "checkpoint": req["checkpointPath"],"primaryException":detail})
            elif command == "build":
                task_before=task_configuration_version(task_inventory(project,args)) if target_kind=='application' else None
                response = compile_application(project, app_id, target_kind)
                if target_kind=='application' and response.get('data') is not None:
                    task_after=task_configuration_version(task_inventory(project,args))
                    if task_before!=task_after:raise ValueError('Task configuration changed during build')
                    response['data']['taskConfigurationVersion']=task_after
            elif command == "save":
                before = snapshot(project)
                task_before=task_configuration_version(task_inventory(project,args)) if target_kind=='application' else None
                if before != args["expectedSnapshot"]:
                    response = failure("conflict", "SNAPSHOT_CONFLICT", u"保存目标快照已改变", {"snapshot": before})
                else:
                    project = lifecycle_save_reopen(lifecycle)
                    after = lifecycle_call(lifecycle,"reopen-verification",lambda:snapshot(project))
                    response = success(u"工程已保存、关闭并重新打开确认", {"saved": True, "reopened": True, "snapshot": after}) if before == after else failure("unknown", "REOPEN_MISMATCH", u"重开后快照不一致", {"before": before, "after": after})
                    if target_kind=='application':
                        task_after=task_configuration_version(task_inventory(project,args))
                        if task_before!=task_after:raise ValueError('Reopened task configuration differs')
                        response.setdefault('data',{})['taskConfigurationVersion']=task_after
    except Exception as e:
        response = lifecycle.get("rejection")
        if response is None:
            detail = exception_evidence(e)
            response = failure("unknown" if lifecycle["saveAttempts"] or lifecycle["closeUnconfirmed"] else "failed", "IDE_API_ERROR", text(e), {"detail": detail["detail"],"primaryException":detail})
    finally:
        try:
            lifecycle_close(lifecycle,"final-cleanup")
        except Exception as e:
            primary = response.get("error",{}).get("message") if response else None
            message = (u"原始异常："+primary+u"；最终清理异常："+text(e)) if primary else u"最终清理失败："+text(e)
            response = failure("unknown", "CLOSE_FAILED", message, {"priorResult": response,"cleanupException":exception_evidence(e)})
        if read_only and before_hash is not None:
            after_hash=file_hash(req["projectPath"])
            evidence={"beforeDiskHash":before_hash,"afterCloseDiskHash":after_hash,"unchanged":before_hash==after_hash}
            if before_hash!=after_hash:response=failure("unknown","READ_ONLY_FILE_CHANGED",u"只读期间工程文件意外变化，结果不可信，保留证据并冻结",{"priorResult":response})
            if response is not None:
                response.setdefault("data",{})["readOnlyEvidence"]=evidence
        if response is not None:response.setdefault("data",{})["lifecycle"]=lifecycle_report(lifecycle)
    if direct_evidence:
        if response.get("data") is None:response["data"]={}
        response["data"]["directFileEvidence"]=direct_evidence
        response["data"]["projectPath"]=req["projectPath"]
        response["data"]["editMode"]="direct"
        if response["data"].pop("persistedToWorkingCopy",False):response["data"]["persistedToProject"]=True
        response["summary"]=response["summary"].replace(u"工作副本",u"指定工程")
    return response

request_path = os.environ.get("INOPRO_BRIDGE_REQUEST")
if not request_path:
    if len(sys.argv) != 2:
        raise ValueError("worker requires exactly one structured request path")
    request_path = sys.argv[1]
with io.open(request_path, "r", encoding="utf-8") as f:
    request = json.load(f)
# 一个发布目录仅执行一次。重启发现 dispatch 存在但无结果时不重放。
dispatch_path = os.path.join(os.path.dirname(request_path), "dispatched.json")
if os.path.exists(request["resultPath"]):
    pass
elif os.path.exists(dispatch_path):
    raise ValueError("Original dispatch result is unknown; refusing replay")
else:
    publish(dispatch_path, {"operationId": request["operationId"], "pid": os.getpid(), "python": sys.version})
    holder = []
    def execute():
        holder.append(dispatch(request))
    try:
        # OEM 保存/工程对象要求真正的 IDE 主线程。noUI 不能建立其 UI 主线程状态。
        system.execute_on_primary_thread(execute)
        result = holder[0]
    except Exception as e:
        result = failure("unknown", "PRIMARY_THREAD_ERROR", text(e), {"detail": traceback.format_exc()})
    result["operationId"] = request["operationId"]
    if result.get("data") is not None and os.path.exists(request["projectPath"]):
        result["data"]["diskHash"] = file_hash(request["projectPath"])
    publish(request["resultPath"], result)
# 只退出由服务以 --runscript 启动的新实例。
system.exit()
