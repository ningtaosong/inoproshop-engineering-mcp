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
VAR_DECL='a9ed5b7e-75c5-4651-af16-d2c27e98cb94'
POU='6f9dac99-8de1-4efc-8465-68ac443b7d08'
TASK_FIELDS=('kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task')
class Conflict(ValueError):pass
class Rejection(Conflict):pass

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')

def digest(value):return hashlib.sha256(canonical(value)).hexdigest()

def file_hash(path):
    with open(path,'rb') as stream:return hashlib.sha256(stream.read()).hexdigest()

# Installed 1.9.1.6 BeforeCompile/LoadPlaceholderLibrary implementations.
# This is a narrow compiler effect, not a general system-library exemption.
COMPILER_LIBRARY_ARTIFACTS={
    'InoSymbolObject.plugin':'91e06b3aa1548a4076535cf68df3bb2f41c9445e7c196a553687c50b9d609c48',
    'InoLibManObject.plugin':'7fbdf3fd2728e19e737fa3b672da89d4ec9582efc3060ef896a5b44a62b111a6'}
IEC_COMPILER_REFERENCE=dict(is_redirected=False,explicit_redirection=None,is_managed=False,is_placeholder=True,
    name='#IecVarAccess',optional=False,qualified_only=False,effective_resolution='IecVarAccess, 3.5.11.0 (System)',
    resolution_info=u'库配置文件解析',default_resolution='IecVarAccess, 3.3.1.20 (System)',
    resolver_guid='b303f5ce-75ff-4668-a777-7da8debb449c',namespace='IecVarAccessLibrary',system_library=True,placeholder_name='IecVarAccess')

def compiler_library_support():
    """Read loaded assembly identity and file fingerprint; never load/call a plugin."""
    from System import AppDomain
    rows=[]
    for a in AppDomain.CurrentDomain.GetAssemblies():
        name=source_text(a.GetName().Name)
        if name in COMPILER_LIBRARY_ARTIFACTS:
            path=source_text(a.Location)
            rows.append(dict(name=name,version=source_text(a.GetName().Version.ToString()),path=path,sha256=file_hash(path)))
    return dict(scheme='resident-compiler-library-support-v1',assemblies=sorted(rows,key=lambda r:r['name']))

def checked_compiler_library_support(proof):
    if not isinstance(proof,dict) or set(proof)!=set(['scheme','assemblies']) or proof['scheme']!='resident-compiler-library-support-v1' or not isinstance(proof['assemblies'],list):raise ValueError('Compiler library support evidence missing')
    rows=proof['assemblies']
    if len(rows)!=2 or set(r.get('name') for r in rows)!=set(COMPILER_LIBRARY_ARTIFACTS):raise ValueError('Compiler library implementation coverage differs')
    for r in rows:
        if set(r)!=set(['name','version','path','sha256']) or r['version']!='1.9.1.6' or not isinstance(r['path'],string_types) or not r['path'] or r['sha256']!=COMPILER_LIBRARY_ARTIFACTS[r['name']]:raise ValueError('Unverified compiler library implementation')
    return digest(proof)

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
    def __init__(self,projects,path,same_reference,thread_id,observe_ownership=None,system=None):
        self.projects=projects;self.path=path;self.same_reference=same_reference
        self.thread_id=thread_id;self.thread=None;self.project=None;self.target=None;self.handle=None
        self.observe_ownership=observe_ownership;self.last_ownership=None
        self.attempts=dict(open=0,replace=0,read=0,build=0)
        self.system=system

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

    def build_context(self,state):
        """Additional public evidence, only for build. Never configure devices."""
        self._owned();children={};devices={}
        for key,parent in [(None,self.project)]+list(self.objects.items()):
            children[key or '$project']=[guid(x.guid) for x in parent.get_children(False)]
        for oid,item in self.objects.items():
            if not bool(getattr(item,'is_device',False)):continue
            ident=item.get_device_identification();ports=[]
            for port in item.connectors:
                ports.append(dict(id=int(port.connector_id),interface=source_text(port.interface),
                                  role=text_type(port.connector_role),hostPath=int(port.host_path)))
            devices[oid]=dict(identity=dict(type=text_type(ident.type),id=source_text(ident.id),version=source_text(ident.version)),connectors=ports)
        value=dict(scheme='resident-build-context-v1',children=children,devices=devices)
        validate_build_context(state,value)
        return value

    def build_library_support(self):
        self._owned()
        return compiler_library_support()

    def prepare_build(self,aid):
        self._owned()
        item=self.objects.get(aid)
        if item is None or not bool(getattr(item,'is_application',False)) or not callable(getattr(item,'build',None)) or self.system is None:
            raise Rejection('Public Application.build / diagnostics unavailable')

    def compile_application(self,aid,publish,gate):
        self.compile_progress=dict(applicationId=aid,cleared=[],invoked=False,returned=False,categories=[],diagnostics=[])
        self._owned();system=self.system;categories=list(system.get_message_categories())
        for category in categories:
            system.clear_messages(category);self.compile_progress['cleared'].append(text_type(category))
        publish('diagnostics-cleared.json',dict(categories=[text_type(x) for x in categories]))
        publish('build-call.json',dict(applicationId=aid))
        gate()
        self.compile_progress['invoked']=True
        self.attempts['build']+=1
        self.objects[aid].build()
        self.compile_progress['returned']=True
        publish('build-returned.json',dict(applicationId=aid))
        # Re-enumerate: compilation may add categories. Empty/failed coverage is not zero errors.
        categories=list(system.get_message_categories());rows=self.compile_progress['diagnostics'];groups=self.compile_progress['categories']
        if not categories:raise ValueError('No compiler message category coverage')
        for category in categories:
            key=text_type(category)
            if any(g['category']==key for g in groups):raise ValueError('Duplicate compiler category')
            count=0
            for msg in system.get_message_objects(category):
                severity=text_type(msg.severity).lower()
                if severity not in ('fatalerror','error','warning','information','text'):raise ValueError('Unknown compiler severity: '+severity)
                row=dict(severity=severity,text=source_text(msg.text),category=key)
                for name in ('prefix','number','line','column','object_name'):
                    if hasattr(msg,name):row[name]=scalar(getattr(msg,name))
                rows.append(row);count+=1
                if len(rows)>50000:raise ValueError('Compiler diagnostics exceeded bound')
            groups.append(dict(category=key,count=count,endObserved=True))
        result=dict(applicationId=aid,completed=True,diagnosticsComplete=True,diagnostics=rows,categories=groups)
        publish('compiler-result.json',result)
        return result


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

