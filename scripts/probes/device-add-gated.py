# -*- coding: utf-8 -*-
"""Local, two-stage, one-dispatch device placement experiment."""
import io
import json
import os
import re
import sys
import traceback
from System.Diagnostics import Process
from scriptengine import device_repository, projects, system

sys.dont_write_bytecode=True
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
from device_add_preflight import (Journal, ProbeRejected, check_equal, connector, exception_data,
    file_available, guid, load_fixed_helpers, native_site, native_snapshot, read_state,
    run_primary, task_and_st, verify_preflight, verify_saved_tree)


def local_helpers(filename):
    full=os.path.join(HERE,filename)
    scope=dict(__file__=full,__name__='s6b_probe_utility')
    with io.open(full,'r',encoding='utf-8') as stream:
        exec(compile(stream.read(),full,'exec'),scope)
    return scope


def attachment_evidence(child, parent_id, plan):
    """Trust only a live parent connector object with an independently resolved owner."""
    members=sorted(name for name in dir(child) if 'connector' in name.lower() or 'parent' in name.lower())
    result=dict(status='unavailable',relatedMembers=members)
    for name in ('get_parent_connector','parent_connector'):
        if name not in members:
            continue
        member=getattr(child,name)
        peer=member() if callable(member) else member
        if peer is None or not callable(getattr(peer,'get_device_object',None)):
            continue
        actual=connector(peer)
        owner=guid(peer.get_device_object())
        expected=dict(ownerGuid=parent_id,connector=plan['parentConnector'])
        bound=dict(ownerGuid=owner,connector=actual)
        check_equal('ACTUAL_ATTACHMENT_CHANGED',expected,bound,'$.attachment')
        return dict(status='verified',readBy=name,ownerGuid=owner,connector=actual,relatedMembers=members)
    return result


def export_existing_tree_evidence(project,node,root,stage,api):
    """Retain a native export for review; serialized metadata alone grants no write."""
    target=os.path.join(root,stage+'-device.export')
    method=getattr(project,'export_native',None)
    if not callable(method):
        return dict(available=False)
    try:
        if os.path.exists(target):
            raise ValueError('New export evidence path required')
        method([node],target,False)
        return dict(available=os.path.isfile(target),file=os.path.basename(target),
                    sha256=api['file_hash'](target) if os.path.isfile(target) else None)
    except Exception as error:
        return dict(available=False,diagnostic=exception_data(error,traceback.format_exc()))


