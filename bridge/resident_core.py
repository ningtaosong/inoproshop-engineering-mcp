# -*- coding: utf-8 -*-
"""Resident product operations: public ST implementation reads/replace; never save/close.
Public identity/read primitives derived from the verified native experiment.
No fixed path, object name, comment, round count, input-code evaluation or worker dispatch.
"""
import os
import re
import json
import copy
import hashlib
import traceback
import math
import datetime
try:
    text_type=unicode
    string_types=(basestring,)
    int_types=(int,long)
except NameError:
    text_type=str
    string_types=(str,)
    int_types=(int,)

ST='3b83b776-fb25-43b8-99f2-3c507c9143fc'
POU='6f9dac99-8de1-4efc-8465-68ac443b7d08'
TASK_FIELDS=('kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task')
class Conflict(ValueError):pass
class Rejection(Conflict):pass

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')

def digest(value):return hashlib.sha256(canonical(value)).hexdigest()

def file_hash(path):
    with open(path,'rb') as stream:return hashlib.sha256(stream.read()).hexdigest()

def guid(value):
    s=text_type(value)
    if not re.match(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z',s) or s.lower()=='00000000-0000-0000-0000-000000000000':raise ValueError('Invalid native identity')
    return s.lower()

def source_text(value):
    if not isinstance(value,string_types):raise ValueError('Native source is not text')
    return text_type(value)

def scalar(value):
    """Preserve primitive kind and CLR type; never coalesce null with text None."""
    kind=type(value).__name__;native=None
    if hasattr(value,'GetType'):
        t=value.GetType();native=text_type(t.FullName)
        if t.IsEnum:return dict(kind='enum',pythonType=kind,nativeType=native,value=text_type(value))
        if native=='System.Guid':return dict(kind='guid',pythonType=kind,nativeType=native,value=text_type(value))
        if native=='System.TimeSpan':return dict(kind='timespan-ticks',pythonType=kind,nativeType=native,value=text_type(value.Ticks))
    if value is None:return dict(kind='null',value=None)
    if isinstance(value,bool):return dict(kind='bool',pythonType=kind,nativeType=native,value=bool(value))
    if isinstance(value,int_types):return dict(kind='integer',pythonType=kind,nativeType=native,value=text_type(value))
    if isinstance(value,float):
        if math.isnan(value) or math.isinf(value):raise ValueError('Nonfinite field')
        return dict(kind='float',pythonType=kind,nativeType=native,value=repr(value))
    if isinstance(value,string_types):return dict(kind='text',pythonType=kind,nativeType=native,value=source_text(value))
    raise ValueError('Unsupported readable scalar type: '+kind)

def normalized_path(path):return os.path.normcase(os.path.abspath(path))

def public_handle(value):
    handle=value.handle
    if isinstance(handle,bool) or not isinstance(handle,int_types) or handle<0:raise Conflict('Public project handle unavailable')
    return int(handle)

def same_public_identity(a,b):
    # IScriptTreeObject.handle is the native project handle, not a wrapper address.
    # ScriptObject identity additionally includes its GUID; no private member access.
    if a is None or b is None:return False
    if public_handle(a)!=public_handle(b):return False
    ag=getattr(a,'guid',None);bg=getattr(b,'guid',None)
    return (ag is None and bg is None) or (ag is not None and bg is not None and guid(ag)==guid(bg))

def project_view(project):
    if project is None:return None
    library=project.library;primary=project.primary
    if type(library) is not bool or type(primary) is not bool:raise ValueError('Native project classification is not Boolean')
    return dict(handle=public_handle(project),path=source_text(project.path),library=library,primary=primary)

def validate_owned_projects(proof,path,handle):
    if proof['readErrors']:raise Conflict('Public project ownership evidence incomplete')
    owned=proof['returned'];primary=proof['primary'];rows=proof['all']
    if owned is None or primary is None:raise Conflict('Owned or primary project unavailable')
    if owned['handle']!=handle or primary['handle']!=handle:raise Conflict('Primary native handle differs from owned project')
    if owned!=primary or normalized_path(owned['path'])!=normalized_path(path) or not owned['primary'] or owned['library']:raise Conflict('Primary project classification/path differs')
    handles=[row['handle'] for row in rows]
    if len(set(handles))!=len(handles):raise Conflict('Duplicate project handle in open list')
    selected=[row for row in rows if row['handle']==handle]
    if selected!=[owned]:raise Conflict('Owned project missing or differs in open list')
    # Public library=True means a referenced background library; no name/suffix inference.
    if any(row['primary'] or not row['library'] for row in rows if row['handle']!=handle):raise Conflict('Additional non-library or primary project; no takeover')
    return True

class NativeProjectAdapter(object):
    """Only public open/get_children/text getters/text.replace; no business helper auto-save."""
    def __init__(self,projects,path,same_reference,thread_id,observe_ownership=None):
        self.projects=projects;self.path=path;self.same_reference=same_reference
        self.thread_id=thread_id;self.thread=None;self.project=None;self.target=None;self.handle=None
        self.observe_ownership=observe_ownership;self.last_ownership=None
        self.attempts=dict(open=0,replace=0,read=0)

    def _owned(self):
        current=self.thread_id()
        if self.thread is None:self.thread=current
        if current!=self.thread:raise Conflict('Primary thread changed')
        if self.project is None:
            if self.projects.primary is not None or len(list(self.projects.all))!=0:raise Conflict('Unowned open project')
            self.attempts['open']+=1
            self.project=self.projects.open(self.path,primary=True)
            self.handle=public_handle(self.project)
        proof=dict(returned=None,primary=None,all=[],readErrors=[])
        native_errors=[]
        def read(label,fn):
            try:return fn()
            except Exception as error:
                proof['readErrors'].append(dict(field=label,type=type(error).__name__,message=text_type(error),traceback=traceback.format_exc()))
                native_errors.append(error)
                return None
        proof['returned']=read('returned',lambda:project_view(self.project))
        proof['primary']=read('primary',lambda:project_view(self.projects.primary))
        rows=read('all',lambda:list(self.projects.all))
        if rows is not None:
            for index,item in enumerate(rows):
                row=read('all[%d]'%index,lambda:project_view(item))
                if row is None:proof['readErrors'].append(dict(field='all[%d]'%index,message='Null/invalid project entry'))
                else:proof['all'].append(row)
        self.last_ownership=copy.deepcopy(proof)
        try:
            if self.observe_ownership:self.observe_ownership(proof)
        except Exception as error:
            if native_errors:
                self.last_ownership['publicationError']=dict(type=type(error).__name__,message=text_type(error),traceback=traceback.format_exc())
                raise native_errors[0]
            raise
        if native_errors:raise native_errors[0]
        validate_owned_projects(proof,self.path,self.handle)

    def snapshot(self):
        self.attempts['read']+=1
        self._owned();nodes={};objects={};apps=[]
        def walk(parent,path,aid=None):
            for item in list(parent.get_children(False)):
                oid=guid(item.guid)
                if public_handle(item)!=self.handle:raise ValueError('Object belongs to another native project handle')
                if oid in nodes:raise ValueError('Duplicate object identity')
                name=source_text(item.get_name());here=path+[name]
                app=oid if bool(getattr(item,'is_application',False)) else aid
                row=dict(objectId=oid,path=here,parentId=guid(parent.guid) if parent is not self.project else None,
                         nativeTypeId=guid(item.type),applicationId=app)
                if bool(getattr(item,'is_application',False)):apps.append(oid)
                row['declaration']=source_text(item.textual_declaration.text) if item.has_textual_declaration else None
                row['implementation']=source_text(item.textual_implementation.text) if item.has_textual_implementation else None
                row['embeddedObjectTypes']=[guid(t) for t in item.embedded_object_types] if item.has_textual_implementation else []
                if bool(getattr(item,'is_task',False)):
                    row['taskFields']=dict((key,scalar(getattr(item,key))) for key in TASK_FIELDS)
                    row['watchdog']=dict((key,scalar(getattr(item.watchdog,key))) for key in ('enabled','time','time_unit','sensitivity'))
                    calls=item.pous;out=[]
                    for i in range(len(calls)):
                        call=calls[i]
                        if not isinstance(call,(tuple,list)) or len(call)!=2 or not all(isinstance(x,string_types) for x in call) or not call[0]:raise ValueError('Incomplete native task call')
                        out.append([source_text(x) for x in call])
                    row['calls']=out
                if row['nativeTypeId']=='adb5cb65-8e1d-4a00-b70a-375ea27582f3':
                    if item.is_libman is not True:raise ValueError('Native library manager unavailable')
                    refs=[]
                    for ref in item.references:
                        if len(refs)>=2000:raise ValueError('Library coverage exceeds resident bound')
                        fields={}
                        for key in ('id','name','namespace'):
                            value=getattr(ref,key);fields[key]=None if value is None else text_type(value)
                        for key in ('is_placeholder','is_managed','system_library','optional','qualified_only'):
                            value=getattr(ref,key)
                            if value is not None and type(value) is not bool:raise ValueError('Incomplete native library flag')
                            fields[key]=value
                        if fields['is_placeholder'] is True:
                            for key in ('placeholder_name','default_resolution','effective_resolution','resolution_info','resolver_guid'):
                                value=getattr(ref,key);fields[key]=None if value is None else text_type(value)
                            fields['is_redirected']=ref.is_redirected
                            if type(fields['is_redirected']) is not bool:raise ValueError('Incomplete redirection flag')
                            value=ref.get_redirection();fields['explicit_redirection']=None if value is None else text_type(value)
                        refs.append(fields)
                    row['directLibraries']=refs
                if len(nodes)>=10000:raise ValueError('Tree coverage exceeds resident bound')
                nodes[oid]=row;objects[oid]=item;walk(item,here,app)
        walk(self.project,[])
        opened=dict((str(row['handle']),copy.deepcopy(row)) for row in self.last_ownership['all'])
        self.objects=objects
        return dict(projectPath=source_text(self.project.path),projectHandle=self.handle,openedProjects=opened,applications=apps,nodes=nodes,thread=self.thread)

    def replace_implementation(self,oid,value):
        self._owned()
        item=self.objects[oid]
        self.attempts['replace']+=1
        item.textual_implementation.replace(value)


VERSION='resident-st-implementation-v1'

def dependencies(state):
    # All application subtrees, every textual/embedded object, task config/calls,
    # direct library references/resolution, and their full ancestors are retained.
    # Non-source device UI nodes outside Applications and referenced background
    # projects are observations only. Device parameters/I/O are outside this tool.
    nodes=state['nodes'];selected=set()
    for oid,row in nodes.items():
        if guid(row['objectId'])!=oid:raise Conflict('Identity directory differs')
        if row['applicationId'] is not None or row['declaration'] is not None or row['implementation'] is not None or row['embeddedObjectTypes'] or 'taskFields' in row or 'directLibraries' in row:selected.add(oid)
    for oid in list(selected):
        seen=set()
        while oid is not None:
            if oid not in nodes or oid in seen:raise Conflict('Dependency ancestry incomplete')
            seen.add(oid);selected.add(oid);oid=nodes[oid]['parentId']
    return dict(scheme=VERSION,projectPath=state['projectPath'],projectHandle=state['projectHandle'],thread=state['thread'],applications=state['applications'],nodes=dict((k,copy.deepcopy(nodes[k])) for k in selected))

def object_data(state,oid,aid):
    row=state['nodes'].get(oid)
    if row is None or row['applicationId']!=aid or row['parentId']!=aid:raise Rejection('Only exact Application-root objects supported')
    if row['nativeTypeId']!=POU or row['embeddedObjectTypes']!=[ST] or row['declaration'] is None or row['implementation'] is None:raise Rejection('Native ST POU evidence missing')
    if any(x['parentId']==oid for x in state['nodes'].values()):raise Rejection('POU with child objects not supported')
    m=re.match(r'^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\b',row['declaration'],re.I)
    if not m or m.group(2).lower()!=row['path'][-1].lower():raise Rejection('Ordinary same-name POU header required')
    d=row['declaration'];i=row['implementation']
    norm=lambda x:x.replace('\r\n','\n').replace('\r','\n')
    return dict(objectId=oid,applicationId=aid,path=row['path'],nativeTypeId=row['nativeTypeId'],embeddedObjectTypes=row['embeddedObjectTypes'],language='ST',objectType='function_block' if m.group(1).upper()=='FUNCTION_BLOCK' else 'st_pou',hasImplementation=True,declaration=d,implementation=i,contentHash=digest([norm(d),norm(i)]))

class ResidentSession(object):
    def __init__(self,adapter,disk_hash,publish,admission=lambda:None):
        self.adapter=adapter;self.disk_hash=disk_hash;self.publish=publish;self.admission=admission;self.poison=None;self.secondary=[];self.previous_disk=None;self.edits=0
    def handle(self,request):
        if self.poison is not None:raise Conflict('Resident session frozen; no further dispatch')
        dispatched=False;before=None
        try:
            command=request['command'];args=request['args']
            if command not in ('inspect','list','read','change'):raise Rejection('Tool not adapted to resident mode')
            before=self.adapter.snapshot();disk=self.disk_hash();deps=dependencies(before)
            self.publish('before.json',dict(state=before,diskHash=disk))
            if self.previous_disk is not None and disk!=self.previous_disk:raise Conflict('Disk changed; cannot prove it is a manual save of this memory; no write permitted')
            apps=[dict(applicationId=a,path=before['nodes'][a]['path']) for a in before['applications']]
            aid=args.get('applicationId')
            if aid is None and len(apps)==1:aid=apps[0]['applicationId']
            if aid not in before['applications']:raise Rejection('Select an actual unique Application')
            version=digest(dict(dependencies=deps,diskHash=disk))
            data=dict(applications=apps,applicationId=aid,projectPath=before['projectPath'],projectHandle=before['projectHandle'],snapshot=digest(deps),residentVersion=version,diskHash=disk,sessionMode='resident',saved=False,reopened=False,closed=False,saveCalls=0,compileCalls=0,closeCalls=0,exitCalls=0,memoryModified=False,memoryEditsInSession=self.edits,externalDiskChange=self.previous_disk is not None and disk!=self.previous_disk,coverage='Application subtrees, source, tasks and direct library evidence; not complete device/I/O configuration')
            if command=='list':
                rows=[];excluded=[]
                for oid in sorted(before['nodes']):
                    row=before['nodes'][oid]
                    if row['applicationId']!=aid:continue
                    try:rows.append(object_data(before,oid,aid))
                    except Conflict as error:excluded.append(dict(objectId=oid,path=row['path'],reason=text_type(error)))
                if args.get('expectedResidentVersion') is not None and args['expectedResidentVersion']!=version:raise Rejection('Object listing version changed; restart first page')
                offset=args.get('offset',0);limit=args.get('limit',50)
                if offset and not args.get('expectedResidentVersion'):raise Rejection('Resident continuation requires expectedResidentVersion')
                selected=rows[offset:offset+limit]
                data.update(objects=[dict((k,v) for k,v in r.items() if k not in ('declaration','implementation')) for r in selected],total=len(rows),complete=True,nextOffset=offset+len(selected) if offset+len(selected)<len(rows) else None,excluded=excluded)
            if command in ('read','change'):
                obj=object_data(before,args['objectId'],aid);data.update(obj)
            if command=='change':
                if args.get('objectType') is not None or args.get('declaration')!=obj['declaration'] or not isinstance(args.get('implementation'),string_types):raise Rejection('Resident mode only replaces implementation; declaration must match exactly')
                if args.get('expectedResidentVersion')!=version or args.get('expectedHash')!=obj['contentHash']:raise Rejection('Current memory or disk differs; reread before deciding')
                self.publish('checkpoint.json',dict(request=request,state=before,diskHash=disk,residentVersion=version))
                again=self.adapter.snapshot()
                self.publish('predispatch.json',dict(state=again,diskHash=self.disk_hash()))
                if dependencies(again)!=deps or self.disk_hash()!=disk:raise Rejection('State changed before dispatch')
                expected=copy.deepcopy(deps);expected['nodes'][args['objectId']]['implementation']=args['implementation']
                self.publish('dispatch.json',dict(operationId=request['operationId'],requestId=request['requestId'],action='replace-implementation'))
                self.admission()
                if self.disk_hash()!=disk:raise Conflict('Disk changed at final dispatch gate')
                dispatched=True;self.adapter.replace_implementation(args['objectId'],args['implementation'])
                after=self.adapter.snapshot();self.publish('after.json',dict(state=after,diskHash=self.disk_hash()))
                actual=dependencies(after)
                check=dict(equal=expected==actual,expected=expected,actual=actual)
                self.publish('verification.json',check)
                if not check['equal'] or self.disk_hash()!=disk:raise ValueError('Written state cannot be confirmed')
                self.edits+=1;data.update(object_data(after,args['objectId'],aid),snapshot=digest(actual),residentVersion=digest(dict(dependencies=actual,diskHash=disk)),memoryModified=True,memoryEditsInSession=self.edits,persistedToProject=False,persistedToWorkingCopy=False,checkpoint=request['directory']+'/checkpoint.json')
            elif self.disk_hash()!=disk:raise Conflict('Disk changed during read')
            self.previous_disk=disk
            return dict(contractVersion='1.0.0',operationId=request['operationId'],status='succeeded',summary=u'同一工程内存请求完成；未保存、未编译、未关闭',data=data)
        except Exception as error:
            detail=dict(type=type(error).__name__,message=text_type(error),traceback=traceback.format_exc(),dispatched=dispatched)
            recoverable=isinstance(error,Rejection) and not dispatched
            if not recoverable:self.poison=detail
            try:self.publish('first-error.json',detail)
            except Exception as secondary:self.secondary.append(dict(type=type(secondary).__name__,message=text_type(secondary),traceback=traceback.format_exc()));recoverable=False;self.poison=detail
            return dict(contractVersion='1.0.0',operationId=request['operationId'],status='unknown' if dispatched or not isinstance(error,Conflict) else 'conflict',summary=u'本次未派发；后续新指令可重新读取' if recoverable else u'已停止此常驻会话；保留现场，不重试或恢复性保存',error=dict(code='RESIDENT_UNCONFIRMED' if dispatched else 'RESIDENT_PRECONDITION',message=text_type(error)),data=dict(firstError=detail,secondaryErrors=self.secondary,recoverableRejection=recoverable,saved=False,reopened=False,closed=False))
