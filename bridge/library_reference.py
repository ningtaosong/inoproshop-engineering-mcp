# -*- coding: utf-8 -*-
"""Fixed, bounded library repository read and direct-reference add helpers.

Loaded into worker.py's fixed bridge scope. No request-supplied script or path is
executed. Native ManagedLib objects are always reacquired from the IDE catalog.
"""

LIB_CATALOG_SCHEME = 'installed-libraries-v1'
LIB_CONFIG_SCHEME = 'direct-library-references-v1'
LIB_PLACEHOLDER_SCHEME = 'application-placeholder-resolution-v1'
LIB_MANAGER_TYPE = 'adb5cb65-8e1d-4a00-b70a-375ea27582f3'
LIB_FIELDS = ('id','name','namespace','is_placeholder','is_managed','system_library',
              'optional','qualified_only','placeholder_name','default_resolution',
              'effective_resolution','resolution_info','resolver_guid','is_redirected')

def installed_inventory():
    rows, repositories, failures, native = [], [], [], {}
    try:
        for repository in librarymanager.repositories:
            repositories.append([text(repository.name), text(repository.root_folder)])
    except Exception as error:
        failures.append({'stage':'repositories','reason':text(error)})
    try:
        libraries = librarymanager.get_all_libraries(False)  # Include shadowed versions.
        for library in libraries:
            values = []
            for key in ('displayname','company','title','version','default_namespace'):
                try:values.append(text(getattr(library,key)))
                except Exception as error:
                    values.append(None);failures.append({'stage':'library-field','field':key,'reason':text(error)})
            try:values.append(text(librarymanager.get_file_path(library)))
            except Exception as error:
                values.append(None);failures.append({'stage':'library-file','reason':text(error)})
            identity = sha(encode(values)) if None not in values else None
            row = {'identity':identity,'displayName':values[0],'company':values[1],
                   'title':values[2],'version':values[3], 'defaultNamespace':values[4],
                   'repositoryFile':values[5]}
            rows.append(row)
            if identity is not None:native.setdefault(identity,[]).append(library)
    except Exception as error:
        failures.append({'stage':'enumeration','reason':text(error)})
    rows.sort(key=lambda r:(r['identity'] or '',r['displayName'] or ''))
    repositories.sort()
    duplicates = [key for key,found in native.items() if len(found)!=1]
    if duplicates:failures.append({'stage':'identity','reason':'Native catalog contains duplicate exact identity','count':len(duplicates)})
    version = sha(encode([LIB_CATALOG_SCHEME,
                          [[r[k] for k in ('identity','displayName','company','title','version','defaultNamespace','repositoryFile')] for r in rows],
                          repositories,failures]))
    return {'catalogVersion':version,'identityScheme':LIB_CATALOG_SCHEME,
            'entries':rows,'repositories':repositories,'failures':failures,
            'enumerationComplete':len(failures)==0,'total':len(rows)},native

def library_configuration_version(inventory):
    managers = []
    for manager in sorted(inventory['managers'],key=lambda m:m['managerId']):
        refs = [r for r in inventory['references'] if r['managerId']==manager['managerId']]
        refs.sort(key=lambda r:r['order'])
        managers.append([manager['managerId'],manager['path'],manager['nativeTypeId'],
            [[r['order']]+[r['rawFields'].get(key) for key in LIB_FIELDS] for r in refs]])
    return sha(encode([LIB_CONFIG_SCHEME,inventory['applicationId'],managers,
                       inventory['scope']['truncated'], inventory['scope']['enumerationFailures']]))

def placeholder_configuration_version(inventory):
    refs = sorted(inventory['references'],key=lambda r:(r['managerId'],r['order']))
    return sha(encode([LIB_PLACEHOLDER_SCHEME,library_configuration_version(inventory),
        [[r['managerId'],r['order'],r['rawFields'].get('explicit_redirection')]
         for r in refs if r['rawFields'].get('is_placeholder') is True]]))

