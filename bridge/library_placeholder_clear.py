# -*- coding: utf-8 -*-
"""Fixed public application override clear. No resolution prediction or active load."""
import copy

CLEAR_DEFAULT = u'CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)'
CLEAR_OVERRIDE = u'CAA Mathematics, 3.5.7.0 (CAA Technical Workgroup)'
CLEAR_FIELDS = ('explicit_redirection', 'is_redirected', 'effective_resolution', 'resolution_info')


def clear_require(condition, message):
    if not condition:raise ValueError(message)


def clear_target(inventory, args, redirected):
    clear_require(complete_placeholder_inventory(inventory), 'Library enumeration/fields incomplete')
    clear_require(len(inventory['managers']) == 1 and inventory['managers'][0]['managerId'] == args['managerId'], 'Manager identity/count changed')
    ids=set();names=set()
    for row in inventory['references']:
        fields=row['rawFields'];identity=(row['managerId'], fields['id'])
        clear_require(identity not in ids, 'Duplicate native reference identity');ids.add(identity)
        if fields['is_placeholder']:
            for key in ('placeholder_name','default_resolution','effective_resolution','resolution_info','explicit_redirection','resolver_guid'):
                clear_require(key in fields and (fields[key] is None or isinstance(fields[key],basestring)), 'Missing/invalid placeholder field '+key)
            clear_require(isinstance(fields.get('is_redirected'),bool), 'Missing native redirection flag')
            clear_require(isinstance(fields['placeholder_name'],basestring) and fields['placeholder_name'], 'Missing placeholder name')
            name=(row['managerId'],fields['placeholder_name'].lower())
            clear_require(name not in names, 'Ambiguous placeholder name');names.add(name)
    matches=[r for r in inventory['references'] if r['managerId']==args['managerId'] and r['rawFields']['id']==args['placeholderReferenceId']]
    clear_require(len(matches)==1, 'Placeholder native identity not unique')
    row=matches[0];f=row['rawFields']
    clear_require(f['is_placeholder'] is True and f['is_managed'] is False and f['system_library'] is False and
        f['optional'] is False and f['qualified_only'] is False and f['placeholder_name']==u'CAA Mathematics' and
        f['name']==u'#CAA Mathematics' and f['namespace']==u'MATH' and f['default_resolution']==CLEAR_DEFAULT,
        'Outside tested ordinary CAA Mathematics combination')
    if redirected:
        clear_require(args['expectedExplicitRedirection']==CLEAR_OVERRIDE and f['explicit_redirection']==CLEAR_OVERRIDE and
            f['is_redirected'] is True and f['effective_resolution']==CLEAR_OVERRIDE, 'Explicit application override absent/changed')
    else:
        clear_require(f['explicit_redirection'] is None and f['is_redirected'] is False, 'Clear not confirmed as native null/false')
    return row


def clear_resolution(row):
    f=row['rawFields'];value=f['effective_resolution']
    clear_require(value is None or isinstance(value,basestring), 'Effective resolution has invalid native type')
    state='native-null' if value is None else 'empty-text' if value==u'' else 'literal-None' if value==u'None' else 'text'
    return dict(status='native-unresolved' if state!='text' else 'native-resolution-reported',
        effectiveResolution=value,resolutionInfo=f['resolution_info'],resolverGuid=f['resolver_guid'],valueState=state,
        source='native effective_resolution / resolution_info / resolver_guid',loadedStatus='not-independently-verified')


def clear_inventory_projection(inventory, target):
    value=copy.deepcopy(inventory)
    # Rewrite only the four authorized values in a comparison copy. All other,
    # including newly added/removed fields and native enumeration order, remain.
    row=value['references'][target['index']]
    for key in CLEAR_FIELDS:row['rawFields'][key]=target['rawFields'][key]
    row['resolutionStatus']=target['resolutionStatus']
    value['configurationVersion']=library_configuration_version(value)
    value['placeholderConfigurationVersion']=placeholder_configuration_version(value)
    return value


