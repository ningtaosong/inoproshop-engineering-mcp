# -*- coding: utf-8 -*-
"""Local test only. No product dispatch, PLC, or device repository writes."""
import io
import json
import os
import re
import sys
import traceback
from System.Diagnostics import Process
from scriptengine import device_repository, projects, system

IDENTITY = ('type', 'id', 'deviceDescriptionVersion')
NAME = 'S6bProbeDevice'
SOURCE = '# Fixed helper code only; request text is never evaluated.'


def guid(obj):
    return unicode(obj.guid).lower()


def ident(obj):
    return dict(type=unicode(obj.type), id=unicode(obj.id), deviceDescriptionVersion=unicode(obj.version))


def native_snapshot(project):
    items, nodes = {}, []
    def visit(parent, parent_guid, path):
        children = list(parent.get_children(False))
        for index, item in enumerate(children):
            key, name = guid(item), unicode(item.get_name())
            if key in items:
                raise ValueError('Unexpected repeated native GUID')
            node = dict(guid=key, name=name, parentGuid=parent_guid, index=index, path=path+[name],
                        nativeType=unicode(item.type).lower(), device=bool(getattr(item,'is_device',False)),
                        explicit=bool(getattr(item,'is_explicit_connector',False)))
            if node['device']:
                try: node['identity'] = ident(item.get_device_identification())
                except Exception as exc: node['identityReadError'] = unicode(exc)
            if node['explicit']:
                try: node['connector'] = connector(item)
                except Exception as exc: node['connectorReadError'] = unicode(exc)
            nodes.append(node)
            items[key] = item
            visit(item,key,node['path'])
    visit(project,None,[])
    return nodes, items


def connector(obj):
    return dict(id=int(obj.connector_id), interface=unicode(obj.interface),
                role=unicode(obj.connector_role), hostPath=int(obj.host_path), explicit=bool(obj.is_explicit))


def children(nodes, key):
    return [node for node in nodes if node['parentGuid']==key]


def parent_observations(nodes, items):
    result = []
    for row in nodes:
        if not (row['device'] or row['explicit']):
            continue
        item = items[row['guid']]
        methods = {}
        for name in ('allowed_interfaces_at','allow_interfaces_at','insert','add','plug','update'):
            method = getattr(item,name,None)
            if callable(method):
                methods[name] = unicode(method.__doc__).strip()
        entry = dict(node=row,children=children(nodes,row['guid']),nativeMethods=methods)
        try:
            entry['observedConnectors'] = [row['connector']] if row['explicit'] else [connector(c) for c in item.connectors]
        except Exception as exc:
            entry['connectorReadError'] = unicode(exc)
        entry['appendIndex'] = len(entry['children'])
        fn = getattr(item,'allowed_interfaces_at',None) or getattr(item,'allow_interfaces_at',None)
        if callable(fn):
            try:
                allowed = fn(entry['appendIndex'])
                entry['allowedAtAppend'] = [unicode(x) for x in allowed] if allowed is not None else None
            except Exception as exc:
                entry['appendReadError'] = unicode(exc)
        result.append(entry)
    return result


def inventory(api, placements):
    summary = api['device_catalog_inventory'](device_repository)
    installed = summary['entries']
    requested = set(n for p in placements for n in (p.get('allowedAtAppend') or []))
    by_id = {}
    for row in installed:
        by_id.setdefault(tuple(row[k] for k in IDENTITY),[]).append(row)
    candidates, failures = [], []
    for description in device_repository.get_all_devices():
        try:
            native = ident(description.device_id)
            matching = [c for c in [connector(x) for x in description.connectors]
                        if c['role']=='Child' and c['interface'] in requested]
            if not matching:
                continue
            same = by_id.get(tuple(native[k] for k in IDENTITY),[])
            candidates.append(dict(identity=native,installedMatches=same,compatibleChildConnectors=matching,
                                   module=bool(getattr(description.device_id,'module_id',None))))
        except Exception as exc:
            failures.append(dict(message=unicode(exc)))
    return dict(scope=summary['scope'],installedEntries=len(installed),matches=candidates,metadataReadFailures=failures)