def supported_st_parts(parts):
    # VarDeclObject is declaration metadata, not a second implementation language.
    # Keep the original list in evidence/versioning; only classify these known sets.
    return isinstance(parts,list) and (parts==[ST] or parts==[VAR_DECL,ST] or parts==[ST,VAR_DECL])

def object_data(state,oid,aid):
    row=state['nodes'].get(oid)
    if row is None or row['applicationId']!=aid or row['parentId']!=aid:raise Rejection('Only exact Application-root objects supported')
    if row['nativeTypeId']!=POU or not supported_st_parts(row['embeddedObjectTypes']) or row['declaration'] is None or row['implementation'] is None:raise Rejection('Native ST POU evidence missing')
    if any(x['parentId']==oid for x in state['nodes'].values()):raise Rejection('POU with child objects not supported')
    m=re.match(r'^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\b',row['declaration'],re.I)
    if not m or m.group(2).lower()!=row['path'][-1].lower():raise Rejection('Ordinary same-name POU header required')
    d=row['declaration'];i=row['implementation']
    norm=lambda x:x.replace('\r\n','\n').replace('\r','\n')
    return dict(objectId=oid,applicationId=aid,path=row['path'],nativeTypeId=row['nativeTypeId'],embeddedObjectTypes=row['embeddedObjectTypes'],language='ST',objectType='function_block' if m.group(1).upper()=='FUNCTION_BLOCK' else 'st_pou',hasImplementation=True,declaration=d,implementation=i,contentHash=digest([norm(d),norm(i)]))

DEVICE_TYPE='225bfe47-7336-4dbc-9419-4105a7c831fa'
ROOT_DESCRIPTION=dict(type='4102',id='10f4 0002',version='3.5.11.11')
DERIVED_DESCRIPTION=dict(type='40005',id='10F4 0005',version='00.00.00.10')
DERIVED_PORTS=[dict(id=1,role='Child',interface='Common.PCI',hostPath=-1),dict(id=2,role='Parent',interface='Inovance:System',hostPath=1)]