def clear_state_view(state):
    value=dict(state)
    value['tasks']={aid:task_call_inventory_view(inv) for aid,inv in state['tasks'].items()}
    return value


def clear_compare(before, after, args, allow_clear=False):
    target=clear_target(after['library'],args,not allow_clear)
    expected=copy.deepcopy(before)
    if allow_clear:expected['library']=clear_inventory_projection(before['library'],target)
    diff=task_create_difference(clear_state_view(expected),clear_state_view(after))
    clear_require(diff is None, 'Placeholder preservation differs: '+encode(diff))
    return target


def clear_capture(project,args):
    version=task_replace_ide_version()
    clear_require(version=='1.9.1.6','Unsupported native IDE version')
    rows=list(walk(project));inventory=library_inventory(project,args)
    prefix=inventory['applicationPath'];aid=args['applicationId']
    apps=[x for x,n,a in rows if a==aid and n==prefix and getattr(x,'is_application',False)]
    devices=[(x,n) for x,n,a in rows if getattr(x,'is_device',False) and n+[u'Plc Logic']==prefix[:-1]]
    managers=[x for x,n,a in rows if a==aid and n[:-1]==prefix and text(x.guid).lower()==args['managerId'] and
              text(x.type).lower()==LIB_MANAGER_TYPE and getattr(x,'is_libman',False)]
    clear_require(len(apps)==1 and len(devices)==1 and len(managers)==1,'Application/device/root manager ownership ambiguous')
    device,device_path=devices[0];ident=device.get_device_identification()
    controller=dict(type=int(ident.type),id=text(ident.id),version=text(ident.version))
    clear_require(controller==dict(type=4102,id='10f4 0002',version='3.5.11.11'),'Unsupported AM610 description')
    # Original inspection exposes native strings. Recheck types before conversion
    # on this write path; do not change the existing read/resolve contracts.
    native=list(managers[0].references)
    clear_require(len(native)==len(inventory['references']),'Native reference enumeration changed during read')
    for ref,row in zip(native,inventory['references']):
        f=row['rawFields'];clear_require(text(ref.id)==f['id'],'Native reference identity changed')
        keys=('name','namespace')+ (('placeholder_name','default_resolution','effective_resolution','resolution_info') if ref.is_placeholder else ())
        for key in keys:
            val=getattr(ref,key)
            clear_require((val is None or isinstance(val,basestring)) and val==f[key], 'Native string type/value changed: '+key)
        if ref.is_placeholder:
            val=ref.get_redirection()
            clear_require((val is None or isinstance(val,basestring)) and val==f['explicit_redirection'],'Native override type/value changed')
    source=[];tasks={};identities=set()
    for obj,names,app_id in rows:
        identity=text(obj.guid).lower()
        if getattr(obj,'is_application',False):
            clear_require(identity not in tasks,'Duplicate Application identity')
            tasks[identity]=task_inventory(project,dict(args,applicationId=identity),task_append_call_row)
            task_call_inventory_view(tasks[identity])
        has_d=bool(getattr(obj,'has_textual_declaration',False));has_i=bool(getattr(obj,'has_textual_implementation',False))
        if has_d or has_i:
            clear_require(identity not in identities,'Duplicate source identity');identities.add(identity)
            record=dict(objectId=identity,path=names,applicationId=app_id,nativeTypeId=text(obj.type).lower(),
                declaration=text(obj.textual_declaration.text) if has_d else None,
                implementation=text(obj.textual_implementation.text) if has_i else None)
            if text(obj.type).lower()=='6f9dac99-8de1-4efc-8465-68ac443b7d08':
                record['embeddedObjectTypes']=[text(v).lower() for v in obj.embedded_object_types]
            source.append(record)
    source.sort(key=lambda v:v['objectId'])
    state=dict(library=inventory,tasks=tasks,sources=source,snapshot=snapshot(project),
        nativeScope=dict(ideVersion=version,deviceObjectId=text(device.guid).lower(),devicePath=device_path,
            controller=controller,applicationId=aid,applicationPath=prefix,managerId=args['managerId']))
    return state,managers[0],native


