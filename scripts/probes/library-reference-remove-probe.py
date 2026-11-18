# -*- coding: utf-8 -*-
"""One-run, local IronPython observation. Only prepares two disposable AM610 fixtures.
No removal, repository modification, online APIs or service data mutation.
"""
import datetime
import io
import json
import os
import re
import sys
import traceback
import scriptengine
from System.IO import File, FileStream, FileMode, FileAccess, FileShare
from System.Text import UTF8Encoding
from System.Diagnostics import Process

ROOT = os.path.abspath(os.environ['INOPRO_REMOVE_PROBE_ROOT'])
REPO = os.path.abspath(os.environ['INOPRO_REMOVE_PROBE_REPO'])
BASE = '5e93ac6bc08f4b15986a118c86f2b0a4e7fbdaf7f68a8c054b21570522ef531d'
LIB = ('CAA Mathematics', '3.5.11.0', 'CAA Technical Workgroup', 'MATH')
NATIVE_MANAGER = 'adb5cb65-8e1d-4a00-b70a-375ea27582f3'
if not re.match(r'^D:\\InoPro-LibraryRemove-Probe-[0-9-]+$', ROOT, re.I):
    raise ValueError('Expected dedicated probe evidence folder')

def projection(value, names):
    return dict((name, value[name]) for name in names if name in value)

def write_new(name, value):
    path = os.path.join(ROOT, name)
    staging = path + '.tmp'
    if File.Exists(path) or File.Exists(staging):
        raise ValueError('Evidence already exists: ' + name)
    File.WriteAllText(staging, unicode(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)), UTF8Encoding(False))
    stream = FileStream(staging, FileMode.Open, FileAccess.ReadWrite, getattr(FileShare, 'None'))
    try:
        stream.Flush(True)
    finally:
        stream.Dispose()
    File.Move(staging, path)

def utc():
    return datetime.datetime.utcnow().isoformat() + 'Z'

phase_counter = [0]
def phase(case, step, state='started'):
    phase_counter[0] += 1
    write_new('phase-%04d.json' % phase_counter[0], dict(case=case, step=step, state=state, utc=utc()))

def bridge_helpers():
    # Reuse the checked-out native read/catalog/compile functions without the
    # worker command dispatcher, request handling or registry. Load fixed files
    # only, with a fail-closed static delimiter for the top-level dispatcher.
    worker = os.path.join(REPO, 'bridge', 'worker.py')
    with io.open(worker, 'r', encoding='utf-8') as stream:
        code = stream.read()
    split = '# Fixed helper code only; request text is never evaluated.'
    if code.count(split) != 1:
        raise ValueError('Unexpected bridge layout')
    scope = dict(__file__=worker, projects=scriptengine.projects,
                 system=scriptengine.system, librarymanager=scriptengine.librarymanager)
    exec(compile(code.split(split)[0], worker, 'exec'), scope)
    other = os.path.join(REPO, 'bridge', 'library_reference.py')
    with io.open(other, 'r', encoding='utf-8') as stream:
        exec(compile(stream.read(), other, 'exec'), scope)
    return scope

def observed_members(obj, keys):
    names = sorted(set(unicode(n) for n in dir(obj) if not n.startswith('_')))
    focused = {}
    for key in keys:
        try:
            member = getattr(obj, key)
            focused[key] = {'available': True, 'callable': callable(member)}
            if callable(member) and getattr(member, '__doc__', None):
                focused[key]['signatureHint'] = unicode(member.__doc__).splitlines()[0][:320]
        except AttributeError:
            focused[key] = {'available': False}
        except Exception as e:
            focused[key] = {'available': None, 'reason': unicode(e)}
    return {'visiblePublicMembers': names, 'focused': focused}

USAGE_MEMBERS = ('get_cross_references', 'find_cross_references', 'find_references',
                 'get_symbol_references', 'get_usages', 'find_usages', 'get_symbols',
                 'get_used_libraries', 'is_used', 'get_dependents')