def validate_build_context(state,context):
    nodes=state['nodes'];children=context['children'];devices=context['devices']
    build_state_view(state)
    if set(context)!=set(['scheme','children','devices']) or context['scheme']!='resident-build-context-v1' or set(children)!=set(nodes)|set(['$project']):raise ValueError('Build tree coverage incomplete')
    seen=[]
    for parent,ids in children.items():
        if not isinstance(ids,list):raise ValueError('Build children are not ordered records')
        for oid in ids:
            if oid not in nodes or nodes[oid]['parentId']!=(None if parent=='$project' else parent):raise ValueError('Build ancestry differs')
            seen.append(oid)
    if len(seen)!=len(set(seen)) or set(seen)!=set(nodes):raise ValueError('Duplicate/missing build tree identity')
    if set(devices)!=set(k for k,v in nodes.items() if v['nativeTypeId']==DEVICE_TYPE):raise ValueError('Device coverage differs')
    for oid,dev in devices.items():
        if set(dev)!=set(['identity','connectors']) or set(dev['identity'])!=set(['type','id','version']) or not all(isinstance(x,string_types) and x for x in dev['identity'].values()):raise ValueError('Incomplete device identity')
        ids=[]
        for port in dev['connectors']:
            if set(port)!=set(['id','role','interface','hostPath']) or type(port['id']) not in int_types or type(port['hostPath']) not in int_types or not isinstance(port['role'],string_types) or not isinstance(port['interface'],string_types):raise ValueError('Incomplete connector')
            ids.append(port['id'])
        if len(ids)!=len(set(ids)):raise ValueError('Duplicate connector')

def build_source_version(state,aid):
    return digest(dict(applicationId=aid,projectPath=state['projectPath'],projectHandle=state['projectHandle'],
        sources=dict((k,v) for k,v in state['nodes'].items() if v['declaration'] is not None or v['implementation'] is not None)))

def build_state_view(state):
    dependencies(state)
    owned=state['openedProjects'].get(str(state['projectHandle']))
    validate_owned_projects(dict(returned=owned,primary=owned,all=list(state['openedProjects'].values()),readErrors=[]),state['projectPath'],state['projectHandle'])
    return dict((k,v) for k,v in state.items() if k!='openedProjects')

def compiler_reference_addition(before,after,pre,aid,support):
    """Validate exact one appended reference; retain every original row and unknown field."""
    checked_compiler_library_support(support)
    if aid not in before['applications']:raise ValueError('Compiler library Application differs')
    managers=[r for r in before['nodes'].values() if r.get('applicationId')==aid and r.get('nativeTypeId')=='adb5cb65-8e1d-4a00-b70a-375ea27582f3']
    changed=[oid for oid in before['nodes'] if digest(before['nodes'][oid])!=digest(after['nodes'].get(oid))]
    if len(managers)!=1 or changed!=[managers[0]['objectId']]:raise ValueError('Compiler library change is not confined to unique Application manager')
    manager=managers[0];oid=manager['objectId'];updated=after['nodes'][oid]
    if manager['parentId']!=aid:raise ValueError('Compiler library manager is not Application child')
    root=before['nodes'][aid];visited=set()
    while root['parentId'] is not None:
        if root['objectId'] in visited:raise ValueError('Cyclic Application ancestry')
        visited.add(root['objectId']);root=before['nodes'][root['parentId']]
    if pre['devices'].get(root['objectId'],{}).get('identity')!=ROOT_DESCRIPTION:raise ValueError('Compiler library change outside verified AM610')
    if digest(dict((k,v) for k,v in manager.items() if k!='directLibraries'))!=digest(dict((k,v) for k,v in updated.items() if k!='directLibraries')):raise ValueError('Compiler changed library manager fields')
    old=manager['directLibraries'];new=updated['directLibraries']
    if not isinstance(old,list) or not isinstance(new,list) or len(new)!=len(old)+1 or digest(new[:-1])!=digest(old):raise ValueError('Compiler changed original library references/order')
    ids=[]
    for row in new:
        rid=row.get('id')
        if not isinstance(rid,string_types) or not re.match(r'^[1-9][0-9]*\Z',rid) or rid in ids:raise ValueError('Invalid or duplicate native reference identity')
        ids.append(rid)
    if any((r.get('name') or '').lower()=='#iecvaraccess' or (r.get('placeholder_name') or '').lower()=='iecvaraccess' for r in old):raise ValueError('Compiler dependency already present')
    r=new[-1]
    if digest(dict((k,v) for k,v in r.items() if k!='id'))!=digest(IEC_COMPILER_REFERENCE):raise ValueError('Unexpected compiler library reference')
    return dict(libraryManagerId=oid,applicationId=aid,index=len(old),reference=copy.deepcopy(r),supportHash=digest(support))