def complete_library_inventory(inventory):
    """A configuration hash is not evidence that native enumeration completed."""
    try:
        scope=inventory['scope'];managers=inventory['managers'];refs=inventory['references']
        if (scope['enumerationComplete'] is not True or scope['fieldReadComplete'] is not True or
            scope['truncated'] is not False or scope['enumerationFailures'] != [] or
            not isinstance(scope['maxReferences'],int) or scope['maxReferences']<1 or
            not isinstance(scope['capturedReferences'],int) or scope['capturedReferences']!=len(refs) or
            scope['capturedReferences']>scope['maxReferences'] or
            not isinstance(managers,list) or not isinstance(refs,list)):
            return False
        ids=[m['managerId'] for m in managers]
        if len(ids)!=len(set(ids)) or sum(m['capturedReferences'] for m in managers)!=len(refs):return False
        if any(m['enumerationComplete'] is not True or m['unavailableFields'] != [] for m in managers):return False
        for index,ref in enumerate(refs):
            fields=ref['rawFields']
            if (ref['index']!=index or ref['managerId'] not in ids or ref['unavailableFields'] != [] or
                not fields.get('id') or not fields.get('name') or not fields.get('namespace') or
                any(fields.get(key) is not True and fields.get(key) is not False for key in
                    ('is_placeholder','is_managed','system_library','optional','qualified_only'))):
                return False
        return True
    except (KeyError,TypeError,ValueError,AttributeError):return False

def complete_placeholder_inventory(inventory):
    if not complete_library_inventory(inventory):return False
    for ref in inventory['references']:
        fields=ref['rawFields']
        if fields.get('is_placeholder') is not True:continue
        if ('explicit_redirection' not in fields or
            fields['explicit_redirection'] is not None and
            (not isinstance(fields['explicit_redirection'],type(u'')) or not fields['explicit_redirection'])):
            return False
    return True

def unresolved_native_resolution(value):
    # InoProShop 1.9.1.6 reports an unresolved placeholder as the literal
    # native string "None"; it is not an application override or a library.
    return value is None or value==u'' or value==u'None'

