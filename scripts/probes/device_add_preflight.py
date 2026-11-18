# -*- coding: utf-8 -*-
"""Shared read-only observations and guards for the standalone S6b probes."""
import io
import os
import traceback

IDENTITY = ('type', 'id', 'deviceDescriptionVersion')
NAME = 'S6bProbeDevice'
SOURCE = '# Fixed helper code only; request text is never evaluated.'

try:
    unicode
except NameError:
    unicode = str


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


def inventory(api, placements, repository):
    summary = api['device_catalog_inventory'](repository)
    installed = summary['entries']
    requested = set(n for p in placements for n in (p.get('allowedAtAppend') or []))
    by_id = {}
    for row in installed:
        by_id.setdefault(tuple(row[k] for k in IDENTITY),[]).append(row)
    candidates, failures = [], []
    for description in repository.get_all_devices():
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


def load_fixed_helpers(repo, projects, system, device_repository):
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


def load_read_helpers(repo, projects, system, repository):
    helpers=load_fixed_helpers(repo,projects,system,repository)
    names=('file_hash','direct_exclusive_probe','publish','snapshot','task_inventory','device_catalog_inventory')
    return {name:helpers[name] for name in names}


def file_available(api, file_path, expected):
    for suffix in ('.lock','.lck','.~lock','.~u'):
        if os.path.lexists(file_path+suffix):
            raise ValueError('Fixture has a native/external occupancy marker')
    api['direct_exclusive_probe'](file_path)
    if api['file_hash'](file_path)!=expected:
        raise ValueError('Fixture disk SHA-256 changed')


def task_and_st(api, project, nodes, items, journal=None):
    def task_rows():
        tasks=[]
        for row in nodes:
            item=items[row['guid']]
            if getattr(item,'is_application',False):
                args=dict(projectId='s6b-fixture',applicationId=row['guid'],targetKind='application')
                tasks.append(api['task_inventory'](project,args))
        return tasks
    step=journal.step if journal else without_journal
    return dict(tasks=step('readable-task-settings',task_rows),
                snapshot=step('readable-st-snapshot',lambda:api['snapshot'](project)))


def without_journal(unused_name, action, projection=None):
    return action()

def first_difference(expected, actual, path='$'):
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(set(expected) | set(actual)):
            child = path + '.' + key
            if key not in expected or key not in actual:
                return dict(path=child, expected=expected.get(key), actual=actual.get(key),
                            expectedPresent=key in expected, actualPresent=key in actual)
            found = first_difference(expected[key], actual[key], child)
            if found:
                return found
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        for index, pair in enumerate(zip(expected, actual)):
            left, right = pair
            found = first_difference(left, right, '%s[%s]' % (path,index))
            if found:
                if isinstance(left,dict) and 'path' in left and isinstance(left['path'],list):
                    found.setdefault('objectPath',left['path'])
                return found
        if len(expected)!=len(actual):
            return dict(path=path+'.length',expected=len(expected),actual=len(actual))
        return None
    if expected!=actual:
        return dict(path=path,expected=expected,actual=actual)
    return None


class ProbeRejected(ValueError):
    def __init__(self, code, difference=None):
        ValueError.__init__(self, code)
        self.code = code
        self.difference = difference


def exception_data(exc, python_traceback):
    def read(obj, name):
        try:
            return getattr(obj, name, None)
        except Exception:
            return None
    def text(value):
        try:
            return unicode(value) if value is not None else None
        except Exception:
            return None
    result=dict(type=type(exc).__name__, message=text(exc), traceback=python_traceback)
    for key in ('code','difference'):
        value=read(exc,key)
        if value is not None:
            result[key]=value
    dotnet=read(exc,'clsException')
    if dotnet is None and read(exc,'InnerException') is not None:
        dotnet=exc
    chain=[]
    for unused in range(8):
        if dotnet is None:
            break
        try:
            kind=text(dotnet.GetType().FullName)
        except Exception:
            kind=type(dotnet).__name__
        chain.append(dict(type=kind,message=text(read(dotnet,'Message')),stackTrace=text(read(dotnet,'StackTrace'))))
        dotnet=read(dotnet,'InnerException')
    if chain:
        result['dotNetExceptionChain']=chain
    return result


class Journal(object):
    def __init__(self, sink):
        self.sink=sink
        self.events=[]
        self.loggingErrors=[]
        self.primaryFailure=None
        self.wrapperError=None
        self.cleanupError=None

    def record(self, step, state, evidence=None):
        row=dict(step=step,state=state)
        if evidence is not None:
            row['evidence']=evidence
        self.events.append(row)
        try:
            self.sink(len(self.events),row)
        except Exception as exc:
            self.loggingErrors.append(dict(step=step,state=state,error=exception_data(exc,traceback.format_exc())))

    def step(self, step, action, projection=None):
        self.record(step,'started')
        try:
            value=action()
            evidence=projection(value) if projection else value
        except Exception as exc:
            detail=exception_data(exc,traceback.format_exc())
            if self.primaryFailure is None:
                self.primaryFailure=dict(step=step,error=detail)
            self.record(step,'failed',detail)
            raise
        self.record(step,'completed',evidence)
        return value