def walk_target(bridge, project):
    objects = list(bridge['walk'](project))
    apps = [r for r in objects if getattr(r[0], 'is_application', False)]
    if len(apps) != 1:
        raise ValueError('Expected one Application')
    app, app_path, aid = apps[0]
    managers = [r for r in objects if r[2] == aid and unicode(r[0].type).lower() == NATIVE_MANAGER
                and getattr(r[0], 'is_libman', False) is True]
    plcs = [r for r in objects if r[2] == aid and r[1] == app_path + ['PLC_PRG'] and bridge['st_object'](r[0])]
    if len(managers) != 1 or len(plcs) != 1:
        raise ValueError('Expected unique native manager and root ST PLC_PRG')
    manager, manager_path, _ = managers[0]
    source, plc_path, _ = plcs[0]
    if unicode(manager.parent.guid).lower() != aid:
        raise ValueError('Manager native parent is not exact Application')
    args = dict(projectId='local-probe-only', applicationId=aid, targetKind='application', maxReferences=2000)
    return app, manager, source, args, objects

def library_identity(bridge, managed):
    names = ('displayname', 'company', 'title', 'version', 'default_namespace')
    raw = [unicode(getattr(managed, k)) for k in names]
    raw.append(unicode(scriptengine.librarymanager.get_file_path(managed)))
    return bridge['sha'](bridge['encode'](raw))

def exact_target(bridge, manager, selected):
    native = [r for r in manager.references if getattr(r, 'is_managed', False) is True
              and getattr(r, 'is_placeholder', True) is False and getattr(r, 'system_library', True) is False
              and unicode(r.namespace) == selected['defaultNamespace']
              and unicode(r.name) == selected['displayName']
              and library_identity(bridge, r.managed_library) == selected['identity']]
    if len(native) != 1:
        raise ValueError('Direct native target missing or ambiguous')
    reference = native[0]
    same_selector = [r for r in manager.references if unicode(r.name).lower() == unicode(reference.name).lower()]
    if len(same_selector) != 1:
        raise ValueError('Native removal name selector is not unique in this manager')
    return reference

def only_target_added(before, after, target_id):
    before_rows = [r['rawFields'] for r in before['references']]
    after_rows = [r['rawFields'] for r in after['references'] if r['rawFields']['id'] != target_id]
    return (len(after['references']) == len(before_rows) + 1 and before_rows == after_rows)

def source_data(bridge, source):
    a = bridge['normalize'](unicode(source.textual_declaration.text))
    b = bridge['normalize'](unicode(source.textual_implementation.text))
    return dict(objectId=unicode(source.guid).lower(), declaration=a, implementation=b,
                contentHash=bridge['content_hash'](a, b))

def dependencies(manager):
    # Exposed metadata is a candidate graph observation, not a proven inverse
    # use graph. Do not run recursively expanding methods on arbitrary libraries.
    result = []
    for ref in manager.references:
        line = dict(id=unicode(ref.id), name=unicode(ref.name),
                    isPlaceholder=bool(ref.is_placeholder), managed=bool(ref.is_managed))
        if ref.is_managed and not ref.is_placeholder:
            try:
                deps = ref.managed_library.dependencies
                if deps is None:
                    line['coverage'] = 'unavailable-null'
                else:
                    line['declaredDependencyStrings'] = [unicode(v) for v in deps]
                    line['coverage'] = 'native-declaration-strings-only'
            except Exception as e:
                line.update(coverage='unavailable', reason=unicode(e))
        else:
            line['coverage'] = 'not-a-fixed-managed-library'
        result.append(line)
    return result

def coverage(bridge, project, args, objects, names):
    search_args = dict(args, maxObjects=2000)
    corpus = bridge['search_inventory'](project, search_args)
    # Keep candidate text locations without implying a resolved-symbol index.
    mentions = []
    for obj, path, aid in objects:
        for side in ('declaration', 'implementation'):
            if not getattr(obj, 'has_textual_' + side, False):
                continue
            value = unicode(getattr(obj, 'textual_' + side).text)
            for number, line in enumerate(value.splitlines()):
                if names.search(line):
                    mentions.append(dict(path=path, applicationId=aid, side=side, line=number+1, text=line))
    return dict(nativeObjectCount=len(objects), textCandidateMentions=mentions,
                searchScope=corpus.get('scope'), skipped=corpus.get('skippedObjects'),
                failures=corpus.get('enumerationFailures'), limitations=[
                    'Token/text mentions are not resolved references.',
                    'Cross-Application and native non-text objects are not proved unused.',
                    'No verified complete reverse dependency or compiler-bound usage graph.'])

