# -*- coding: utf-8 -*-
"""Fixed five-request unsaved-source experiment. No launcher, save, close or recovery.

Standalone diagnostic module, not registered in the MCP product. The caller must
pass current formal admission on EVERY request and schedule via the public main
thread API. No product engineering tool is dispatched by this module.
"""
import os
import re
import json
import copy
import hashlib
import traceback
import math
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
ACTIONS=('read','append-comment-1','read','append-comment-2','read')
COMMENTS=(u'(* 未保存连续请求：第一处注释 *)',u'(* 未保存连续请求：第二处注释 *)')
TASK_FIELDS=('kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task')
class Conflict(ValueError):pass

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

EDIT_VERSION='resident-comment-dependencies-v1'
NODE_FIELDS=set(('objectId','path','parentId','nativeTypeId','applicationId','declaration','implementation','embeddedObjectTypes'))

def editing_view(state):
    """Only this fixed comment experiment: Application subtree, source and ancestors.

    Background library loading and unrelated non-source tree nodes remain raw
    observations, not a promise to preserve the entire device configuration.
    Ownership is still validated on every read. Unknown fields are conservative.
    """
    nodes=state['nodes'];aid=guid(state['applicationId']);target=guid(state['targetId'])
    if not isinstance(nodes,dict) or aid not in nodes or target not in nodes:raise Conflict('Editing dependency identity missing')
    opened=state['openedProjects']
    if not isinstance(opened,dict):raise Conflict('Open project observations missing')
    rows=list(opened.values())
    if isinstance(state['projectHandle'],bool) or not isinstance(state['projectHandle'],int_types) or state['projectHandle']<0:raise Conflict('Invalid owned handle')
    if any(not isinstance(row,dict) or isinstance(row.get('handle'),bool) or not isinstance(row.get('handle'),int_types) or row['handle']<0 or type(row.get('primary')) is not bool or type(row.get('library')) is not bool or not isinstance(row.get('path'),string_types) for row in rows):raise Conflict('Incomplete project classification')
    if any(str(row['handle'])!=key for key,row in opened.items()):raise Conflict('Project observation key differs')
    owned=opened.get(str(state['projectHandle']))
    validate_owned_projects(dict(returned=owned,primary=owned,all=rows,readErrors=[]),state['projectPath'],state['projectHandle'])
    selected=set((aid,target))
    for oid,row in nodes.items():
        if not isinstance(row,dict) or not NODE_FIELDS.issubset(row) or guid(row['objectId'])!=oid:raise Conflict('Incomplete node observation')
        guid(row['nativeTypeId'])
        if row['parentId'] is not None:guid(row['parentId'])
        if row['applicationId'] is not None and row['applicationId']!=aid:raise Conflict('Unexpected Application ownership')
        if not isinstance(row['path'],list) or not row['path'] or any(not isinstance(x,string_types) or not x for x in row['path']):raise Conflict('Incomplete object path')
        if any(row[k] is not None and not isinstance(row[k],string_types) for k in ('declaration','implementation')) or not isinstance(row['embeddedObjectTypes'],list):raise Conflict('Incomplete source observation')
        for typ in row['embeddedObjectTypes']:guid(typ)
        if row['parentId'] is not None and row['parentId'] not in nodes:raise Conflict('Object parent missing from enumeration')
        if row['applicationId'] is not None or row['declaration'] is not None or row['implementation'] is not None or row['embeddedObjectTypes'] or set(row)-NODE_FIELDS or row['nativeTypeId']==POU:selected.add(oid)
    for start in list(nodes):
        seen=set();oid=start
        while oid is not None:
            if oid in seen or oid not in nodes:raise Conflict('Dependency ancestry incomplete or cyclic')
            seen.add(oid);oid=nodes[oid]['parentId']
        if start in selected:selected.update(seen)
    result=copy.deepcopy(state);del result['openedProjects']
    result['nodes']=dict((oid,copy.deepcopy(nodes[oid])) for oid in selected)
    return dict(versionKind=EDIT_VERSION,state=result)