def run_probe(root, mode, api):
    shared=local_helpers('device-add-readonly.py')
    legacy=local_helpers('device-add-native.py')
    directory=os.path.join(root,'engineering')
    target=os.path.join(directory,'AM610_S6b_Gated.project')
    load_json=shared['load_json']
    seed=load_json(os.path.join(root,'fixture-origin.json'))['initialProjectSha256']
    marker_path=os.path.join(root,'gated-device-dispatched.json')
    holder=dict(handle=None,owned=False,closed=False,dispatched=False,insertReturned=False,
                attachmentVerified=False,saved=False,persisted=False,savedBuild=None)
    staged={}
    def emit(name,data):
        api['publish'](os.path.join(root,mode+'-'+name+'.json'),data)
    journal=Journal(lambda n,row:emit('step-%03d'%n,row))

    def open_seed(expected):
        if projects.primary is not None:
            raise ProbeRejected('UNOWNED_PROJECT')
        holder['owned']=True
        file_available(api,target,expected)
        holder['handle']=projects.open(target)
        check_equal('PROJECT_PATH_CHANGED',os.path.normcase(target),os.path.normcase(unicode(holder['handle'].path)),'$.projectPath')
        return dict(path=target,expectedSha256=expected,actualSha256=api['file_hash'](target))

    def record_tree(nodes):
        return dict(nodes=nodes,nodeCount=len(nodes))

    def choose():
        journal.step('initial-open',lambda:open_seed(seed))
        project=holder['handle']
        nodes,mapping=native_snapshot(project)
        staged['baseline']=journal.step('baseline-compile',lambda:legacy['build'](api,project,nodes,mapping,target))
        if not staged['baseline']['result']['data']['buildPassed']:
            raise ProbeRejected('BASELINE_BUILD_FAILED',dict(path='$.baseline',actual=staged['baseline']))
        nodes,mapping,placements,catalog,controls=read_state(api,project,device_repository,journal)
        plan=journal.step('first-read-select-placement',lambda:shared['choose_plan'](
            nodes,placements,catalog,controls,target,seed),lambda p:dict(parentGuid=p['parentGuid'],index=p['index'],candidate=p['candidate']))
        verify_preflight(api,target,seed,device_repository,plan,nodes,placements,catalog,controls,journal)
        staged['plan']=plan
        staged['initialExport']=export_existing_tree_evidence(project,mapping[plan['parentGuid']],root,'baseline-parent',api)

    def fresh(binding):
        project=holder['handle']
        check_equal('PROJECT_PATH_CHANGED',os.path.normcase(target),os.path.normcase(unicode(project.path)),'$.projectPath')
        nodes,mapping,placements,catalog,controls=read_state(api,project,device_repository)
        verify_preflight(api,target,seed,device_repository,binding,nodes,placements,catalog,controls)
        return nodes,mapping,placements,catalog,controls

    def cycle():
        prior=load_json(os.path.join(root,'plan-result.json'))
        plan=load_json(os.path.join(root,'placement-plan.json'))
        baseline=load_json(os.path.join(root,'plan-baseline.json'))
        if prior['status']!='succeeded' or not prior['state']['closed'] or not baseline['result']['data']['buildPassed']:
            raise ProbeRejected('BASELINE_NOT_CONFIRMED')
        check_equal('PLAN_BINDING_CHANGED',dict(projectPath=target,mainSha256=seed),
                    dict(projectPath=plan['projectPath'],mainSha256=plan['mainSha256']),'$.binding')
        journal.step('reopen-for-gated-write',lambda:open_seed(seed))
        project=holder['handle']
        nodes,mapping,placements,catalog,controls=read_state(api,project,device_repository,journal)
        identity=verify_preflight(api,target,seed,device_repository,plan,nodes,placements,catalog,controls,journal,cross_open=True)
        journal.step('gate-one-readonly-complete',lambda:dict(eligible=True,parentGuid=plan['parentGuid'],index=plan['index'],
                     connector=plan['parentConnector'],candidate=identity))
        binding=dict(plan,nodes=nodes,nativeSite=native_site(placements,plan['parentGuid']),readableTasksAndST=controls)
        latest,live,latest_places,unused,latest_controls=journal.step('gate-two-same-handle-recheck',
            lambda:fresh(binding),lambda data:dict(nodeCount=len(data[0]),parent=native_site(data[2],plan['parentGuid']),
                                                  diskSha256=api['file_hash'](target),sameHandle=holder['handle'] is project))
        if holder['handle'] is not project or api['file_hash'](target)!=seed:
            raise ProbeRejected('FILE_OR_OPEN_HANDLE_CHANGED')
        if journal.loggingErrors or os.path.exists(marker_path):
            raise ProbeRejected('DISPATCH_EVIDENCE_NOT_READY')
        parent=live[plan['parentGuid']]
        before=latest
        api['publish'](marker_path,dict(path=target,diskSha256=seed,identity=identity,instanceName=plan['name'],index=plan['index'],
                    parentGuid=plan['parentGuid'],parentConnector=plan['parentConnector'],bothGates=True))
        holder['dispatched']=True
        returned=journal.step('native-insert',lambda:parent.insert(
            plan['name'],plan['index'],int(identity['type']),identity['id'],identity['deviceDescriptionVersion'],None),
            lambda value:dict(returnedType=unicode(type(value)),returnedGuid=guid(value) if value is not None and hasattr(value,'guid') else None))
        holder['insertReturned']=True
        immediate,after_items=journal.step('post-insert-tree',lambda:native_snapshot(project),lambda view:record_tree(view[0]))
        names=[n for n in immediate if n['parentGuid']==plan['parentGuid'] and n['name']==plan['name']]
        if len(names)!=1:
            raise ProbeRejected('NEW_NODE_NOT_UNIQUE',dict(path='$.addedNode.count',expected=1,actual=len(names)))
        device_id=names[0]['guid']
        if returned is not None and hasattr(returned,'guid'):
            check_equal('NATIVE_RETURN_GUID_DIFFERS',device_id,guid(returned),'$.insert.returnedGuid')
        delta=journal.step('post-insert-identity-siblings-oem',lambda:legacy['assess_after'](plan,before,immediate,device_id))
        staged['added']=delta
        journal.step('post-insert-task-and-st',lambda:check_equal('TASK_OR_ST_CHANGED',latest_controls,
                     task_and_st(api,project,immediate,after_items),'$.tasksAndSt'))
        configuration=journal.step('post-insert-readable-config',lambda:legacy['read_config'](after_items[device_id]))
        staged['beforeSaveDeviceExport']=export_existing_tree_evidence(project,after_items[device_id],root,'post-insert',api)
        def prove_attachment():
            attachment=attachment_evidence(after_items[device_id],plan['parentGuid'],plan)
            staged['attachment']=attachment
            if attachment['status']!='verified':
                raise ProbeRejected('ACTUAL_ATTACHMENT_UNVERIFIED',dict(path='$.attachment',actual=attachment))
            return attachment
        attachment=journal.step('actual-connector-attachment',prove_attachment)
        holder['attachmentVerified']=True
        if journal.loggingErrors or api['file_hash'](target)!=seed:
            raise ProbeRejected('POST_INSERT_SAVE_EVIDENCE_NOT_READY')
        journal.step('save-verified-offline-placement',project.save)
        holder['saved']=True
        journal.step('close-after-save',project.close)
        holder['handle']=None
        saved=api['file_hash'](target)
        if saved==seed:
            raise ProbeRejected('SAVED_HASH_DID_NOT_CHANGE')
        journal.step('reopen-saved-file',lambda:open_seed(saved))
        after_handle=holder['handle']
        reopened,reopened_items=journal.step('saved-reopen-tree',lambda:native_snapshot(after_handle),lambda view:record_tree(view[0]))
        journal.step('saved-cross-open-tree-comparison',lambda:verify_saved_tree(immediate,reopened))
        journal.step('saved-task-and-st',lambda:check_equal('SAVED_TASK_OR_ST_CHANGED',latest_controls,
                     task_and_st(api,after_handle,reopened,reopened_items),'$.tasksAndSt'))
        journal.step('saved-readable-config',lambda:check_equal('SAVED_CONFIG_CHANGED',configuration,
                      legacy['read_config'](reopened_items[device_id]),'$.configuration'))
        journal.step('saved-connector-attachment',lambda:check_equal('SAVED_ATTACHMENT_CHANGED',attachment,
                      attachment_evidence(reopened_items[device_id],plan['parentGuid'],plan),'$.attachment'))
        holder['persisted']=True
        holder['savedBuild']=journal.step('saved-build',lambda:legacy['build'](api,after_handle,reopened,reopened_items,target))
        staged['savedSha256']=saved
        after_compile,compile_items=native_snapshot(after_handle)
        journal.step('post-build-same-handle-tree',lambda:check_equal('COMPILE_TREE_CHANGED',reopened,after_compile,'$.nodes'))
        journal.step('post-build-task-st',lambda:check_equal('COMPILE_TASK_OR_ST_CHANGED',latest_controls,
                     task_and_st(api,after_handle,after_compile,compile_items),'$.tasksAndSt'))

    def close():
        # Any uncertainty after dispatch leaves the owned fixture exactly as
        # observed. Never save, discard the open handle, or roll back on error.
        if holder['dispatched'] and (journal.primaryFailure or journal.loggingErrors):
            return dict(retainedOpen=holder['handle'] is not None)
        if holder['handle'] is not None:
            holder['handle'].close()
            holder['handle']=None
            holder['closed']=True
        return dict(closed=holder['closed'])

    before_files=shared['scan_fixture'](api,directory)
    run_primary(system.execute_on_primary_thread,choose if mode=='plan' else cycle,close,journal)
    final_hash=api['file_hash'](target)
    after_files=shared['scan_fixture'](api,directory) if holder['handle'] is None else None
    passed=holder['closed'] and not any((journal.primaryFailure,journal.wrapperError,journal.cleanupError,journal.loggingErrors))
    if passed:
        expected=staged.get('savedSha256',seed)
        try:
            journal.step('final-disk-after-close',lambda:file_available(api,target,expected))
            if mode=='plan':
                api['publish'](os.path.join(root,'placement-plan.json'),staged['plan'])
                emit('baseline',staged['baseline'])
        except Exception as error:
            if not journal.primaryFailure:
                journal.primaryFailure=dict(step='closed-evidence-publication',error=exception_data(error,traceback.format_exc()))
            passed=False
    passed=passed and not journal.loggingErrors
    evidence=dict(status='succeeded' if passed else 'stopped',mode=mode,path=target,initialSha256=seed,finalSha256=final_hash,
                  stages=journal.events,primaryFailure=journal.primaryFailure,wrapperError=journal.wrapperError,
                  cleanupError=journal.cleanupError,loggingErrors=journal.loggingErrors,
                  state={k:v for k,v in holder.items() if k!='handle'},hasOpenHandle=holder['handle'] is not None,
                  beforeFiles=before_files,afterFiles=after_files,evidence={k:v for k,v in staged.items() if k!='plan'})
    try:
        emit('result',evidence)
    except Exception as error:
        evidence['publicationError']=exception_data(error,traceback.format_exc())
        sys.stderr.write(json.dumps(evidence,ensure_ascii=True)+'\n')
    if holder['owned'] and holder['handle'] is None:
        system.exit()


if __name__=='__main__':
    root=os.path.abspath(os.environ['INOPRO_S6B_RECHECK_ROOT'])
    repo=os.path.abspath(os.environ['INOPRO_S6B_RECHECK_REPO'])
    mode=os.environ['INOPRO_S6B_RECHECK_MODE']
    if not re.match(r'^D:\\InoPro-S6b-DeviceGate-[0-9-]+$',root,re.I) or mode not in ('plan','cycle'):
        raise ValueError('Dedicated gated fixture required')
    if os.path.exists(os.path.join(root,'gated-device-dispatched.json')):
        raise ValueError('The allowed dispatch was already attempted; no replay')
    api=load_fixed_helpers(repo,projects,system,device_repository)
    process=Process.GetCurrentProcess()
    api['publish'](os.path.join(root,mode+'-engine.json'),dict(pid=process.Id,
        creationTicks=unicode(process.StartTime.ToUniversalTime().Ticks),
        executableVersion=unicode(process.MainModule.FileVersionInfo.FileVersion),ironPython=sys.version))
    run_probe(root,mode,api)