def build_conservation(before,after,pre,post,aid=None,support=None):
    """Only the two individually evidenced compiler effects; existing content stays exact."""
    validate_build_context(before,pre);validate_build_context(after,post)
    old=before['nodes'];new=after['nodes']
    if set(old)-set(new):raise ValueError('Compiler removed original node')
    library_additions=[]
    changed=[oid for oid,row in old.items() if digest(new[oid])!=digest(row)]
    if changed:
        if support is None:raise ValueError('Compiler changed existing node: '+changed[0])
        library_additions=[compiler_reference_addition(before,after,pre,aid,support)]
    added=sorted(set(new)-set(old))
    if len(added)>1:raise ValueError('Unexplained compiler-generated nodes')
    for k in set(before)|set(after):
        if k not in ('nodes','openedProjects') and (k not in before or k not in after or digest(before[k])!=digest(after[k])):raise ValueError('Build state changed: '+k)
    # Background library ownership is checked independently; direct references above are exact.
    for oid,dev in pre['devices'].items():
        if post['devices'].get(oid)!=dev:raise ValueError('Existing device/connector changed')
    if set(post['devices'])-set(pre['devices'])!=set(added):raise ValueError('Additional device coverage differs')
    if added:
        oid=added[0];r=new[oid];parent=r['parentId'];root=old.get(parent);dev=post['devices'][oid]
        expected=dict(objectId=oid,path=root['path']+['HwConfiguratioinDevice'] if root else [],parentId=parent,
            nativeTypeId=DEVICE_TYPE,applicationId=None,declaration=None,implementation=None,embeddedObjectTypes=[])
        if root is None or root['parentId'] is not None or pre['devices'].get(parent,{}).get('identity')!=ROOT_DESCRIPTION or r!=expected or dev!=dict(identity=DERIVED_DESCRIPTION,connectors=DERIVED_PORTS):raise ValueError('Unproven compiler-derived device')
        if any(x['identity']==DERIVED_DESCRIPTION for x in pre['devices'].values()):raise ValueError('Duplicate derived device')
        if post['children'][oid]!=[]:raise ValueError('Unexpected derived subtree')
    for parent,ids in pre['children'].items():
        if [x for x in post['children'][parent] if x not in added]!=ids:raise ValueError('Compiler reordered existing siblings')
    proof=dict(passed=True,addedDeviceIds=added,sourceUnchanged=True,directLibrariesUnchanged=not library_additions,taskCallsUnchanged=True)
    if library_additions:proof.update(originalDirectLibrariesUnchanged=True,compilerAddedDirectLibraries=library_additions)
    return proof

def checked_diagnostics(value,aid):
    if value.get('applicationId')!=aid or value.get('completed') is not True or value.get('diagnosticsComplete') is not True:raise ValueError('Incomplete compiler invocation/diagnostics')
    groups=value['categories'];rows=value['diagnostics']
    if not groups or not isinstance(rows,list):raise ValueError('Compiler coverage missing')
    keys=[]
    for group in groups:
        key=group['category'];keys.append(key)
        if not isinstance(key,string_types) or not key or group.get('endObserved') is not True or type(group.get('count')) not in int_types or group['count']!=sum(1 for r in rows if r.get('category')==key):raise ValueError('Compiler category incomplete')
    if len(keys)!=len(set(keys)):raise ValueError('Duplicate compiler category')
    for row in rows:
        if row.get('category') not in keys or row.get('severity') not in ('fatalerror','error','warning','information','text') or not isinstance(row.get('text'),string_types):raise ValueError('Invalid compiler diagnostic')
    errors=sum(1 for r in rows if r['severity'] in ('fatalerror','error'));warnings=sum(1 for r in rows if r['severity']=='warning')
    return dict(errorCount=errors,warningCount=warnings,buildPassed=errors==0)

