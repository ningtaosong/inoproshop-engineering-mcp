# -*- coding: utf-8 -*-
"""Bounded native organization operations. Loaded in worker's verified API context."""
FOLDER_NATIVE='738bea1e-99bb-4f04-90bb-a7a567e74e3a'
ORGANIZATION_SCHEME='application-organization-v1'

def attach_organization_versions(project,data,native,args):
    # Preserve the existing partial native-tree contract. A failed extra version
    # read is its own gap, never evidence that an Application/object is absent.
    versions,failures={},[]
    for index in sorted(native):
        row=data['nodes'][index]
        if row['kind']!='application':continue
        aid=row['objectId']
        try:
            if aid is None:raise ValueError('Native Application GUID unavailable')
            versions[aid]=organization_inventory(project,aid,args['projectId'])['version']
        except Exception as e:failures.append({'applicationId':aid,'path':row['path'],'stage':'organization-version-read','reason':text(e)})
    data['organizationVersions']=versions;data['organizationScheme']=ORGANIZATION_SCHEME
    if failures:data['organizationFailures']=failures
    return data

def organization_inventory(project,aid,project_id):
    app=application(project,aid);prefix=next(n for x,n,a in walk(project) if text(x.guid).lower()==aid)
    rows=[];seen=set()
    def visit(item,names,parent_id):
        key=text(item.guid).lower()
        if key in seen or len(rows)>=20000:raise ValueError('Duplicate identity or organization inventory limit')
        seen.add(key);native=text(item.type).lower()
        folder=bool(getattr(item,'is_folder',False))
        if folder and native!=FOLDER_NATIVE:raise ValueError('Unverified folder type')
        d=normalize(text(item.textual_declaration.text)) if getattr(item,'has_textual_declaration',False) else None
        i=normalize(text(item.textual_implementation.text)) if getattr(item,'has_textual_implementation',False) else None
        rows.append({'objectId':key,'parentId':parent_id,'name':text(item.get_name()),'path':names,'nativeTypeId':native,'isFolder':folder,'sourceHash':content_hash(d or '',i or '') if d is not None or i is not None else None})
        # Task call wrappers have non-persistent GUIDs. Non-source system branches
        # are leaves here; readable task configuration is verified separately.
        if key==aid or folder or st_object(item) or native in ('f8a58466-d7f6-439f-bbb8-d4600e41d099','5a3b8626-d3e9-4f37-98b5-66420063d91e','792f2eb6-721e-4e64-ba20-bc98351056db'):
            for child in native_children(item):visit(child,names+[text(child.get_name())],key)
    visit(app,prefix,None);rows.sort(key=lambda r:r['objectId'])
    return {'scheme':ORGANIZATION_SCHEME,'projectId':project_id,'applicationId':aid,'nodes':rows,'version':sha(encode([ORGANIZATION_SCHEME,project_id,aid,rows]))}

def organization_container(project,aid,object_id):
    app=application(project,aid)
    if object_id==aid:return app
    rows=[x for x,n,a in walk(project) if a==aid and text(x.guid).lower()==object_id]
    if len(rows)!=1:raise ValueError('Container identity not unique within Application')
    item=rows[0]
    if text(item.type).lower()!=FOLDER_NATIVE or not getattr(item,'is_folder',False) or text(item.parent.guid).lower()!=aid:raise ValueError('Only exact Application or its direct native folder is supported')
    return item

def organization_source(project,aid,object_id):
    item,names,_=locate(project,aid,object_id)
    if not st_object(item) or not method_is_st(item) or not pou_header(text(item.textual_declaration.text)):raise ValueError('Only verified native ST PROGRAM, FUNCTION or FUNCTION_BLOCK may move')
    organization_container(project,aid,text(item.parent.guid).lower())
    if native_children(item) and not function_block_name(text(item.textual_declaration.text)):raise ValueError('Non-FB source has unsupported children')
    for child,n,a in walk(item,names,aid):
        if not editable(project,child,aid) or object_kind(child) not in ('method','property','property_get','property_set'):raise ValueError('FB contains unsupported child structure')
        method_write_permission(project,child)
    return item,names