def comparable(nodes):
    """Native task-call proxy GUID can be regenerated when the same file opens."""
    task_type = '98a2708a-9b18-4f31-82ed-a1465b24fa2d'
    call_type = '413e2a7d-adb1-4d2c-be29-6ae6e4fab820'
    by_id = {row['guid']:row for row in nodes}
    occupied = set(row.get('parentGuid') for row in nodes)
    return [dict(row,guid=None)
            if row.get('nativeType')==call_type and row.get('guid') not in occupied and
               by_id.get(row.get('parentGuid'),{}).get('nativeType')==task_type else row for row in nodes]


def rejection(plan, nodes, placements, repo):
    """Append only to a read-confirmed vacant connector; never use plug/update."""
    item = plan['candidate']
    wanted = plan['parentGuid']
    if comparable(nodes) != comparable(plan['nodes']):
        return 'TREE_CHANGED'
    copies = [entry for entry in repo['matches'] if entry['identity']==item['identity']]
    if (repo['scope']['truncated'] or repo['scope']['enumerationFailures'] or repo.get('metadataReadFailures') or
            len(copies)!=1 or len(copies[0]['installedMatches'])!=1 or copies[0]!=item or item['module']):
        return 'IDENTITY_UNCONFIRMED'
    where = {p['node']['guid']:p for p in placements}
    parent = where.get(wanted)
    if not parent or not (parent['node'].get('explicit') or parent['node'].get('device')):
        return 'PARENT_INCOMPATIBLE'
    if parent['appendIndex']!=plan['index'] or len(parent['children'])!=plan['index']:
        return 'POSITION_OCCUPIED_OR_UNCONFIRMED'
    if any(row['name'].lower()==plan['name'].lower() for row in nodes):
        return 'NAME_CONFLICT'
    link = plan['parentConnector']
    allowed = parent.get('allowedAtAppend')
    if (not allowed or link['role']!='Parent' or link['interface'] not in allowed or
            'insert' not in parent['nativeMethods'] or len(item['compatibleChildConnectors'])!=1 or
            item['compatibleChildConnectors'][0]['role']!='Child' or
            item['compatibleChildConnectors'][0]['interface']!=link['interface']):
        return 'PARENT_INCOMPATIBLE'
    connectors = parent.get('observedConnectors',[])
    matching = [c for c in connectors if c['role']=='Parent' and c['interface']==link['interface']]
    if matching!=[link]:
        return 'PARENT_INCOMPATIBLE'
    if parent['node'].get('explicit'):
        return 'POSITION_OCCUPIED_OR_UNCONFIRMED' if parent['children'] else None
    if link['explicit']:
        return 'PARENT_INCOMPATIBLE'
    direct_ids = set(child['guid'] for child in parent['children'])
    # Implicit slot coverage requires all device children to be direct, and no
    # explicit connector nodes under this device whose occupancy is unknown.
    prefix = parent['node']['path']
    for node in nodes:
        if node['path'][:len(prefix)]!=prefix or node['guid']==wanted:
            continue
        if node.get('explicit') or node.get('device') and node['guid'] not in direct_ids:
            return 'POSITION_OCCUPIED_OR_UNCONFIRMED'
    for child in parent['children']:
        if not child['device']:
            continue
        child_native = where.get(child['guid'],{}).get('observedConnectors',[])
        upstream = [c for c in child_native if c['role']=='Child']
        if len(upstream)!=1:
            return 'POSITION_OCCUPIED_OR_UNCONFIRMED'
        if upstream[0]['interface']==link['interface']:
            return 'POSITION_OCCUPIED_OR_UNCONFIRMED'
    return None