class ResidentSession(object):
    def __init__(self,adapter,disk_hash,publish,admission=lambda:None):
        self.adapter=adapter;self.disk_hash=disk_hash;self.publish=publish;self.admission=admission;self.poison=None;self.secondary=[];self.previous_disk=None;self.edits=0
    def handle(self,request):
        if self.poison is not None:raise Conflict('Resident session frozen; no further dispatch')
        dispatched=False;before=None
        try:
            command=request['command'];args=request['args']
            if command not in ('inspect','list','read','change','build'):raise Rejection('Tool not adapted to resident mode')
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
            elif command=='build':
                if args.get('targetKind','application')!='application' or args.get('expectedResidentVersion')!=version:raise Rejection('Build requires current memory version and actual Application')
                self.adapter.prepare_build(aid)
                support=getattr(self.adapter,'build_library_support',lambda:None)()
                self.publish('compiler-library-support-before.json',support)
                context=self.adapter.build_context(before)
                self.publish('build-context-before.json',context)
                self.publish('checkpoint.json',dict(request=request,state=before,diskHash=disk,residentVersion=version))
                again=self.adapter.snapshot();again_context=self.adapter.build_context(again)
                self.publish('predispatch.json',dict(state=again,diskHash=self.disk_hash(),buildContext=again_context))
                if build_state_view(again)!=build_state_view(before) or again_context!=context or self.disk_hash()!=disk:raise Rejection('Build state changed before dispatch')
                self.admission()
                if self.disk_hash()!=disk:raise Conflict('Disk changed at final build gate')
                self.publish('dispatch.json',dict(operationId=request['operationId'],requestId=request['requestId'],action='build-application',applicationId=aid,inputResidentVersion=version,sourceVersion=build_source_version(before,aid)))
                dispatched=True
                def final_build_gate():
                    current=self.adapter.snapshot();current_context=self.adapter.build_context(current)
                    self.publish('build-input.json',dict(state=current,diskHash=self.disk_hash(),buildContext=current_context))
                    if build_state_view(current)!=build_state_view(before) or current_context!=context:raise Conflict('Memory changed immediately before native build')
                    self.admission()
                    if self.disk_hash()!=disk:raise Conflict('Disk changed at native build call')
                compiled=self.adapter.compile_application(aid,self.publish,final_build_gate)
                after=self.adapter.snapshot();self.publish('build-after-state.json',dict(state=after,diskHash=self.disk_hash()))
                post=self.adapter.build_context(after)
                self.publish('after.json',dict(state=after,diskHash=self.disk_hash(),buildContext=post))
                support_after=getattr(self.adapter,'build_library_support',lambda:None)()
                self.publish('compiler-library-support-after.json',support_after)
                check=build_conservation(before,after,context,post,aid,support)
                if check.get('compilerAddedDirectLibraries') and digest(support_after)!=digest(support):raise ValueError('Compiler library implementation changed during build')
                counts=checked_diagnostics(compiled,aid)
                if self.disk_hash()!=disk:raise ValueError('Disk changed during memory build')
                actual=dependencies(after)
                self.publish('verification.json',check)
                data.update(counts,completed=True,diagnosticsComplete=True,diagnostics=compiled['diagnostics'],targetKind='application',
                    compileCalls=1,buildEvidenceScope='resident-memory',buildInputResidentVersion=version,
                    builtSourceVersion=build_source_version(before,aid),buildConservation=check,compilerResultHash=digest(compiled),
                    snapshot=digest(actual),residentVersion=digest(dict(dependencies=actual,diskHash=disk)),
                    persistedToProject=False,persistedToWorkingCopy=False)
            elif self.disk_hash()!=disk:raise Conflict('Disk changed during read')
            self.previous_disk=disk
            return dict(contractVersion='1.0.0',operationId=request['operationId'],status='succeeded',summary=u'当前内存编译已完成；检查buildPassed及诊断，未保存或关闭' if command=='build' else u'同一工程内存请求完成；未保存、未编译、未关闭',data=data)
        except Exception as error:
            detail=dict(type=type(error).__name__,message=text_type(error),traceback=traceback.format_exc(),dispatched=dispatched)
            recoverable=isinstance(error,Rejection) and not dispatched
            if not recoverable:self.poison=detail
            if request.get('command')=='build':
                try:self.publish('build-failure.json',dict(firstError=detail,partial=getattr(self.adapter,'compile_progress',None)))
                except Exception as secondary:self.secondary.append(dict(type=type(secondary).__name__,message=text_type(secondary),traceback=traceback.format_exc()));recoverable=False;self.poison=detail
            try:self.publish('first-error.json',detail)
            except Exception as secondary:self.secondary.append(dict(type=type(secondary).__name__,message=text_type(secondary),traceback=traceback.format_exc()));recoverable=False;self.poison=detail
            return dict(contractVersion='1.0.0',operationId=request['operationId'],status='unknown' if dispatched or not isinstance(error,Conflict) else 'conflict',summary=u'本次未派发；后续新指令可重新读取' if recoverable else u'已停止此常驻会话；保留现场，不重试或恢复性保存',error=dict(code='RESIDENT_UNCONFIRMED' if dispatched else 'RESIDENT_PRECONDITION',message=text_type(error)),data=dict(firstError=detail,secondaryErrors=self.secondary,recoverableRejection=recoverable,saved=False,reopened=False,closed=False))