def organize(project,req,args,state):
    aid=args['applicationId'];moving=req['command']=='move_object';actions=[]
    try:
        before=organization_inventory(project,aid,args['projectId'])
        if before['version']!=args['expectedStructureVersion'] or file_hash(req['projectPath'])!=args['expectedDiskHash']:return failure('conflict','ORGANIZATION_VERSION_CHANGED',u'结构或磁盘版本已变化，未写入'),project
        target=organization_container(project,aid,args['targetParentId'] if moving else args['parentId'])
        if not moving and args['parentId']!=aid:return failure('unsupported','FOLDER_ROOT_ONLY',u'仅允许Application根节点新建原生文件夹'),project
        method_file_writable(req['projectPath']);method_write_permission(project,target,True)
        if moving:
            source,names=organization_source(project,aid,args['objectId']);source_id=text(source.guid).lower();old_parent=text(source.parent.guid).lower()
            if old_parent!=aid and text(target.guid).lower()!=aid and old_parent!=text(target.guid).lower():return failure('unsupported','ROOT_FOLDER_ONLY',u'首版仅根节点与直接文件夹之间移动'),project
            if old_parent!=args['sourceParentId']:return failure('conflict','SOURCE_PARENT_CHANGED',u'源父节点与请求不一致，未移动'),project
            method_write_permission(project,source);method_write_permission(project,source.parent,True)
            name=text(source.get_name())
        else:name=args['name']
        collision=[x for x in native_children(target) if text(x.get_name()).lower()==name.lower() and (not moving or text(x.guid).lower()!=source_id)]
        if collision:return failure('conflict','ORGANIZATION_NAME_EXISTS',u'目标同级名称冲突，不覆盖或改名'),project
        task_before=task_inventory(project,args);old_snapshot=snapshot(project)
        if not task_before['coverageComplete']:return failure('unsupported','ORGANIZATION_TASK_COVERAGE',u'实际任务读取不完整，未写入'),project
        if moving and old_parent==text(target.guid).lower():
            return success(u'对象已在指定位置，未移动或保存',{'projectId':args['projectId'],'applicationId':aid,'changed':False,'noOp':True,'reopened':False,'object':read_object(source,names,aid),'beforeStructure':before,'afterStructure':before,'taskBefore':task_before,'taskAfter':task_before,'snapshot':old_snapshot,'actions':[]}),project
    except Exception as e:return failure('unsupported','ORGANIZATION_TARGET_OR_PERMISSION',text(e)),project
    directory=os.path.dirname(req['resultPath'])
    shutil.copyfile(req['projectPath'],req['checkpointPath']);publish(os.path.join(directory,'organization-before.json'),{'structure':before,'task':task_before,'snapshot':old_snapshot})
    try:
        # Recheck after checkpoint and before invoking the native mutator.
        if organization_inventory(project,aid,args['projectId'])!=before or file_hash(req['projectPath'])!=args['expectedDiskHash']:return failure('conflict','ORGANIZATION_VERSION_CHANGED',u'检查点后结构或磁盘版本变化，未写入'),project
        if moving:
            actions.append({'action':'move','objectId':source_id,'sourceParentId':old_parent,'targetParentId':text(target.guid).lower(),'status':'attempted'})
            source.move(target,-1);new_id=source_id
        else:
            prior=set(r['objectId'] for r in before['nodes']);actions.append({'action':'create_folder','parentId':aid,'name':name,'status':'attempted'})
            target.create_folder(name)
            fresh=[x for x in native_children(target) if text(x.guid).lower() not in prior]
            if len(fresh)!=1 or text(fresh[0].get_name())!=name or text(fresh[0].type).lower()!=FOLDER_NATIVE or not fresh[0].is_folder:raise ValueError('Folder factory identity cannot be confirmed')
            new_id=text(fresh[0].guid).lower()
        actions[-1]['status']='returned';after=organization_inventory(project,aid,args['projectId'])
        publish(os.path.join(directory,'organization-after-native.json'),after)
        project=lifecycle_save_reopen(state);reopened=organization_inventory(project,aid,args['projectId']);task_after=task_inventory(project,args)
        expected_task=json.loads(encode(task_before))
        if moving:
            new_path=next(r['path'] for r in reopened['nodes'] if r['objectId']==source_id)
            for prg in expected_task['programs']:
                if prg['objectId']==source_id:prg['path']=new_path
        actual_task=json.loads(encode(task_after))
        expected_task['programs'].sort(key=lambda r:r['objectId']);actual_task['programs'].sort(key=lambda r:r['objectId'])
        if after!=reopened or expected_task!=actual_task:raise ValueError('Reopened structure or readable task configuration differs')
        row=next(r for r in reopened['nodes'] if r['objectId']==new_id)
        data={'projectId':args['projectId'],'applicationId':aid,'changed':True,'noOp':False,'reopened':True,'beforeStructure':before,'afterStructure':reopened,'taskBefore':task_before,'taskAfter':task_after,'snapshot':snapshot(project),'checkpoint':req['checkpointPath'],'persistedToWorkingCopy':True,'actions':actions,'object':read_object(*locate(project,aid,new_id)) if moving else row}
        return success(u'原生结构操作已保存关闭重开；GUID、父链、源码与可读任务配置核对',data),project
    except Exception as e:
        return failure('unknown','ORGANIZATION_INCOMPLETE',text(e),{'actions':actions,'checkpoint':req['checkpointPath'],'beforeStructure':before,'automaticRollback':False,'primaryException':exception_evidence(e)}),state['project']
