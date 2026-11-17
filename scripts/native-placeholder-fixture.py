# -*- coding: utf-8 -*-
"""One independent native test fixture; no product placeholder creation capability."""
import datetime,os,sys,traceback
if 'NATIVE_PUBLISH_HELPER_DIR' in os.environ:
    sys.path.insert(0, os.environ['NATIVE_PUBLISH_HELPER_DIR'])
elif '__file__' in globals():
    sys.path.insert(0, os.path.dirname(__file__))
from native_json_publish import publish_json

target=os.environ['FIXTURE_TARGET']
result=os.environ['FIXTURE_RESULT']
phase_dir=os.environ['FIXTURE_PHASE_DIR']
display=u'CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)'
record={'target':target,'stages':[],'passed':False}
project=None
counter=0
def phase(name,status,details=None):
    global counter
    counter+=1
    value={'stage':name,'status':status,'target':target,'atUtc':datetime.datetime.utcnow().isoformat()+'Z'}
    if details is not None:value['details']=details
    filename=os.path.join(phase_dir,'native-phase-%06d.json'%counter)
    publish_json(filename,value)
def run(name,fn):
    phase(name,'started')
    try:
        value=fn()
        phase(name,'succeeded')
        record['stages'].append(name)
        return value
    except Exception:
        phase(name,'failed',traceback.format_exc())
        raise
def locate():
    apps=[x for x in project.get_children(True) if getattr(x,'is_application',False)]
    if len(apps)!=1:raise ValueError('Application not unique')
    managers=[x for x in apps[0].get_children(True) if getattr(x,'is_libman',False)]
    if len(managers)!=1:raise ValueError('Manager not unique')
    refs=[x for x in managers[0].references if getattr(x,'is_placeholder',False) and unicode(x.placeholder_name)==u'S5bDemo']
    return apps[0],managers[0],refs
try:
    phase('catalog','started')
    libs=[x for x in librarymanager.get_all_libraries(False) if unicode(x.displayname)==display]
    if len(libs)!=1:raise ValueError('Installed identity not unique')
    lib=libs[0]
    record['installed']={'displayName':unicode(lib.displayname),'company':unicode(lib.company),
        'title':unicode(lib.title),'version':unicode(lib.version),'namespace':unicode(lib.default_namespace)}
    phase('catalog','succeeded',record['installed']);record['stages'].append('catalog')
    if projects.primary is not None:raise ValueError('Unowned primary project')
    project=run('open',lambda:projects.open(target,primary=True))
    app,manager,refs=run('inspect-before',locate)
    if refs:raise ValueError('Target placeholder already exists; no overwrite')
    record['applicationId']=unicode(app.guid).lower();record['managerId']=unicode(manager.guid).lower()
    record['beforeCount']=len(manager.references)
    run('add-placeholder',lambda:manager.add_placeholder(u'S5bDemo',lib))
    run('save',lambda:project.save())
    run('close',lambda:project.close());project=None
    project=run('reopen',lambda:projects.open(target,primary=True))
    app,manager,refs=run('inspect-after',locate)
    if len(refs)!=1:raise ValueError('Fixture placeholder not unique on reopen')
    ref=refs[0];redirection=ref.get_redirection()
    record['placeholder']={'id':unicode(ref.id),'name':unicode(ref.name),'namespace':unicode(ref.namespace),
        'isPlaceholder':bool(ref.is_placeholder),'isManaged':bool(ref.is_managed),
        'systemLibrary':bool(ref.system_library),'isRedirected':bool(ref.is_redirected),
        'explicitRedirection':None if redirection is None else unicode(redirection),
        'defaultResolution':unicode(ref.default_resolution),'effectiveResolution':unicode(ref.effective_resolution),
        'resolutionInfo':unicode(ref.resolution_info),'resolverGuid':unicode(ref.resolver_guid)}
    record['afterCount']=len(manager.references)
    if (record['afterCount']!=record['beforeCount']+1 or record['placeholder']['isManaged'] or
        record['placeholder']['systemLibrary'] or record['placeholder']['isRedirected'] or
        record['placeholder']['explicitRedirection'] not in (None,'')):
        raise ValueError('Fixture not a plain unredirected application placeholder')
    record['passed']=True
except Exception:
    record['error']=traceback.format_exc()
finally:
    if project is not None:
        try:run('final-close',lambda:project.close())
        except Exception:record['closeError']=traceback.format_exc();record['passed']=False
    phase('result-publish','started')
    publish_json(result,record)
    phase('result-publish','succeeded')
    system.exit()