def library_placeholder_resolve(project,req,args,lifecycle):
    """Set one application-owned native placeholder override, never a direct reference."""
    if file_hash(req['projectPath'])!=args['expectedDiskHash']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_DISK_CHANGED',u'工程磁盘版本已变化，未设置占位符'))
    before=library_inventory(project,args)
    if not complete_placeholder_inventory(before):
        lifecycle_reject(lifecycle,failure('unsupported','LIBRARY_CONFIGURATION_INCOMPLETE',u'写前库清单不完整'))
    if (before['configurationVersion']!=args['expectedReferenceVersion'] or
        before['placeholderConfigurationVersion']!=args['expectedPlaceholderVersion']):
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_PLACEHOLDER_CHANGED',u'库或占位符配置版本已变化'))
    found=[(item,names) for item,names,aid in walk(project) if aid==args['applicationId'] and
           text(item.guid).lower()==args['managerId'] and text(item.type).lower()==LIB_MANAGER_TYPE and
           getattr(item,'is_libman',False)]
    if len(found)!=1 or len(before['managers'])!=1 or before['managers'][0]['managerId']!=args['managerId']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_MANAGER_CHANGED',u'库管理器身份或数量已变化'))
    manager,_=found[0]
    targets=[r for r in before['references'] if r['managerId']==args['managerId'] and
             r['rawFields'].get('id')==args['placeholderReferenceId']]
    if len(targets)!=1:
        lifecycle_reject(lifecycle,failure('conflict','PLACEHOLDER_NOT_UNIQUE',u'指定占位符身份不存在或不唯一'))
    target=targets[0];fields=target['rawFields']
    if (fields.get('is_placeholder') is not True or fields.get('is_managed') is not False or
        fields.get('system_library') is not False or not fields.get('placeholder_name') or
        fields.get('explicit_redirection')!=args['expectedExplicitRedirection'] or
        bool(fields.get('explicit_redirection'))!=fields.get('is_redirected') or
        (fields.get('explicit_redirection') and fields.get('effective_resolution')!=fields.get('explicit_redirection')) or
        (not fields.get('explicit_redirection') and
         (not unresolved_native_resolution(fields.get('effective_resolution')) or
          not unresolved_native_resolution(fields.get('resolution_info'))))):
        lifecycle_reject(lifecycle,failure('unsupported','PLACEHOLDER_OWNERSHIP_UNCONFIRMED',u'目标并非可确认的应用级普通占位符，或解析来源不明'))
    native=[r for r in manager.references if text(r.id)==args['placeholderReferenceId']]
    if len(native)!=1 or not native[0].is_placeholder or native[0].system_library:
        lifecycle_reject(lifecycle,failure('conflict','PLACEHOLDER_NATIVE_CHANGED',u'原生占位符身份已变化'))
    catalog,installed=installed_inventory()
    if not catalog['enumerationComplete'] or catalog['catalogVersion']!=args['expectedCatalogVersion']:
        lifecycle_reject(lifecycle,failure('conflict','INSTALLED_CATALOG_CHANGED',u'已安装库目录版本或完整性已变化'))
    rows=[r for r in catalog['entries'] if r['identity']==args['installedIdentity']]
    if len(rows)!=1 or len(installed.get(args['installedIdentity'],[]))!=1:
        lifecycle_reject(lifecycle,failure('conflict','INSTALLED_LIBRARY_AMBIGUOUS',u'目标已安装库身份不唯一'))
    selected=rows[0];display=selected['displayName']
    if not display or selected['defaultNamespace']!=fields['namespace']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_NAMESPACE_CHANGED',u'占位符和目标库命名空间不一致'))
    if fields.get('explicit_redirection')==display:
        return success(u'显式应用级覆盖已精确存在；未保存',dict(projectId=args['projectId'],
            applicationId=args['applicationId'],managerId=args['managerId'],placeholderReferenceId=args['placeholderReferenceId'],
            installedIdentity=args['installedIdentity'],installed=selected,catalogVersion=catalog['catalogVersion'],
            before=before,after=before,targetBefore=target,targetAfter=target,
            beforePlaceholderVersion=before['placeholderConfigurationVersion'],
            placeholderVersion=before['placeholderConfigurationVersion'],changed=False,noOp=True,reopened=False,
            snapshot=snapshot(project),diskHash=file_hash(req['projectPath']))),project
    source_snapshot=snapshot(project)
    def check_after(owner,previous):
        inventory=library_inventory(owner,args)
        if not complete_placeholder_inventory(inventory):raise ValueError('Placeholder inventory incomplete')
        refs=inventory['references']
        if len(refs)!=len(previous['references']) or inventory['managers']!=previous['managers']:
            raise ValueError('Library manager or reference enumeration changed')
        changed=[]
        for old,new in zip(previous['references'],refs):
            if old['managerId']!=new['managerId'] or old['order']!=new['order'] or old['rawFields'].get('id')!=new['rawFields'].get('id'):
                raise ValueError('Reference identity/order changed')
            if old['rawFields'].get('id')==args['placeholderReferenceId']:
                allowed=('explicit_redirection','is_redirected','effective_resolution','resolution_info')
                if any(old['rawFields'].get(k)!=new['rawFields'].get(k) for k in old['rawFields'] if k not in allowed):
                    raise ValueError('Target placeholder declaration changed')
                if (new['rawFields'].get('explicit_redirection')!=display or
                    new['rawFields'].get('is_redirected') is not True or
                    new['rawFields'].get('effective_resolution')!=display):
                    raise ValueError('Explicit/effective resolution readback mismatch')
                changed.append(new)
            elif old!=new:raise ValueError('Other library reference or override changed')
        if len(changed)!=1 or snapshot(owner)!=source_snapshot:raise ValueError('Placeholder/source evidence changed')
        return inventory,changed[0]
    try:
        native[0].set_redirection(display)
        immediate,changed=check_after(project,before)
        project=lifecycle_save_reopen(lifecycle)
        reopened,changed_reopened=check_after(project,before)
        if reopened['references']!=immediate['references'] or reopened['managers']!=immediate['managers']:
            raise ValueError('Placeholder resolution changed after save/reopen')
        return success(u'原生应用级占位符显式覆盖已设置并保存重开核对',dict(projectId=args['projectId'],
            applicationId=args['applicationId'],managerId=args['managerId'],placeholderReferenceId=args['placeholderReferenceId'],
            installedIdentity=args['installedIdentity'],installed=selected,catalogVersion=catalog['catalogVersion'],
            before=before,after=reopened,targetBefore=target,targetAfter=changed_reopened,
            beforePlaceholderVersion=before['placeholderConfigurationVersion'],
            placeholderVersion=reopened['placeholderConfigurationVersion'],changed=True,reopened=True,
            checkpoint=req['checkpointPath'],persistedToWorkingCopy=True,snapshot=snapshot(project),
            diskHash=file_hash(req['projectPath']))),project
    except Exception as error:
        return failure('unknown','PARTIAL_PLACEHOLDER_RESOLVE',u'占位符设置或保存读回不确定；保留工程、检查点和原始异常',
            {'primaryException':exception_evidence(error),'checkpoint':req['checkpointPath'],
             'writeStarted':True,'saveAttempts':lifecycle['saveAttempts']}),project