def memory_version(state):return digest(editing_view(state))

def state_differences(before,after,path=''):
    if type(before)!=type(after):return [dict(path=path,kind='type',before=before,after=after)]
    if isinstance(before,dict):
        rows=[]
        for key in sorted(set(before)|set(after)):
            child=path+'/'+key
            if key not in before or key not in after:rows.append(dict(path=child,kind='added' if key not in before else 'removed',before=before.get(key),after=after.get(key)))
            else:rows.extend(state_differences(before[key],after[key],child))
        return rows
    if canonical(before)==canonical(after):return []
    return [dict(path=path,kind='ordered-list' if isinstance(before,list) else 'value',before=before,after=after)]

def comparison(before,after):
    left=editing_view(before);right=editing_view(after)
    return dict(versionKind=EDIT_VERSION,dependenciesEqual=canonical(left)==canonical(right),
                beforeMemoryVersion=digest(left),afterMemoryVersion=digest(right),
                beforeObservationHash=digest(before),afterObservationHash=digest(after),
                dependencyDifferences=state_differences(left,right),observationDifferences=state_differences(before,after))

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
                nodes[oid]=row;objects[oid]=item;walk(item,here,app)
        walk(self.project,[])
        if len(apps)!=1:raise ValueError('Unique Application unavailable')
        targets=[oid for oid,row in nodes.items() if row['parentId']==apps[0] and row['path'][-1].lower()=='plc_prg']
        if len(targets)!=1:raise ValueError('Unique root PLC_PRG unavailable')
        oid=targets[0];row=nodes[oid]
        if row['nativeTypeId']!=POU or ST not in row['embeddedObjectTypes'] or not isinstance(row['implementation'],string_types) or not re.match(r'^\s*PROGRAM\s+PLC_PRG\b',row['declaration'] or '',re.I):raise ValueError('Native root ST PROGRAM evidence incomplete')
        if self.target is not None and not self.same_reference(self.target,objects[oid]):raise ValueError('Target object instance changed')
        self.target=objects[oid]
        opened=dict((str(row['handle']),copy.deepcopy(row)) for row in self.last_ownership['all'])
        return dict(projectPath=source_text(self.project.path),projectHandle=self.handle,openedProjects=opened,applicationId=apps[0],targetId=oid,nodes=nodes,thread=self.thread)

    def replace_implementation(self,value):
        self._owned()
        if self.target is None:raise ValueError('No observed target')
        self.attempts['replace']+=1;self.target.textual_implementation.replace(value)