def load_fixed_helpers(repo):
    worker = os.path.join(repo,'bridge','worker.py')
    api = dict(__file__=worker,projects=projects,system=system,device_repository=device_repository)
    with io.open(worker,'r',encoding='utf-8') as stream:
        full = stream.read()
    if full.count(SOURCE)!=1:
        raise ValueError('Worker helper boundary changed')
    exec(compile(full.split(SOURCE)[0],worker,'exec'),api)
    catalog = os.path.join(repo,'bridge','device_catalog.py')
    with io.open(catalog,'r',encoding='utf-8') as stream:
        exec(compile(stream.read(),catalog,'exec'),api)
    return api


def file_available(api, file_path, expected):
    for suffix in ('.lock','.lck','.~lock','.~u'):
        if os.path.lexists(file_path+suffix):
            raise ValueError('Fixture has a native/external occupancy marker')
    api['direct_exclusive_probe'](file_path)
    if api['file_hash'](file_path)!=expected:
        raise ValueError('Fixture disk SHA-256 changed')


def build(api, project, nodes, items, file_path):
    apps = [n['guid'] for n in nodes if getattr(items[n['guid']],'is_application',False)]
    if len(apps)!=1:
        raise ValueError('Fixture must have exactly one Application')
    digest = api['file_hash'](file_path)
    result = api['compile_application'](project,apps[0],'application')
    if api['file_hash'](file_path)!=digest:
        raise ValueError('Compile changed project file on disk')
    data = result.get('data',{})
    diagnostic = data.get('diagnostics',[])
    return dict(result=result,diskSha256=digest,
                errors=sum(1 for x in diagnostic if x['severity'] in ('error','fatalerror')),
                warnings=sum(1 for x in diagnostic if x['severity']=='warning'))


def task_and_st(api, project, nodes, items):
    tasks = []
    for row in nodes:
        item = items[row['guid']]
        if getattr(item,'is_application',False):
            args = dict(projectId='s6b-fixture',applicationId=row['guid'],targetKind='application')
            tasks.append(api['task_inventory'](project,args))
    return dict(snapshot=api['snapshot'](project),tasks=tasks)


def read_config(node):
    result = dict(scope='Device and connector host parameter top-level rows; offline property values, no mapping reads.')
    parameter_sets = []
    connectors = list(node.connectors)
    result['connectors'] = [connector(x) for x in connectors]
    gaps = []
    for owner,owner_object,prop in [('device',node,'device_parameters')]+[
            ('connector:'+str(c.connector_id),c,'host_parameters') for c in connectors]:
        try:
            group = getattr(owner_object,prop)
            rows = []
            for parameter in group:
                if len(rows)==100:
                    gaps.append(dict(owner=owner,field='limit',message='100 top-level entries'))
                    break
                fields = {}
                for key in ('id','name','value','data_type'):
                    try:
                        value = getattr(parameter,key)
                        fields[key] = unicode(value) if value is not None else None
                    except Exception:
                        fields[key] = None
                        gaps.append(dict(owner=owner,field=key,row=len(rows)))
                rows.append(fields)
            parameter_sets.append(dict(owner=owner,rows=rows))
        except Exception as error:
            gaps.append(dict(owner=owner,field=prop,message=unicode(error)))
    result['parameters'], result['gaps'], result['completeConfiguration'] = parameter_sets, gaps, False
    return result


def assess_after(plan, before, after, new_id):
    target = [n for n in after if n['guid']==new_id]
    if len(target)!=1 or not target[0]['device']:
        raise ValueError('Native return does not identify a unique new device')
    node = target[0]
    if (node['parentGuid']!=plan['parentGuid'] or node['name']!=plan['name'] or
            node['identity']!=plan['candidate']['identity'] or node['index']!=plan['index']):
        raise ValueError('New node has unexpected native parent, name, identity or position')
    stable_before = comparable(before)
    old_ids = set(n['guid'] for n in stable_before)
    stable_after = comparable(after)
    descendants = {new_id}
    if new_id in old_ids:
        raise ValueError('Existing GUID reused')
    generated = []
    for row in stable_after:
        if row['guid']==new_id:
            continue
        if row['guid'] not in old_ids:
            if row['parentGuid'] not in descendants:
                raise ValueError('Additional node outside inserted subtree')
            descendants.add(row['guid'])
            generated.append(row)
    if [r for r in stable_after if r['guid'] not in descendants]!=stable_before:
        raise ValueError('Existing native tree or sibling order changed')
    return dict(added=node,generatedDescendants=generated)