def prepare_one(bridge, case, selected, lib, dirty):
    path = os.path.join(ROOT, case, 'AM610_' + case + '.project')
    marked = path + '.~u'
    if os.path.exists(marked) or bridge['file_hash'](path) != BASE:
        raise ValueError('Initial test fixture changed or occupied; refusing replay')
    phase(case, 'open-pristine')
    project = scriptengine.projects.open(path)
    phase(case, 'open-pristine', 'done')
    try:
        app, manager, plc, args, objects = walk_target(bridge, project)
        begin = bridge['library_inventory'](project, args)
        source_before = source_data(bridge, plc)
        old_snapshot = bridge['snapshot'](project)
        if not bridge['complete_library_inventory'](begin):
            raise ValueError('Initial direct reference coverage insufficient for fixture preparation')
        if any(r['rawFields']['namespace'].lower() == 'math' or
               r['rawFields']['name'].lower() == selected['displayName'].lower()
               for r in begin['references']):
            raise ValueError('The control fixture already has the target namespace/identity')
        if re.search(r'\b(?:sgn|ProbeQualified|ProbeUnqualified)\b',
                     source_before['declaration']+'\n'+source_before['implementation'], re.I):
            raise ValueError('The pristine PLC_PRG has unexpected target tokens')
        # Save evidence before the first allowed fixture-only write.
        write_new(case+'-pristine.json', dict(projectPath=path, mainHash=BASE,
                    source=source_before, inventory=begin, snapshot=old_snapshot))
        phase(case, 'add-exact-reference')
        dirty[0] = True
        manager.add_library(lib)
        phase(case, 'add-exact-reference', 'done')
        ref = exact_target(bridge, manager, selected)
        refid = unicode(ref.id)
        if bridge['snapshot'](project) != old_snapshot:
            raise ValueError('Adding the fixture reference changed source')
        q = bool(ref.qualified_only)
        source_plan = 'none'
        if case == 'used':
            phase(case, 'add-test-call')
            # Both use the same library identity; add an unqualified call only
            # when this fixture does not mark the native reference qualified-only.
            declaration = 'PROGRAM PLC_PRG\nVAR\n    ProbeQualified : INT;\n'
            implementation = 'ProbeQualified := MATH.sgn(lr := 1.0);\n'
            if not q:
                declaration += '    ProbeUnqualified : INT;\n'
                implementation += 'ProbeUnqualified := sgn(lr := 1.0);\n'
            declaration += 'END_VAR\n'
            # The pristine control's existing program is intentionally left
            # intact except for appended declarations and implementation lines.
            if not re.search(r'(?im)^\s*END_VAR\s*$', source_before['declaration']):
                raise ValueError('Pristine PLC_PRG has no recognizable VAR terminator')
            extra = '\n'.join(declaration.splitlines()[2:-1])+'\n'
            new_dec, count = re.subn(r'(?m)^([ \t]*END_VAR[ \t]*)$',lambda m:extra+m.group(1),source_before['declaration'],count=1)
            if count != 1:
                raise ValueError('Could not isolate one test variable block')
            new_impl=source_before['implementation'].rstrip('\n')+'\n'+implementation
            plc.textual_declaration.replace(new_dec)
            plc.textual_implementation.replace(new_impl)
            source_plan='qualified-only' if q else 'qualified-and-unqualified'
            phase(case, 'add-test-call', 'done')
        fresh = bridge['library_inventory'](project,args)
        expected = source_data(bridge,plc)
        if not bridge['complete_library_inventory'](fresh) or not only_target_added(begin,fresh,refid):
            raise ValueError('Direct references differ beyond the one fixture addition')
        phase(case, 'save-fixture')
        project.save()
        phase(case, 'save-fixture', 'done')
        phase(case, 'close-fixture')
        project.close()
        dirty[0] = False
        phase(case, 'close-fixture', 'done')
    except Exception:
        if not dirty[0]:
            project.close()
        raise
    saved_hash=bridge['file_hash'](path)
    if saved_hash == BASE or os.path.exists(marked):
        raise ValueError('Fixture save not confirmed')
    phase(case, 'reopen-saved')
    project=scriptengine.projects.open(path)
    try:
        phase(case, 'reopen-saved', 'done')
        app, manager, plc, args, objects=walk_target(bridge,project)
        inventory=bridge['library_inventory'](project,args)
        native=exact_target(bridge,manager,selected)
        if (unicode(native.id)!=refid or inventory['configurationVersion']!=fresh['configurationVersion']
                or not only_target_added(begin,inventory,refid) or source_data(bridge,plc)!=expected):
            raise ValueError('Native readback differs after reopen')
        phase(case, 'compile-saved-baseline')
        result=bridge['compile_application'](project,args['applicationId'],'application')
        phase(case, 'compile-saved-baseline', 'done')
        summary=result.get('data',{})
        build=dict(result=result, savedFileHash=saved_hash,
                   errors=sum(m['severity'] in ('fatalerror','error') for m in summary.get('diagnostics',[])),
                   warnings=sum(m['severity']=='warning' for m in summary.get('diagnostics',[])))
        if result['status']!='succeeded' or summary.get('buildPassed') is not True:
            write_new(case+'-baseline-build-failed.json',build)
            raise ValueError('Real fixture compile did not yield a passing baseline')
        phase(case, 'read-native-coverage')
        observation=dict(case=case, path=path, savedHash=saved_hash, inventory=inventory,
            exactReferenceId=refid,
            selected=projection(selected,('identity','displayName','title','company','version','defaultNamespace')),
            qualifiedOnly=q, sourcePlan=source_plan, source=source_data(bridge,plc), build=build,
            interfaceSamples=dict(manager=observed_members(manager,('get_libraries','references','remove_library')+USAGE_MEMBERS),
                reference=observed_members(native,('id','managed_library','get_dependencies','remove')+USAGE_MEMBERS),
                managedLibrary=observed_members(native.managed_library,('dependencies','get_dependencies')+USAGE_MEMBERS),
                app=observed_members(app,('build',)+USAGE_MEMBERS),
                program=observed_members(plc,USAGE_MEMBERS),
                project=observed_members(project,USAGE_MEMBERS),
                repository=observed_members(scriptengine.librarymanager,('get_all_libraries','uninstall_library')+USAGE_MEMBERS)),
            otherLibraryDependencies=dependencies(manager),
            sourceCoverage=coverage(bridge,project,args,objects,re.compile(r'\b(?:MATH|sgn)\b',re.I)),
            classification='known-in-use' if case=='used' else 'insufficient-to-remove',
            coverageReason=('Qualified native library call in saved PLC_PRG and successful offline build.'
                            if case=='used' else 'No verified reverse use coverage for all native objects, compiler symbols and dependent libraries.'))
        write_new(case+'-observed.json',observation)
        phase(case, 'read-native-coverage', 'done')
    finally:
        phase(case, 'close-after-observation')
        project.close()
        phase(case, 'close-after-observation', 'done')
    if bridge['file_hash'](path)!=saved_hash or os.path.exists(marked):
        raise ValueError('Read/compile close changed fixture file or left ownership uncertain')
    write_new(case+'-closed.json',dict(path=path, sha256=saved_hash, closed=True, removalAttempted=False))
    return dict(case=case, classification=observation['classification'], savedHash=saved_hash, removed=False,
                errors=build['errors'], warnings=build['warnings'])