class ResidentSequence(object):
    def __init__(self,intent,adapter,admission,on_primary,publish,process_identity,file_identity):
        self.intent=copy.deepcopy(intent);self.adapter=adapter;self.admission=admission
        self.on_primary=on_primary;self.publish=publish;self.file_identity=file_identity;self.process_identity=process_identity
        self.completed=0;self.previous=None;self.state=None;self.first_error=None
        self.secondary=[];self.results={};self.modifications=0
        guid(intent['launchId'])
        identity=intent['processIdentity']
        if not os.path.isabs(intent['projectPath']) or set(identity)!=set(('pid','startId')) or type(identity['pid']) is not int or identity['pid']<=0 or not isinstance(identity['startId'],string_types) or not re.match(r'^\d+\Z',identity['startId']):raise ValueError('Absolute project path and native process creation identity required')
        if len(intent['requestIds'])!=5 or len(set(intent['requestIds']))!=5:raise ValueError('Five unique request identities required')
        for value in intent['requestIds']:guid(value)
        if len(intent['operationIds'])!=5 or len(set(intent['operationIds']))!=5:raise ValueError('Five unique operation identities required')
        for value in intent['operationIds']:guid(value)
        file=intent['fileIdentity']
        if set(file)!=set(('path','realPath','fileId','sha256')) or any(not isinstance(file[k],string_types) or not file[k] for k in file) or not os.path.isabs(file['realPath']) or normalized_path(file['path'])!=normalized_path(intent['projectPath']) or file['sha256']!=intent['diskHash']:raise ValueError('Complete original file identity required')
        if not re.match(r'^\d+:[1-9]\d*\Z',file['fileId']) or not re.match(r'^[a-f0-9]{64}\Z',file['sha256']):raise ValueError('Native nonzero file identity and SHA-256 required')

    def _guard(self):
        # A callback to the current formal engineering gate, never cached intent authorization.
        if self.first_error:raise Conflict('Session stopped after first uncertainty/conflict')
        try:
            if self.admission() is not True:raise Conflict('No affirmative current admission')
        except Exception as error:raise Conflict('Formal admission denied: '+text_type(error))
        if self.process_identity()!=self.intent['processIdentity']:raise Conflict('Owned process creation identity changed')
        if self.file_identity(self.intent['projectPath'])!=self.intent['fileIdentity']:raise Conflict('Disk identity/version changed; no overwrite')

    def accept(self,request):
        fingerprint=digest(request);rid=request.get('requestId')
        if rid in self.results:
            prior=self.results[rid]
            if prior[0]==fingerprint:return copy.deepcopy(prior[1])
            if self.first_error is None:self.first_error=dict(stage='deduplication',message='requestId reused with changed request')
            return dict(status='conflict',firstError=self.first_error,dispatched=False,frozen=True)
        dispatched=[False];before=[None];stage=['admission'];error_holder=[];output=[];callback_allowed=[True];entered=[False]
        attempts_before=copy.deepcopy(self.adapter.attempts)
        try:
            seq=self.completed+1
            if seq>5:raise ValueError('Fixed request sequence finished')
            expected=dict(schemaVersion=1,sequence=seq,requestId=self.intent['requestIds'][seq-1],operationId=self.intent['operationIds'][seq-1],
                          launchId=self.intent['launchId'],projectPath=self.intent['projectPath'],
                          command=ACTIONS[seq-1],expectedVersion=memory_version(self.state) if self.state is not None else None,
                          previousResultHash=self.previous)
            if type(request.get('sequence')) is not int or type(request.get('schemaVersion')) is not int or request!=expected:raise ValueError('Request scope/order/version differs')
            self._guard()
            def callback_guard():
                if not callback_allowed[0]:raise Conflict('Callback no longer admitted')
                self._guard()
            def primary():
                if not callback_allowed[0]:return # missing completion has already frozen the request
                if entered[0]:
                    error_holder.append((ValueError('Duplicate primary callback'),'', 'primary-call'));return
                entered[0]=True
                try:
                    callback_guard();stage[0]='memory-read';current=self.adapter.snapshot();before[0]=copy.deepcopy(current)
                    self.publish('request-%d-before.json'%seq,current)
                    editing_view(current)
                    if self.state is not None:
                        checked=comparison(self.state,current);self.publish('request-%d-precondition-check.json'%seq,checked)
                        if not checked['dependenciesEqual']:raise Conflict('Memory or identity changed; user action preserved')
                    planned=copy.deepcopy(current)
                    if seq in (2,4):
                        target=planned['nodes'][planned['targetId']];old=target['implementation'];newline='\r\n' if '\r\n' in old else '\n'
                        if any(comment in old for comment in COMMENTS[(seq//2)-1:]):raise ValueError('Diagnostic comment already present')
                        new=old+newline+COMMENTS[seq//2-1]+newline;target['implementation']=new
                        # Memory checkpoint includes ALL observed source, including prior unsaved edit.
                        stage[0]='checkpoint';self.publish('request-%d-memory-checkpoint.json'%seq,dict(state=current,memoryVersion=memory_version(current),observationHash=digest(current),versionKind=EDIT_VERSION,diskHash=self.intent['diskHash']))
                        callback_guard();stage[0]='predispatch-read';live=self.adapter.snapshot();self.publish('request-%d-predispatch.json'%seq,live)
                        checked=comparison(current,live);self.publish('request-%d-predispatch-check.json'%seq,checked)
                        if not checked['dependenciesEqual']:raise Conflict('Memory changed after checkpoint')
                        callback_guard();stage[0]='dispatch';self.publish('request-%d-dispatch.json'%seq,dict(request=request,beforeVersion=memory_version(live),plannedVersion=memory_version(planned),versionKind=EDIT_VERSION,beforeObservationHash=digest(live)))
                        callback_guard()
                        dispatched[0]=True;self.modifications+=1;self.adapter.replace_implementation(new)
                    stage[0]='after-read';after=self.adapter.snapshot();self.publish('request-%d-after.json'%seq,after)
                    checked=comparison(planned,after);self.publish('request-%d-readback-check.json'%seq,checked)
                    if not checked['dependenciesEqual']:raise ValueError('Readback differs; no reverse write or recovery save')
                    callback_guard();output.append(after)
                except Exception as error:error_holder.append((error,traceback.format_exc(),stage[0]))
            stage[0]='primary-call'
            try:self.on_primary(primary)
            finally:callback_allowed[0]=False
            if error_holder:raise error_holder[0][0]
            if len(output)!=1:raise ValueError('Primary callback completion missing')
            response=dict(status='memory-verified',request=request,state=output[0],memoryVersion=memory_version(output[0]),observationHash=digest(output[0]),versionKind=EDIT_VERSION,diskHash=self.intent['diskHash'],
                          processIdentity=self.intent['processIdentity'],nativeAttempts=dict((k,self.adapter.attempts[k]-attempts_before[k]) for k in attempts_before),changes=self.modifications,saved=False,reopened=False,saveCalls=0,closeCalls=0,exitCalls=0)
            stage[0]='result-publication';self.publish('result-%d.json'%seq,response)
            self.state=copy.deepcopy(output[0]);self.previous=digest(response);self.completed=seq
        except Exception as error:
            original=error_holder[0][0] if error_holder else error
            if original is not error:self.secondary.append(dict(stage='primary-wrapper',type=type(error).__name__,message=text_type(error)))
            detail=dict(stage=error_holder[0][2] if error_holder else stage[0],type=type(original).__name__,message=text_type(original),traceback=error_holder[0][1] if error_holder else traceback.format_exc())
            if self.first_error is None:self.first_error=detail
            callback_allowed[0]=False
            attempted=dict((key,self.adapter.attempts[key]-attempts_before[key]) for key in attempts_before)
            uncertain=dispatched[0] or attempted['open']>0 or stage[0] in ('primary-call','result-publication') or (stage[0] in ('memory-read','after-read') and not isinstance(error,Conflict))
            response=dict(status='unknown' if uncertain else 'conflict',request=request,firstError=self.first_error,ownershipEvidence=self.adapter.last_ownership,dispatched=bool(dispatched[0] or attempted['open'] or attempted['read']),modificationDispatched=dispatched[0],nativeAttempts=attempted,frozen=True,automaticRollback=False,saveCalls=0,closeCalls=0)
            try:self.publish('request-error-%d.json'%(self.completed+1),response)
            except Exception as secondary:self.secondary.append(dict(type=type(secondary).__name__,message=text_type(secondary)))
        self.results[rid]=(fingerprint,copy.deepcopy(response))
        return response

def request_for(session):
    seq=session.completed+1
    return dict(schemaVersion=1,sequence=seq,requestId=session.intent['requestIds'][seq-1],operationId=session.intent['operationIds'][seq-1],launchId=session.intent['launchId'],projectPath=session.intent['projectPath'],command=ACTIONS[seq-1],expectedVersion=memory_version(session.state) if session.state is not None else None,previousResultHash=session.previous)

def process_request_file(session,path):
    def pairs(values):
        out={}
        for key,value in values:
            if key in out:raise ValueError('Duplicate request field')
            out[key]=value
        return out
    with open(path,'rb') as stream:data=stream.read(16385)
    if len(data)>16384:raise ValueError('Request exceeds fixed bound')
    return session.accept(json.loads(data.decode('utf-8'),object_pairs_hook=pairs))

def public_primary_dispatch(system):
    """Bind only the already verified public synchronous callback entry, not eval."""
    def dispatch(callback):return system.execute_on_primary_thread(callback)
    return dispatch