def library_placeholder_clear(project,req,args,lifecycle):
    directory=os.path.dirname(req['resultPath']);errors=[];dispatched=False;observed={};stage='before'
    def evidence(name,value):
        try:publish(os.path.join(directory,'placeholder-clear-'+name+'.json'),value)
        except Exception as e:
            errors.append(dict(stage=name,exception=exception_evidence(e)))
            raise
    try:
        clear_require(file_hash(req['projectPath'])==args['expectedDiskHash'],'Disk version changed')
        before,manager,native=clear_capture(project,args);observed['before']=before;evidence('before',before)
        clear_require(before['snapshot']==args['expectedSourceSnapshot'],'Source snapshot changed')
        target=clear_target(before['library'],args,True)
        clear_require(before['library']['configurationVersion']==args['expectedReferenceVersion'] and
            before['library']['placeholderConfigurationVersion']==args['expectedPlaceholderVersion'],'Library configuration changed')
        # A second capture and the actual native reference are from this same handle.
        stage='pre-dispatch';current,manager,native=clear_capture(project,args);evidence(stage,current)
        clear_compare(before,current,args)
        clear_require(file_hash(req['projectPath'])==args['expectedDiskHash'],'Disk changed before dispatch')
        refs=[r for r in native if text(r.id)==args['placeholderReferenceId']]
        clear_require(len(refs)==1,'Native target changed')
        evidence('dispatched',dict(operationId=req['operationId'],requestId=req.get('requestId'),
            referenceId=args['placeholderReferenceId'],method='set_redirection',argument=None,checkpoint=req['checkpointPath']))
        dispatched=True
        refs[0].set_redirection(None)
        stage='immediate';immediate,_,_=clear_capture(project,args);observed[stage]=immediate;evidence(stage,immediate)
        changed=clear_compare(before,immediate,args,True)
        stage='save-reopen';project=lifecycle_save_reopen(lifecycle)
        stage='reopened';after,_,_=clear_capture(project,args);observed[stage]=after;evidence(stage,after)
        restored=clear_compare(before,after,args,True)
        clear_require(task_create_difference(clear_state_view(immediate),clear_state_view(after)) is None,'Clear state differs after reopen')
        evidence('verification',dict(status='succeeded',observed=observed,difference=None))
        return success(u'指定应用显式覆盖已清除并保存重开；实际解析单列，不保证回退版本',dict(
            projectId=args['projectId'],applicationId=args['applicationId'],managerId=args['managerId'],placeholderReferenceId=args['placeholderReferenceId'],
            before=before,immediate=immediate,after=after,targetBefore=target,targetImmediate=changed,targetAfter=restored,
            beforePlaceholderVersion=before['library']['placeholderConfigurationVersion'],placeholderVersion=after['library']['placeholderConfigurationVersion'],
            resolution=clear_resolution(restored),changed=True,cleared=True,reopened=True,buildApplicable=False,
            checkpoint=req['checkpointPath'],persistedToWorkingCopy=True,snapshot=after['snapshot'],diskHash=file_hash(req['projectPath']))),project
    except Exception as error:
        primary=exception_evidence(error)
        try:evidence('failure',dict(stage=stage,dispatched=dispatched,primaryException=primary,observed=observed,publicationErrors=errors))
        except Exception:pass  # The first exception and logger failures remain in the formal result.
        data=dict(primaryException=primary,publicationErrors=errors,stage=stage,writeStarted=dispatched,
            saveAttempts=lifecycle['saveAttempts'],checkpoint=req['checkpointPath'],observed=observed,recovery='not-attempted')
        return failure('unknown' if dispatched or errors else 'conflict',
            'PARTIAL_PLACEHOLDER_CLEAR' if dispatched or errors else 'PLACEHOLDER_CLEAR_PRECONDITION',text(error),data),project