def run():
    bridge = bridge_helpers()
    catalog,native = bridge['installed_inventory']()
    chosen = [x for x in catalog['entries'] if tuple(x[k] for k in ('title','version','company','defaultNamespace'))==LIB]
    if len(chosen)!=1 or len(native.get(chosen[0]['identity'],[]))!=1:
        raise ValueError('User-selected test library identity missing or ambiguous')
    selected = chosen[0]
    lib = native[selected['identity']][0]
    write_new('installed-target.json',dict(target=projection(selected,('identity','displayName','title','version','company','defaultNamespace')),
        catalogEnumerationComplete=catalog['enumerationComplete'],catalogFailureCount=len(catalog['failures'])))
    if not catalog['enumerationComplete']:
        raise ValueError('Full native catalog evidence not confirmed')
    rows=[prepare_one(bridge,k,selected,lib,dirty) for k in ('unused','used')]
    write_new('result.json',dict(status='completed',fixtures=rows, decision='read-only-assessment',
                                  removalAttempted=False, uninstallAttempted=False, utc=utc()))

dirty=[False]
process=Process.GetCurrentProcess()
write_new('native-start.json',dict(pid=process.Id,startTicks=unicode(process.StartTime.ToUniversalTime().Ticks),
            executableVersion=unicode(process.MainModule.FileVersionInfo.FileVersion),
            scriptEngineVersion=sys.version, utc=utc()))
try:
    scriptengine.system.execute_on_primary_thread(run)
except Exception as error:
    write_new('failure.json',dict(status='unknown' if dirty[0] else 'stopped',error=unicode(error),
                              traceback=traceback.format_exc(),dirty=dirty[0],removalAttempted=False,utc=utc()))
    if not dirty[0]:
        scriptengine.system.exit()
else:
    scriptengine.system.exit()