def run_stage(root, repo, mode, api):
    target = os.path.join(root,'AM610_S6b_Probe.project')
    with io.open(os.path.join(root,'fixture-origin.json'),'r',encoding='utf-8-sig') as stream:
        seed = json.load(stream)['initialProjectSha256']
    def emit(name,value):
        api['publish'](os.path.join(root,mode+'-'+name+'.json'),value)
    if projects.primary is not None:
        raise ValueError('Unowned active project')
    attempt = os.path.join(root,'device-insert-dispatched.json')
    if os.path.exists(attempt):
        raise ValueError('The one permitted write was already dispatched; never replay')
    if mode=='insert' and not os.path.isfile(os.path.join(root,'read-complete.json')):
        raise ValueError('Completed first read required')
    file_available(api,target,seed)
    emit('open-start',{'path':target,'mainSha256':seed})
    handle = projects.open(target)
    emit('open-end',{'actualPath':unicode(handle.path)})
    if os.path.normcase(unicode(handle.path))!=os.path.normcase(target):
        raise ValueError('Unowned or mismatched fixture path')

    def read_state(project):
        nodes, mapping = native_snapshot(project)
        placements = parent_observations(nodes,mapping)
        return nodes,mapping,placements,inventory(api,placements)

    try:
        nodes,mapping,placements,catalog = read_state(handle)
        controls = task_and_st(api,handle,nodes,mapping)
        if mode=='read':
            report = dict(nodes=nodes,placements=placements,catalog=catalog,readableTasksAndST=controls)
            emit('snapshot',report)
            emit('baseline',build(api,handle,nodes,mapping,target))
            handle.close()
            handle = None
            file_available(api,target,seed)
            emit('complete',{'status':'read-only','mainSha256':seed,'saveOrWriteDispatched':False})
            return
        with io.open(os.path.join(root,'plan.json'),'r',encoding='utf-8-sig') as stream:
            plan = json.load(stream)
        with io.open(os.path.join(root,'read-baseline.json'),'r',encoding='utf-8') as stream:
            baseline = json.load(stream)
        if not baseline['result']['data']['buildPassed'] or baseline['diskSha256']!=seed or controls!=plan['readableTasksAndST']:
            raise ValueError('Baseline build or original task/ST evidence differs')
        if plan['name']!=NAME or api['file_hash'](target)!=seed or rejection(plan,nodes,placements,catalog):
            raise ValueError('Exact plan, current structure, slot or description no longer eligible')
        type_id = plan['candidate']['identity']
        description_id = device_repository.create_device_identification(
            int(type_id['type']),type_id['id'],type_id['deviceDescriptionVersion'])
        resolved = device_repository.get_device(description_id)
        if resolved is None or ident(resolved.device_id)!=type_id or len([
                connector(row) for row in resolved.connectors
                if connector(row)==plan['candidate']['compatibleChildConnectors'][0]])!=1:
            raise ValueError('Exact repository readback differs')
        parent = mapping[plan['parentGuid']]
        # Bind actual dispatch to a one-time mark. No capabilities that replace,
        # remove or move a node; an exception after the mark stops the sequence.
        api['publish'](attempt,dict(parentGuid=plan['parentGuid'],index=plan['index'],name=plan['name'],
                                   identity=type_id,mainSha256=seed))
        returned = parent.insert(plan['name'],plan['index'],int(type_id['type']),type_id['id'],type_id['deviceDescriptionVersion'],None)
        immediate, after_items = native_snapshot(handle)
        new_refs = [r for r in immediate if r['parentGuid']==plan['parentGuid'] and r['name']==plan['name']]
        if len(new_refs)!=1:
            raise ValueError('No unique new node readback')
        new_id = new_refs[0]['guid']
        returned_id = guid(returned) if returned is not None and hasattr(returned,'guid') else None
        emit('native-return',dict(returnType=unicode(type(returned)),returnedGuid=returned_id,
                                  guidFromTree=new_id,wasNone=returned is None))
        if returned_id is not None and returned_id!=new_id:
            raise ValueError('Native return and readback disagree')
        immediate_result = assess_after(plan,nodes,immediate,new_id)
        if task_and_st(api,handle,immediate,after_items)!=controls:
            raise ValueError('Readable original task or ST evidence changed')
        config = read_config(after_items[new_id])
        emit('write-readback',dict(tree=immediate,delta=immediate_result,initialConfiguration=config))
        emit('save-start',{'nodeGuid':new_id})
        handle.save()
        handle.close()
        handle = None
        saved = api['file_hash'](target)
        if saved==seed:
            raise ValueError('Saved file fingerprint did not change')
        file_available(api,target,saved)
        emit('saved-closed',{'sha256':saved})
        handle = projects.open(target)
        if os.path.normcase(unicode(handle.path))!=os.path.normcase(target):
            raise ValueError('Reopened wrong fixture')
        reopened, reopened_items = native_snapshot(handle)
        reopened_result = assess_after(plan,nodes,reopened,new_id)
        reopened_config = read_config(reopened_items[new_id])
        emit('reopen-readback',dict(tree=reopened,delta=reopened_result,initialConfiguration=reopened_config,
                                    matchesWriteTree=comparable(reopened)==comparable(immediate),configurationMatches=reopened_config==config))
        if comparable(reopened)!=comparable(immediate) or reopened_config!=config or task_and_st(api,handle,reopened,reopened_items)!=controls:
            raise ValueError('Reopened evidence differs')
        compiled = build(api,handle,reopened,reopened_items,target)
        emit('saved-build',compiled)
        final_nodes, final_items = native_snapshot(handle)
        if comparable(final_nodes)!=comparable(reopened) or task_and_st(api,handle,final_nodes,final_items)!=controls:
            raise ValueError('Compile changed native tree, readable tasks or ST')
        handle.close()
        handle = None
        file_available(api,target,saved)
        emit('complete',dict(status='verified',addDispatchedOnce=True,savedReopenVerified=True,
                             buildPassed=compiled['result']['data']['buildPassed'],mainSha256=saved))
    except Exception:
        # Preserve any uncertain open/write state for an explicit decision.
        if handle is not None and not os.path.exists(attempt):
            handle.close()
        raise


if __name__=='__main__':
    import scriptengine
    root = os.path.abspath(os.environ['INOPRO_S6B_PROBE_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S6B_PROBE_REPO'])
    mode = os.environ['INOPRO_S6B_PROBE_MODE']
    if not re.match(r'^D:\\InoPro-S6b-DeviceAdd-[0-9-]+$',root,re.I) or mode not in ('read','insert'):
        raise ValueError('Dedicated fixture and supported stage required')
    api = load_fixed_helpers(repo)
    p = Process.GetCurrentProcess()
    api['publish'](os.path.join(root,mode+'-engine.json'),
        dict(pid=p.Id,creationTicks=unicode(p.StartTime.ToUniversalTime().Ticks),ironPython=sys.version,
             executableVersion=unicode(p.MainModule.FileVersionInfo.FileVersion)))
    try:
        system.execute_on_primary_thread(lambda:run_stage(root,repo,mode,api))
    except Exception:
        dispatched = os.path.exists(os.path.join(root,'device-insert-dispatched.json'))
        api['publish'](os.path.join(root,mode+'-error.json'),
                       dict(dispatched=dispatched,traceback=traceback.format_exc()))
        if not dispatched:
            system.exit()
    else:
        system.exit()
