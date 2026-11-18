# -*- coding: utf-8 -*-
"""Two passes on a disposable ST fixture. The evidence pass is read-only."""
import io
import json
import os
import re
import sys
import traceback

from System import AppDomain, DateTime
from System.Diagnostics import Process
import scriptengine
from scriptengine import device_repository, projects, system

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from device_add_preflight import Journal, check_equal, exception_data, file_available, load_fixed_helpers, run_primary

SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
PROJECT = 'AM610_S7_ReferenceProbe.project'
MEMBERS = ('get_cross_references', 'find_cross_references', 'find_references', 'get_symbol_references',
           'find_usages', 'get_usages', 'resolve_symbol', 'resolve_identifier', 'get_declaration',
           'get_symbol_at_position', 'get_identifier_info', 'get_symbols', 'get_all_signatures',
           'get_only_configured_signatures', 'create_symbol_config')


def load(path):
    with io.open(path, 'r', encoding='utf-8-sig') as stream:
        return json.load(stream)


def files(api, directory):
    result = {}
    for folder, unused, names in os.walk(directory):
        for name in names:
            path = os.path.join(folder, name)
            relative = os.path.relpath(path, directory).replace('\\', '/')
            try:
                result[relative] = dict(size=os.path.getsize(path), sha256=api['file_hash'](path))
            except (IOError, OSError) as error:
                result[relative] = dict(readError=unicode(error))
    return result


def member_surface(value):
    public = sorted(n for n in dir(value) if not n.startswith('_'))
    focus = {}
    for name in MEMBERS:
        try:
            candidate = getattr(value, name)
        except AttributeError:
            focus[name] = dict(status='not-exposed')
        except Exception as error:
            focus[name] = dict(status='read-error', error=unicode(error))
        else:
            focus[name] = dict(status='callable' if callable(candidate) else 'value',
                               document=unicode(getattr(candidate, '__doc__', '') or '')[:1500])
    return dict(relatedPublicMembers=[n for n in public if re.search('symbol|cross|referen|identif|declara|language', n, re.I)],
                probed=focus)


def signature_read(symbol, names):
    if symbol is None:
        return dict(status='symbol-config-unavailable')
    data = dict(surface=member_surface(symbol), status='unknown', compileArgument=False, scope='signatures, not usage positions')
    get = getattr(symbol, 'get_all_signatures', None)
    if not callable(get):
        data['status'] = 'get-all-signatures-not-exposed'
        return data
    try:
        signatures = get(False)
        data.update(status='read', count=len(signatures), cap=1200, matches=[])
        for i in range(min(len(signatures), data['cap'])):
            sig = signatures[i]
            if unicode(sig.name).lower() not in names:
                continue
            variables = sig.variables
            data['matches'].append(dict(name=unicode(sig.name), qualifiedName=unicode(sig.full_qualified_name),
                namespace=unicode(sig.namespace_path), variables=[dict(name=unicode(variables[k].name), type=unicode(variables[k].type),
                qualifiedBaseType=unicode(variables[k].full_qualified_base_type)) for k in range(len(variables))],
                signatureSurface=member_surface(sig), variableSurface=member_surface(variables[0]) if len(variables) else None))
        data['truncated'] = len(signatures) > data['cap']
    except Exception as error:
        data.update(status='error', error=exception_data(error, traceback.format_exc()))
    return data


def app_candidates(api, project):
    rows = list(api['walk'](project))
    apps = [(obj,path,aid) for obj,path,aid in rows if getattr(obj,'is_application',False)]
    if len(apps) != 1:
        raise ValueError('Expected exactly one fixture Application')
    app, path, aid = apps[0]
    return app, path, aid, rows


def select_sources(api, fixture, rows, app_path, app_id, read_back):
    selected = {}
    for name in sorted(fixture):
        found = [obj for obj,path,aid in rows if aid==app_id and path==app_path+[name]]
        if len(found)!=1:
            raise ValueError('Non-unique fixture object: '+name)
        obj=found[0]
        expected=fixture[name]
        actual=api['read_object'](obj,app_path+[name],app_id)
        for prop,want in [('objectType',expected['kind']),('declaration',expected['declaration']),('implementation',expected['implementation'])]:
            check_equal('FIXTURE_SOURCE_CHANGED',want,actual[prop],'$.objects.'+name+'.'+prop)
        selected[name]=obj
        read_back[name]=actual
    return selected


