# -*- coding: utf-8 -*-
"""Standalone two-pass selection diagnostic. No engineering writes or compilation."""
import io
import json
import os
import re
import sys
import traceback
from System.Diagnostics import Process
from scriptengine import device_repository, projects, system

sys.dont_write_bytecode=True
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from device_add_preflight import (NAME,Journal,ProbeRejected,check_equal,exception_data,
    file_available,load_read_helpers,native_site,read_state,rejection,run_primary,verify_preflight)

EXPECTED_IDENTITY=dict(type='1152',id='FFFF 0001',deviceDescriptionVersion='3.5.5.0')


def load_json(path):
    with io.open(path,'r',encoding='utf-8-sig') as stream:
        return json.load(stream)


def scan_fixture(api, directory):
    entries={}
    for parent,unused,names in os.walk(directory):
        for name in sorted(names):
            full=os.path.join(parent,name)
            relative=os.path.relpath(full,directory).replace('\\','/')
            entries[relative]=dict(size=os.path.getsize(full),sha256=api['file_hash'](full))
    return entries


def choose_plan(nodes, placements, catalog, controls, target, seed):
    candidates=[entry for entry in catalog['matches'] if entry['identity']==EXPECTED_IDENTITY]
    accepted=[]
    refused=[]
    for placement in placements:
        for link in placement.get('observedConnectors',[]):
            for candidate in candidates:
                plan=dict(name=NAME,mainSha256=seed,projectPath=target,parentGuid=placement['node']['guid'],
                          index=placement['appendIndex'],parentConnector=link,candidate=candidate,
                          nodes=nodes,readableTasksAndST=controls,
                          nativeSite=native_site(placements,placement['node']['guid']))
                code=rejection(plan,nodes,placements,catalog)
                if code:
                    refused.append(dict(parentGuid=plan['parentGuid'],connector=link,rejection=code))
                else:
                    accepted.append(plan)
    if len(accepted)!=1:
        raise ProbeRejected('PLACEMENT_NOT_UNIQUE',dict(path='$.eligiblePlacements',expected=1,actual=len(accepted),
                                                       candidateCount=len(candidates),refused=refused))
    return accepted[0]