def run_primary(wrapper, work, cleanup, journal):
    """Keep the real exception while it is still in the IDE callback."""
    def callback():
        try:
            work()
        except Exception as exc:
            if journal.primaryFailure is None:
                journal.primaryFailure=dict(step='primary-thread-body',error=exception_data(exc,traceback.format_exc()))
                journal.record('primary-thread-body','failed',journal.primaryFailure['error'])
        finally:
            journal.record('close-handle','started')
            try:
                closed=cleanup()
            except Exception as exc:
                journal.cleanupError=exception_data(exc,traceback.format_exc())
                journal.record('close-handle','failed',journal.cleanupError)
            else:
                journal.record('close-handle','completed',closed)
    try:
        wrapper(callback)
    except Exception as exc:
        journal.wrapperError=exception_data(exc,traceback.format_exc())
        journal.record('primary-thread-wrapper','failed',journal.wrapperError)


def read_state(api, project, repository, journal=None):
    step = journal.step if journal else without_journal
    nodes,mapping=step('native-tree',lambda:native_snapshot(project),lambda value:value[0])
    controls=task_and_st(api,project,nodes,mapping,journal)
    placements=step('native-parents-and-append-indexes',lambda:parent_observations(nodes,mapping))
    catalog=step('directory-identities',lambda:inventory(api,placements,repository))
    return nodes,mapping,placements,catalog,controls


def native_site(placements, parent_guid):
    parent=next((p for p in placements if p['node']['guid']==parent_guid),None)
    if not parent:
        return None
    device_children=set(c['guid'] for c in parent['children'] if c['device'])
    child_connectors=[dict(guid=p['node']['guid'],connectors=p.get('observedConnectors'),
                           readError=p.get('connectorReadError'))
                      for p in placements if p['node']['guid'] in device_children]
    return dict(parent=parent, visibleChildDeviceConnectors=child_connectors)


def check_equal(code, expected, actual, path):
    diff=first_difference(expected,actual,path)
    if diff:
        raise ProbeRejected(code,diff)
    return actual


def verify_preflight(api, target, seed, repository, plan, nodes, placements, catalog, controls, journal=None):
    step = journal.step if journal else without_journal
    step('plan-instance-name',lambda:check_equal('PLAN_NAME_CHANGED',NAME,plan['name'],'$.name'))
    step('fixture-hash-before-check',lambda:check_equal('DISK_CHANGED',seed,api['file_hash'](target),'$.mainSha256'))
    step('tasks-and-st-comparison',lambda:check_equal('TASK_OR_ST_CHANGED',plan['readableTasksAndST'],controls,'$.readableTasksAndST'),
         lambda value:dict(snapshot=value['snapshot'],taskApplicationCount=len(value['tasks'])))
    location=step('planned-parent-index-connector-and-occupancy',lambda:native_site(placements,plan['parentGuid']))
    candidate=plan['candidate']
    native_matches=[row for row in catalog['matches'] if row['identity']==candidate['identity']]
    step('planned-directory-identity',lambda:native_matches)
    def guard():
        code=rejection(plan,nodes,placements,catalog)
        if journal:
            journal.record('rejection','observed',{'rejection':code})
        if code:
            if code=='TREE_CHANGED':
                diff=first_difference(comparable(plan['nodes']),comparable(nodes),'$.nodes')
                if journal:
                    journal.record('tree-difference-context','observed',
                        {'rawFirstDifference':first_difference(plan['nodes'],nodes,'$.nodes'),
                         'guardFirstDifference':diff})
            elif code=='IDENTITY_UNCONFIRMED':
                diff=first_difference([candidate],native_matches,'$.catalog.matches')
                if not diff:
                    diff=dict(path='$.catalog.coverage',actual=catalog['scope'],
                              metadataReadFailures=catalog.get('metadataReadFailures',[]))
            elif code=='NAME_CONFLICT':
                row=next(n for n in nodes if n['name'].lower()==plan['name'].lower())
                diff=dict(path='$.name',expected='unused',actual=row)
            else:
                diff=first_difference(plan.get('nativeSite'),location,'$.nativeSite') if 'nativeSite' in plan else None
                if not diff:
                    diff=dict(path='$.nativeSite',expected=dict(index=plan['index'],connector=plan['parentConnector']),actual=location)
            raise ProbeRejected(code,diff)
        return {'rejection':code}
    step('rejection',guard)
    # The diagnostic additionally requires every raw tree field; the
    # legacy rejection result above remains visible even for proxy GUID drift.
    step('raw-tree-comparison',lambda:check_equal('RAW_TREE_CHANGED',plan['nodes'],nodes,'$.nodes'),lambda value:dict(nodeCount=len(value)))
    if 'nativeSite' in plan:
        step('native-site-comparison',lambda:check_equal('SITE_CHANGED',plan['nativeSite'],location,'$.nativeSite'))
    identity=candidate['identity']
    key=step('create-exact-native-identity',
             lambda:repository.create_device_identification(int(identity['type']),identity['id'],identity['deviceDescriptionVersion']),
             lambda unused:identity)
    def exact():
        description=repository.get_device(key)
        actual=ident(description.device_id) if description is not None else None
        check_equal('EXACT_DESCRIPTION_CHANGED',identity,actual,'$.exactDescription.identity')
        selected=candidate['compatibleChildConnectors'][0]
        matches=[connector(row) for row in description.connectors if connector(row)==selected]
        check_equal('EXACT_CONNECTOR_CHANGED',[selected],matches,'$.exactDescription.connectors')
        return dict(identity=actual,matchedConnectors=matches)
    step('native-exact-description-readback',exact)
    return identity