def run(api, root, mode, engine):
    file_path=os.path.join(root,'engineering',PROJECT)
    spec=load(os.path.join(HERE,'semantic-reference-fixture.json'))
    origin=load(os.path.join(root,'fixture-origin.json'))
    check_equal('WRONG_FIXTURE_ORIGIN',dict(path=file_path,sha256=SEED),
                dict(path=origin['project'],sha256=origin['seedSha256']),'$.fixture')
    journal=Journal(lambda i,event:api['publish'](os.path.join(root,'%s-step-%03d.json'%(mode,i)),
                                                 dict(event,utc=unicode(DateTime.UtcNow.ToString('o')))))
    state=dict(handle=None,closed=False,saveAttempted=False)
    expected_disk=SEED if mode=='prepare' else load(os.path.join(root,'prepare-result.json'))['diskAfter']
    original=files(api,os.path.dirname(file_path))
    evidence={}

    def open_fixture():
        if projects.primary is not None:
            raise ValueError('An unowned project is already active')
        file_available(api,file_path,expected_disk)
        state['handle']=projects.open(file_path)
        check_equal('OPENED_PATH_MISMATCH',os.path.normcase(file_path),os.path.normcase(unicode(state['handle'].path)),'$.path')

    def prepare(project, app):
        expected=list(spec['fixture'])
        existing=list(app.get_children(False))
        if sorted(unicode(item.get_name()) for item in existing if unicode(item.get_name()) in expected)!=['PLC_PRG']:
            raise ValueError('Unexpected fixture name collision')
        plc=next(item for item in existing if unicode(item.get_name())=='PLC_PRG')
        check_equal('SEED_POU_TYPE','st_pou',api['object_kind'](plc),'$.PLC_PRG')
        struct=app.create_dut('ST_S7Config',scriptengine.DutType.Structure,'')
        gvl=app.create_gvl('GVL_Config')
        for name,item in [('ST_S7Config',struct),('GVL_Config',gvl),('PLC_PRG',plc)]:
            obj=spec['fixture'][name]
            check_equal('CREATED_WRONG_OBJECT',name,unicode(item.get_name()),'$.name')
            item.textual_declaration.replace(obj['declaration'])
            if name=='PLC_PRG':
                item.textual_implementation.replace(obj['implementation'])
        create_symbol=getattr(app,'create_symbol_config',None)
        if not callable(create_symbol):
            return None
        before=set(unicode(x.guid) for x in app.get_children(False))
        try:
            return create_symbol(False,False,None)
        except Exception as error:
            if set(unicode(x.guid) for x in app.get_children(False))!=before:
                raise
            evidence['symbolFixtureSetupError']=exception_data(error,traceback.format_exc())
            return None

    def work():
        journal.step('open-dedicated-fixture',open_fixture)
        project=state['handle']
        app, app_path, app_id, rows=app_candidates(api,project)
        symbol=None
        if mode=='prepare':
            symbol=journal.step('author-fixture',lambda:prepare(project,app),
                                lambda v:dict(symbolConfigCreated=v is not None))
            app, app_path, app_id, rows=app_candidates(api,project)
        evidence.update(applicationId=app_id,applicationPath=app_path,projectPath=file_path,objects={})
        selected=select_sources(api,spec['fixture'],rows,app_path,app_id,evidence['objects'])
        evidence['snapshot']=api['snapshot'](project)
        if mode=='prepare':
            built=journal.step('prepare-offline-compile',lambda:api['compile_application'](project,app_id,'application'))
            evidence['build']=built
            if built.get('data',{}).get('buildPassed') is not True:
                raise ValueError('Fixture compile not confirmed')
            evidence['symbolInventory']=journal.step('inspect-compiled-symbol-signatures',
                                              lambda:signature_read(symbol,{n.lower() for n in selected}))
            state['saveAttempted']=True
            journal.step('save-prepared-fixture',project.save)
        else:
            prior=load(os.path.join(root,'prepare-result.json'))
            check_equal('PREPARED_APPLICATION_CHANGED',prior['evidence']['applicationId'],app_id,'$.applicationId')
            check_equal('PREPARED_TEXT_SNAPSHOT_CHANGED',prior['evidence']['snapshot'],evidence['snapshot'],'$.snapshot')
            for name,obj in evidence['objects'].items():
                check_equal('PREPARED_OBJECT_CHANGED',prior['evidence']['objects'][name],obj,'$.objects.'+name)
            symbol_rows=[obj for obj,path,aid in rows if aid==app_id and getattr(obj,'is_symbol_config',False)]
            if len(symbol_rows)>1:
                raise ValueError('Unexpected ambiguous symbol configuration object')
            native=[('scriptengine',scriptengine),('system',system),('projects',projects),('project',project),('Application',app)]
            native.extend(sorted(selected.items()))
            native.extend([('PLC_PRG.declaration',selected['PLC_PRG'].textual_declaration),
                           ('PLC_PRG.implementation',selected['PLC_PRG'].textual_implementation)])
            evidence['nativeSurfaces']={key:member_surface(value) for key,value in native}
            evidence['symbolInventory']=journal.step('read-saved-symbol-inventory-without-compile',
                lambda:signature_read(symbol_rows[0] if symbol_rows else None,{n.lower() for n in selected}))
            evidence['loadedComponents']=[unicode(a.GetName().FullName) for a in AppDomain.CurrentDomain.GetAssemblies()
                                          if re.search('ReferenceView|LanguageModelUtilities|ScriptEngine',unicode(a.GetName().Name),re.I)]
            args=dict(projectId='s7-disposable-reference-identity',applicationId=app_id,targetKind='application')
            def inventory():
                data=api['search_inventory'](project,args)
                return dict(status='succeeded',data=dict(data,diskHash=api['file_hash'](file_path)))
            evidence['sourceInventory']=journal.step('read-existing-search-inventory',inventory,
                                                      lambda r:dict(readObjects=r['data']['scope']['readObjects']))

    def close():
        project=state['handle']
        if project is None:
            return dict(closed=False)
        check_equal('CLOSE_PATH_MISMATCH',os.path.normcase(file_path),os.path.normcase(unicode(project.path)),'$.path')
        if mode=='prepare' and state['saveAttempted'] and journal.primaryFailure:
            return dict(closed=False, retainedOpen=True)
        project.close()
        if projects.primary is not None:
            raise ValueError('Close not confirmed')
        state.update(handle=None,closed=True)
        return dict(closed=True)

    run_primary(system.execute_on_primary_thread,work,close,journal)
    disk_after=api['file_hash'](file_path)
    good=state['closed'] and not any((journal.primaryFailure,journal.cleanupError,journal.wrapperError,journal.loggingErrors))
    good=good and (disk_after!=SEED if mode=='prepare' else disk_after==expected_disk)
    api['publish'](os.path.join(root,mode+'-result.json'),dict(status='succeeded' if good else 'stopped',
        mode=mode,engine=engine,projectClosed=state['closed'],saveAttempted=state['saveAttempted'],
        diskBefore=expected_disk,diskAfter=disk_after,beforeFiles=original,afterFiles=files(api,os.path.dirname(file_path)) if state['closed'] else None,
        evidence=evidence,steps=journal.events,primaryFailure=journal.primaryFailure,cleanupError=journal.cleanupError,
        wrapperError=journal.wrapperError,loggingErrors=journal.loggingErrors))
    if state['closed']:
        system.exit()


if __name__=='__main__':
    root=os.path.abspath(os.environ['INOPRO_S7_PROBE_ROOT'])
    repo=os.path.abspath(os.environ['INOPRO_S7_PROBE_REPO'])
    mode=os.environ['INOPRO_S7_PROBE_MODE']
    if not re.match(r'^D:\\InoPro-S7-ReferenceProbe-[0-9-]+$',root,re.I) or mode not in ('prepare','read'):
        raise ValueError('Dedicated S7 fixture required')
    if os.path.exists(os.path.join(root,mode+'-result.json')):
        raise ValueError('Completed pass cannot be repeated')
    proc=Process.GetCurrentProcess()
    engine=dict(pid=proc.Id,creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),ironPython=sys.version,
                executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion))
    run(load_fixed_helpers(repo,projects,system,device_repository),root,mode,engine)