def run_probe(root,mode,api):
    directory=os.path.join(root,'engineering')
    target=os.path.join(directory,'AM610_S6b_Readonly_Recheck.project')
    seed=load_json(os.path.join(root,'fixture-origin.json'))['initialProjectSha256']
    def sink(number,row):
        api['publish'](os.path.join(root,'%s-step-%03d.json'%(mode,number)),row)
    journal=Journal(sink)
    holder={'handle':None,'canExit':False,'closed':False}
    selected=[]
    before=[]
    after=[]
    def guard_file():
        if projects.primary is not None:
            raise ProbeRejected('UNOWNED_PROJECT')
        holder['canExit']=True
        check_equal('DISK_CHANGED',seed,api['file_hash'](target),'$.mainSha256')
        file_available(api,target,seed)
        return dict(projectPath=target,mainSha256=seed)
    def acquire():
        # Keep a reference for cleanup even if a later path check fails.
        holder['handle']=projects.open(target)
        return holder['handle']
    def actual_path():
        observed=unicode(holder['handle'].path)
        check_equal('PROJECT_PATH_CHANGED',os.path.normcase(target),os.path.normcase(observed),'$.projectPath')
        return dict(actualPath=observed,mainSha256=api['file_hash'](target))
    def check_plan_origin():
        first=load_json(os.path.join(root,'plan-result.json'))
        if first['status']!='succeeded' or not first['projectClosed']:
            raise ProbeRejected('FIRST_PASS_NOT_COMPLETE')
        value=load_json(os.path.join(root,'plan.json'))
        binding=dict(projectPath=target,mainSha256=seed)
        check_equal('PLAN_ORIGIN_CHANGED',binding,{k:value[k] for k in binding},'$.binding')
        return value
    def work():
        journal.step('fixture-path-hash-and-occupancy',guard_file)
        before.append(journal.step('files-before-open',lambda:scan_fixture(api,directory)))
        journal.step('native-open',acquire,lambda unused:dict(opened=True))
        actual=journal.step('opened-path-and-hash',actual_path)
        journal.step('opened-main-hash-unchanged',lambda:check_equal('DISK_CHANGED',seed,actual['mainSha256'],'$.mainSha256'))
        if mode=='recheck':
            selected.append(journal.step('load-this-fixture-plan',check_plan_origin,
                            lambda plan:dict(parentGuid=plan['parentGuid'],index=plan['index'],candidate=plan['candidate'])))
        nodes,unused,placements,catalog,controls=read_state(api,holder['handle'],device_repository,journal)
        if mode=='plan':
            selected.append(journal.step('select-this-fixture-parent-and-index',
                            lambda:choose_plan(nodes,placements,catalog,controls,target,seed),
                            lambda plan:dict(parentGuid=plan['parentGuid'],index=plan['index'],candidate=plan['candidate'])))
        verify_preflight(api,target,seed,device_repository,selected[0],nodes,placements,catalog,controls,journal)
    def close():
        if holder['handle'] is None:
            return dict(closed=False,notOpened=True)
        holder['handle'].close()
        holder['handle']=None
        holder['closed']=True
        return dict(closed=True)

    def post_close():
        actual_hash=api['file_hash'](target)
        files=scan_fixture(api,directory)
        after.append(files)
        if holder['handle'] is None:
            file_available(api,target,seed)
        check_equal('DISK_CHANGED',seed,actual_hash,'$.mainSha256')
        return dict(mainSha256=actual_hash,files=files)

    run_primary(system.execute_on_primary_thread,work,close,journal)
    if holder['canExit'] and holder['handle'] is None:
        # No additional IDE open or mutation. Preserve any earlier exception.
        try:
            journal.step('files-after-close',post_close)
        except Exception:
            pass
    success=bool(holder['closed'] and selected and after and not any(
        (journal.primaryFailure,journal.wrapperError,journal.cleanupError,journal.loggingErrors)))
    if success and mode=='plan':
        try:
            journal.step('publish-independent-plan',
                lambda:api['publish'](os.path.join(root,'plan.json'),selected[0]))
        except Exception:
            success=False
    main_name='AM610_S6b_Readonly_Recheck.project'
    old,new=before[0] if before else {},after[0] if after else {}
    changes=[dict(path=n,before=old.get(n),after=new.get(n)) for n in sorted(set(old)|set(new))
             if n!=main_name and old.get(n)!=new.get(n)]
    result=dict(status='succeeded' if success else 'failed',mode=mode,projectPath=target,
                projectClosed=holder['closed'],hasOpenHandle=holder['handle'] is not None,filesBefore=old,filesAfter=new,
                mainFileUnchanged=bool(old and new and old.get(main_name)==new.get(main_name)),
                sidecarChanges=changes,events=journal.events,primaryFailure=journal.primaryFailure,cleanupError=journal.cleanupError,
                wrapperError=journal.wrapperError,loggingErrors=journal.loggingErrors,
                engineeringWriteCalled=False,compileCalled=False)
    try:
        api['publish'](os.path.join(root,mode+'-result.json'),result)
    except Exception as exc:
        result['resultPublicationError']=exception_data(exc,traceback.format_exc())
        sys.stderr.write(json.dumps(result,ensure_ascii=True)+'\n')
    if holder['canExit'] and holder['handle'] is None:
        system.exit()


if __name__=='__main__':
    root=os.path.abspath(os.environ['INOPRO_S6B_RECHECK_ROOT'])
    repo=os.path.abspath(os.environ['INOPRO_S6B_RECHECK_REPO'])
    mode=os.environ['INOPRO_S6B_RECHECK_MODE']
    if not re.match(r'^D:\\InoPro-S6b-DeviceRecheck-[0-9-]+$',root,re.I) or mode not in ('plan','recheck'):
        raise ValueError('Dedicated read-only fixture and stage required')
    api=load_read_helpers(repo,projects,system,device_repository)
    current=Process.GetCurrentProcess()
    api['publish'](os.path.join(root,mode+'-engine.json'),
        dict(pid=current.Id,creationTicks=unicode(current.StartTime.ToUniversalTime().Ticks),
             executableVersion=unicode(current.MainModule.FileVersionInfo.FileVersion),ironPython=sys.version))
    run_probe(root,mode,api)