def library_reference_add(project,req,args,lifecycle):
    if file_hash(req['projectPath']) != args['expectedDiskHash']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_DISK_CHANGED',
            u'工程磁盘版本已变化，未添加直接库引用'))
    before = library_inventory(project,args)
    if not complete_library_inventory(before):
        lifecycle_reject(lifecycle,failure('unsupported','LIBRARY_CONFIGURATION_INCOMPLETE',
            u'库管理器或直接引用字段读取不完整，写入前停止'))
    before_version = library_configuration_version(before)
    if before_version != args['expectedReferenceVersion']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_REFERENCES_CHANGED',
            u'直接库引用配置版本已变化，未添加'))
    matches = [(item,names,aid) for item,names,aid in walk(project)
               if aid==args['applicationId'] and text(item.guid).lower()==args['managerId'] and
               text(item.type).lower()==LIB_MANAGER_TYPE and getattr(item,'is_libman',False)]
    if len(matches)!=1 or len(before['managers'])!=1 or before['managers'][0]['managerId']!=args['managerId']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_MANAGER_CHANGED',u'目标Application的原生库管理器身份或数量已变化，未添加'))
    manager,manager_path,_ = matches[0]
    catalog,native = installed_inventory()
    if not catalog['enumerationComplete'] or catalog['catalogVersion']!=args['expectedCatalogVersion']:
        lifecycle_reject(lifecycle,failure('conflict','INSTALLED_CATALOG_CHANGED',u'本机已安装库目录或覆盖状态已变化，未添加'))
    chosen = [r for r in catalog['entries'] if r['identity']==args['installedIdentity']]
    if len(chosen)!=1 or len(native.get(args['installedIdentity'],[]))!=1:
        lifecycle_reject(lifecycle,failure('conflict','INSTALLED_LIBRARY_AMBIGUOUS',u'指定已安装库身份不唯一或不再存在，未添加'))
    row=chosen[0];lib=native[args['installedIdentity']][0]
    if not row['defaultNamespace'] or row['defaultNamespace']!=args['expectedNamespace']:
        lifecycle_reject(lifecycle,failure('conflict','LIBRARY_NAMESPACE_CHANGED',u'原生命名空间与查询证据不同，未添加'))
    exact_found=False
    for reference in manager.references:
        name=text(reference.name);namespace=text(reference.namespace)
        if name.lower()==row['displayName'].lower():
            if reference.is_managed and not reference.is_placeholder and namespace==row['defaultNamespace']:
                try:
                    managed=reference.managed_library
                    if [text(getattr(managed,k)) for k in ('displayname','company','title','version','default_namespace')]==\
                       [row[k] for k in ('displayName','company','title','version','defaultNamespace')] and\
                       text(librarymanager.get_file_path(managed))==row['repositoryFile']:
                        if exact_found:lifecycle_reject(lifecycle,failure('conflict','LIBRARY_REFERENCE_COLLISION',u'存在重复的精确直接引用，未添加'))
                        exact_found=True;continue
                except Exception:pass
            lifecycle_reject(lifecycle,failure('conflict','LIBRARY_REFERENCE_COLLISION',u'同名直接引用存在但原生身份或命名空间不一致，未添加'))
        if namespace.lower()==row['defaultNamespace'].lower():
            lifecycle_reject(lifecycle,failure('conflict','LIBRARY_NAMESPACE_COLLISION',u'直接引用已有同名命名空间，未添加'))
        if reference.is_managed:
            try:
                managed=reference.managed_library
                if text(managed.title).lower()==row['title'].lower() and text(managed.company).lower()==row['company'].lower():
                    lifecycle_reject(lifecycle,failure('conflict','LIBRARY_VERSION_COLLISION',u'同一厂商库的其他直接版本已存在，未添加'))
            except Exception as error:
                if lifecycle.get('rejection'):raise
                lifecycle_reject(lifecycle,failure('unsupported','LIBRARY_IDENTITY_INCOMPLETE',u'现有直接引用的原生库身份无法核实：'+text(error)))
        if reference.is_placeholder:
            try:
                if text(reference.placeholder_name).lower()==row['title'].lower():
                    lifecycle_reject(lifecycle,failure('conflict','LIBRARY_PLACEHOLDER_COLLISION',u'现有占位符与目标库同名，未自动重定向或添加'))
            except Exception as error:
                if lifecycle.get('rejection'):raise
                lifecycle_reject(lifecycle,failure('unsupported','LIBRARY_PLACEHOLDER_INCOMPLETE',u'占位符身份无法核实：'+text(error)))
    if exact_found:
        return success(u'精确直接引用及命名空间已存在；未保存',dict(projectId=args['projectId'],
            applicationId=args['applicationId'],managerId=args['managerId'],installedIdentity=row['identity'],
            before=before,after=before,beforeReferenceVersion=before_version,referenceVersion=before_version,
            catalogVersion=catalog['catalogVersion'],changed=False,noOp=True,reopened=False,
            snapshot=snapshot(project),diskHash=file_hash(req['projectPath']))),project
    before_snapshot=snapshot(project)
    before_refs=before['references']
    def confirmed_native_reference(owner):
        found=[r for r in owner.references if text(r.name).lower()==row['displayName'].lower()]
        if len(found)!=1 or not found[0].is_managed or found[0].is_placeholder or text(found[0].namespace)!=row['defaultNamespace']:
            raise ValueError('Added native reference not unique or not managed at requested namespace')
        managed=found[0].managed_library
        values=[text(getattr(managed,k)) for k in ('displayname','company','title','version','default_namespace')]
        file_path=text(librarymanager.get_file_path(managed))
        if values!=[row[k] for k in ('displayName','company','title','version','defaultNamespace')] or\
           file_path!=row['repositoryFile']:
            raise ValueError('Added native ManagedLib identity differs from installed catalog')
        return {'displayName':values[0],'company':values[1],'title':values[2],
                'version':values[3],'defaultNamespace':values[4],'repositoryFile':file_path}
    write_started=False
    try:
        write_started=True
        manager.add_library(lib)
        native_before_save=confirmed_native_reference(manager)
        after_set=library_inventory(project,args)
        if not complete_library_inventory(after_set):
            raise ValueError('Direct reference readback incomplete')
        added=[r for r in after_set['references'] if r['managerId']==args['managerId'] and
               r['rawFields'].get('name','').lower()==row['displayName'].lower()]
        if (len(added)!=1 or added[0]['rawFields'].get('namespace')!=row['defaultNamespace'] or
            added[0]['rawFields'].get('is_managed') is not True or added[0]['rawFields'].get('is_placeholder') is not False):
            raise ValueError('Added direct reference identity/namespace readback differs')
        if (len(after_set['references'])!=len(before_refs)+1 or
            [r['rawFields'] for r in after_set['references'] if r not in added]!=[r['rawFields'] for r in before_refs]):
            raise ValueError('Other direct references changed during add')
        if snapshot(project)!=before_snapshot:raise ValueError('ST source changed during library add')
        project=lifecycle_save_reopen(lifecycle)
        reopened_manager=[item for item,names,aid in walk(project) if aid==args['applicationId'] and
                          text(item.guid).lower()==args['managerId'] and text(item.type).lower()==LIB_MANAGER_TYPE]
        if len(reopened_manager)!=1:raise ValueError('Library manager identity changed on reopen')
        native_after_reopen=confirmed_native_reference(reopened_manager[0])
        after=library_inventory(project,args)
        if not complete_library_inventory(after):raise ValueError('Reopened direct reference inventory incomplete')
        if after['references']!=after_set['references'] or after['managers']!=after_set['managers'] or snapshot(project)!=before_snapshot:
            raise ValueError('Library configuration/source changed on save and reopen')
        return success(u'精确已安装库已加入直接引用并保存重开核对',dict(projectId=args['projectId'],
            applicationId=args['applicationId'],managerId=args['managerId'],installedIdentity=row['identity'],
            installed=row,addedReference=added[0],nativeBeforeSave=native_before_save,
            nativeAfterReopen=native_after_reopen,before=before,after=after,
            beforeReferenceVersion=before_version,referenceVersion=library_configuration_version(after),
            catalogVersion=catalog['catalogVersion'],changed=True,reopened=True,checkpoint=req['checkpointPath'],
            persistedToWorkingCopy=True,snapshot=snapshot(project),diskHash=file_hash(req['projectPath']))),project
    except Exception as error:
        return failure('unknown','PARTIAL_LIBRARY_ADD',u'库添加或持久化结果不确定；保留文件、检查点和原始异常，不自动移除或重开',
            {'primaryException':exception_evidence(error),'checkpoint':req['checkpointPath'],
             'writeStarted':write_started,'saveAttempts':lifecycle['saveAttempts']}),project
