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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from device_add_preflight import (NAME, comparable, file_available, guid, load_fixed_helpers,
    native_snapshot, read_state, task_and_st, verify_preflight)


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

    try:
        nodes,mapping,placements,catalog,controls = read_state(api,handle,device_repository)
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
        type_id = verify_preflight(api,target,seed,device_repository,plan,
                                   nodes,placements,catalog,controls)
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
    api = load_fixed_helpers(repo,projects,system,device_repository)
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
