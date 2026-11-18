# -*- coding: utf-8 -*-
"""One AM610 fixture, staged before compile, with an attachment proof gate."""
import io
import json
import os
import re
import sys
import traceback

from System import DateTime, Guid
from System.Diagnostics import Process
from scriptengine import device_repository, projects, system

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from device_add_preflight import (Journal, ProbeRejected, check_equal, connector, exception_data, file_available,
                                  guid, load_fixed_helpers, native_site, native_snapshot, read_state, run_primary,
                                  task_and_st, verify_saved_tree)
from device_add_stage_guard import PRECOMPILE, require_attachment_control, verify_stage


SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
PROJECT = 'AM610_S6b_Placement.project'


def local_helpers(name):
    path = os.path.join(HERE, name)
    scope = dict(__file__=path, __name__='s6b_probe_utility')
    with io.open(path, 'r', encoding='utf-8') as stream:
        exec(compile(stream.read(), path, 'exec'), scope)
    return scope


def read_instance_link(item, row, placements):
    """Use an instance peer accessor only. Connector-set ownership is local."""
    names = sorted(name for name in dir(item) if re.search('connector|parent|attach|host', name, re.I))
    scope = dict(childGuid=row['guid'], treeParentGuid=row['parentGuid'], childName=row['name'],
                 relatedMembers=names, status='unavailable', attempts=[])
    parent = next((p for p in placements if p['node']['guid'] == row['parentGuid']), None)
    child_links = [connector(value) for value in item.connectors]
    scope['childConnectorMetadata'] = child_links
    if not parent:
        return scope
    for name in ('get_parent_connector', 'parent_connector'):
        if name not in names:
            continue
        try:
            accessor = getattr(item, name)
            peer = accessor() if callable(accessor) else accessor
            if peer is None or not callable(getattr(peer, 'get_device_object', None)):
                scope['attempts'].append(dict(accessor=name, status='no-bound-peer'))
                continue
            actual = connector(peer)
            owner = guid(peer.get_device_object())
            matches = [c for c in parent.get('observedConnectors', []) if c == actual and c['role'] == 'Parent']
            ends = [c for c in child_links if c['role'] == 'Child' and c['interface'] == actual['interface']]
            if owner == row['parentGuid'] and len(matches) == 1 and len(ends) == 1:
                scope.update(status='verified', accessor=name, parentConnector=actual, ownerGuid=owner, childConnector=ends[0])
                return scope
            scope['attempts'].append(dict(accessor=name, status='peer-conflicts', ownerGuid=owner, connector=actual))
        except Exception as error:
            scope['attempts'].append(dict(accessor=name, status='read-error', error=exception_data(error, traceback.format_exc())))
    return scope


def exported_controls(api, project, root, samples):
    path = os.path.join(root, 'native-link-control.export')
    try:
        project.export_native(samples, path, False)
        return dict(file=os.path.basename(path), sha256=api['file_hash'](path), nativeExport=True)
    except Exception as error:
        return dict(nativeExport=False, error=exception_data(error, traceback.format_exc()))


def device_delta(before, after):
    original = dict((n['guid'], n) for n in before if n['device'] or n['explicit'])
    current = dict((n['guid'], n) for n in after if n['device'] or n['explicit'])
    return dict(added=[n for n in after if n['guid'] in current and n['guid'] not in original],
                missing=[n for n in before if n['guid'] in original and n['guid'] not in current],
                altered=[dict(before=n, after=current[n['guid']]) for n in before
                         if n['guid'] in original and n['guid'] in current and n != current[n['guid']]])


def added_device_descriptors(delta):
    # This is an informational comparison between two separate compilations.
    # Same-stage and saved-instance checks continue to compare actual GUIDs.
    return [{key:value for key,value in row.items() if key!='guid'} for row in delta['added']]


def run_probe(root, mode, api):
    read = local_helpers('device-add-readonly.py')
    legacy = local_helpers('device-add-native.py')
    directory = os.path.join(root, 'engineering')
    target = os.path.join(directory, PROJECT)
    origin = read['load_json'](os.path.join(root, 'fixture-origin.json'))
    check_equal('ORIGIN_CHANGED', dict(projectPath=target, sha256=SEED),
                dict(projectPath=origin['project'], sha256=origin['initialProjectSha256']), '$.origin')
    marker = os.path.join(root, 'insert-dispatched.json')
    holder = dict(handle=None, token=None, closed=False, dispatched=False, insertReturned=False, attachmentConfirmed=False,
                  saved=False, persistenceConfirmed=False, savedBuild=None)
    engine_process = Process.GetCurrentProcess()
    def utc():
        return unicode(DateTime.UtcNow.ToString('o'))
    engine = dict(pid=engine_process.Id, creationUtcTicks=unicode(engine_process.StartTime.ToUniversalTime().Ticks),
                  executableVersion=unicode(engine_process.MainModule.FileVersionInfo.FileVersion), ironPython=sys.version)
    def emit(name, value):
        api['publish'](os.path.join(root, name+'.json'), value)
    def sink(number, row):
        row['utc'] = utc()
        emit('%s-step-%03d' % (mode, number), row)
    journal = Journal(sink)
    evidence = {}

    def acquire(digest):
        if projects.primary is not None:
            raise ProbeRejected('UNOWNED_PROJECT')
        file_available(api, target, digest)
        holder['handle'] = projects.open(target)
        holder['token'] = unicode(Guid.NewGuid())
        check_equal('PROJECT_PATH_CHANGED', os.path.normcase(target), os.path.normcase(unicode(holder['handle'].path)), '$.projectPath')
        return dict(projectPath=target, mainSha256=api['file_hash'](target), token=holder['token'])

    def close_owned():
        project = holder['handle']
        if project is None:
            return dict(closed=holder['closed'])
        check_equal('CLOSE_PATH_CHANGED', os.path.normcase(target), os.path.normcase(unicode(project.path)), '$.projectPath')
        project.close()
        if projects.primary is not None:
            raise ProbeRejected('PROJECT_STILL_OPEN_AFTER_CLOSE')
        holder.update(handle=None, closed=True)
        return dict(closed=True)

    def first_build():
        journal.step('baseline-open', lambda: acquire(SEED))
        project = holder['handle']
        initial, items = native_snapshot(project)
        baseline = journal.step('baseline-compile', lambda: legacy['build'](api, project, initial, items, target))
        after, unused = native_snapshot(project)
        emit('baseline-compile-evidence', dict(beforeTree=initial, afterTree=after, deviceDelta=device_delta(initial, after),
                                               build=baseline, token=holder['token'], engine=engine))
        evidence['baseline']=baseline
        if not baseline['result']['data']['buildPassed']:
            raise ProbeRejected('BASELINE_BUILD_FAILED')

    def confirmed_prior(name):
        result = read['load_json'](os.path.join(root, name+'-result.json'))
        if result['status'] != 'succeeded' or not result['state']['closed'] or result['finalSha256'] != SEED:
            raise ProbeRejected('PRIOR_PASS_UNCONFIRMED', dict(path='$.prior.mode', actual=name))
        return result

    def plan_uncompiled():
        confirmed_prior('baseline')
        journal.step('uncompiled-plan-open', lambda: acquire(SEED))
        nodes, items, places, catalog, controls = read_state(api, holder['handle'], device_repository, journal)
        plan = journal.step('select-live-append-place', lambda: read['choose_plan'](nodes, places, catalog, controls, target, SEED))
        plan.update(stage=PRECOMPILE, handleToken=holder['token'])
        verify_stage(api, target, SEED, device_repository, plan, PRECOMPILE, nodes, places, catalog, controls, journal)
        emit('placement-plan', plan)

    def try_placement():
        confirmed_prior('plan')
        plan = read['load_json'](os.path.join(root, 'placement-plan.json'))
        check_equal('PLAN_BINDING_CHANGED', dict(projectPath=target, mainSha256=SEED),
                    dict(projectPath=plan['projectPath'], mainSha256=plan['mainSha256']), '$.binding')
        journal.step('uncompiled-recheck-open', lambda: acquire(SEED))
        project = holder['handle']
        nodes, items, places, catalog, controls = read_state(api, project, device_repository, journal)
        verify_stage(api, target, SEED, device_repository, plan, PRECOMPILE, nodes, places, catalog, controls, journal, cross_open=True)
        parent = plan['parentGuid']
        samples = [n for n in nodes if n['device'] and n['parentGuid'] == parent]
        proofs = journal.step('existing-instance-attachment-controls',
                              lambda: [read_instance_link(items[n['guid']], n, places) for n in samples])
        export = journal.step('export-existing-link-controls', lambda: exported_controls(api, project, root,
                              [items[parent]] + [items[n['guid']] for n in samples]))
        emit('existing-connector-proof', dict(parentGuid=parent, controls=proofs, export=export))
        # Rebind only the raw observed trees. Index and both connector identities
        # remain the original plan values throughout the uncompiled window.
        binding = dict(plan, nodes=nodes, nativeSite=native_site(places, parent), readableTasksAndST=controls)
        latest, live, latest_places, latest_catalog, latest_controls = read_state(api, project, device_repository, journal)
        identity = verify_stage(api, target, SEED, device_repository, binding, PRECOMPILE, latest, latest_places,
                                latest_catalog, latest_controls, journal)
        verified_controls = journal.step('require-existing-attachment-proof', lambda: require_attachment_control(proofs))
        if holder['handle'] is not project or journal.loggingErrors or os.path.exists(marker):
            raise ProbeRejected('DISPATCH_EVIDENCE_UNCONFIRMED')
        check_equal('FILE_CHANGED_BEFORE_DISPATCH', SEED, api['file_hash'](target), '$.dispatch.disk')
        emit('insert-dispatched', dict(stage=PRECOMPILE, path=target, mainSha256=SEED, parentGuid=parent,
                                     index=plan['index'], connector=plan['parentConnector'], identity=identity,
                                     childConnector=plan['candidate']['compatibleChildConnectors'][0],
                                     controlAccessors=[row['accessor'] for row in verified_controls], token=holder['token']))
        holder['dispatched'] = True
        returned = journal.step('single-native-insert', lambda: live[parent].insert(plan['name'], plan['index'],
                                int(identity['type']), identity['id'], identity['deviceDescriptionVersion'], None),
                                lambda value: dict(returnedGuid=guid(value) if value is not None and hasattr(value,'guid') else None))
        holder['insertReturned'] = True
        immediate, after_items = journal.step('immediate-post-insert', lambda: native_snapshot(project), lambda pair:pair[0])
        matches = [n for n in immediate if n['parentGuid'] == parent and n['name'] == plan['name']]
        if len(matches) != 1:
            raise ProbeRejected('INSERTED_INSTANCE_NOT_UNIQUE')
        node = matches[0]
        new_guid = node['guid']
        if returned is not None and hasattr(returned,'guid'):
            check_equal('INSERT_RETURN_MISMATCH', new_guid, guid(returned), '$.return.guid')
        structure = journal.step('post-insert-original-structure', lambda: legacy['assess_after'](plan, latest, immediate, new_guid))
        if structure['generatedDescendants']:
            raise ProbeRejected('UNPLANNED_INSERT_DESCENDANTS',
                                dict(path='$.insert.descendants', actual=structure['generatedDescendants']))
        journal.step('post-insert-task-st', lambda: check_equal('TASK_OR_ST_CHANGED', latest_controls,
                     task_and_st(api, project, immediate, after_items), '$.postInsert.controls'))

        def attachment(row, mapping, tree):
            from device_add_preflight import parent_observations
            proof = read_instance_link(mapping[new_guid], row, parent_observations(tree, mapping))
            check_equal('ACTUAL_ATTACHMENT_UNCONFIRMED', dict(ownerGuid=parent, parentConnector=plan['parentConnector'],
                        childConnector=plan['candidate']['compatibleChildConnectors'][0]),
                        {k:proof.get(k) for k in ('ownerGuid','parentConnector','childConnector')}, '$.attachment')
            if proof.get('accessor') not in [entry['accessor'] for entry in verified_controls]:
                raise ProbeRejected('ATTACHMENT_ACCESSOR_UNCONTROLLED')
            return proof

        initial_link = journal.step('post-insert-actual-link', lambda:attachment(node, after_items, immediate))
        holder['attachmentConfirmed'] = True
        config = journal.step('post-insert-readable-config', lambda:legacy['read_config'](after_items[new_guid]))
        if journal.loggingErrors or api['file_hash'](target) != SEED:
            raise ProbeRejected('SAVE_EVIDENCE_UNCONFIRMED')
        journal.step('save-verified-placement', project.save)
        holder['saved'] = True
        journal.step('close-saved-placement', close_owned)
        saved = api['file_hash'](target)
        if saved == SEED:
            raise ProbeRejected('SAVED_MAIN_HASH_UNCHANGED')
        evidence['savedSha256'] = saved
        holder['closed'] = False
        journal.step('reopen-saved-before-compile', lambda:acquire(saved))
        persisted, reopened_items = journal.step('saved-uncompiled-tree', lambda:native_snapshot(holder['handle']), lambda pair:pair[0])
        journal.step('same-stage-persisted-structure', lambda:verify_saved_tree(immediate, persisted))
        saved_node = next(n for n in persisted if n['guid'] == new_guid)
        journal.step('saved-actual-link', lambda:check_equal('SAVED_ATTACHMENT_CHANGED', initial_link,
                     attachment(saved_node, reopened_items, persisted), '$.persistence.attachment'))
        journal.step('saved-readable-config', lambda:check_equal('SAVED_CONFIG_CHANGED', config,
                     legacy['read_config'](reopened_items[new_guid]), '$.persistence.config'))
        journal.step('saved-task-st', lambda:check_equal('SAVED_TASK_OR_ST_CHANGED', latest_controls,
                     task_and_st(api, holder['handle'], persisted, reopened_items), '$.persistence.controls'))
        holder['persistenceConfirmed'] = True
        holder['savedBuild'] = journal.step('compile-saved-file', lambda:legacy['build'](api, holder['handle'], persisted, reopened_items, target))
        built, built_items = native_snapshot(holder['handle'])
        delta = device_delta(persisted, built)
        baseline_delta = read['load_json'](os.path.join(root,'baseline-compile-evidence.json'))['deviceDelta']
        emit('compile-stage-comparison', dict(beforeTree=persisted, afterTree=built, baselineDeviceDelta=baseline_delta,
                                             savedDeviceDelta=delta, savedSha256=saved,
                                             sameAddedDeviceDescriptors=added_device_descriptors(baseline_delta)==added_device_descriptors(delta)))
        if delta['missing'] or delta['altered']:
            raise ProbeRejected('SAVED_COMPILE_CHANGED_EXISTING_DEVICES', dict(path='$.savedCompile.delta', actual=delta))
        journal.step('post-compile-actual-link', lambda:check_equal('POST_COMPILE_ATTACHMENT_CHANGED', initial_link,
                     attachment(next(n for n in built if n['guid']==new_guid), built_items, built), '$.postCompile.attachment'))
        journal.step('post-compile-task-st', lambda:check_equal('POST_COMPILE_TASK_OR_ST_CHANGED', latest_controls,
                     task_and_st(api, holder['handle'], built, built_items), '$.postCompile.controls'))

    def cleanup():
        if holder['dispatched'] and (journal.primaryFailure or journal.loggingErrors):
            return dict(retainedOpen=holder['handle'] is not None)
        return close_owned()

    before_files = read['scan_fixture'](api, directory)
    run_primary(system.execute_on_primary_thread, {'baseline':first_build,'plan':plan_uncompiled,'write':try_placement}[mode], cleanup, journal)
    if holder['closed'] and not journal.primaryFailure and not journal.cleanupError:
        try:
            journal.step('closed-disk-check', lambda:file_available(api, target, evidence.get('savedSha256', SEED)))
        except Exception:
            pass  # The journal has the failure. Do not authorize a subsequent pass.
    passed = holder['closed'] and not any((journal.primaryFailure,journal.cleanupError,journal.wrapperError,journal.loggingErrors))
    emit(mode+'-result', dict(status='succeeded' if passed else 'stopped', mode=mode, engine=engine, projectPath=target,
                             finalSha256=api['file_hash'](target), stages=journal.events, primaryFailure=journal.primaryFailure,
                             cleanupError=journal.cleanupError, wrapperError=journal.wrapperError, loggingErrors=journal.loggingErrors,
                             state={k:v for k,v in holder.items() if k!='handle'}, hasOpenHandle=holder['handle'] is not None,
                             beforeFiles=before_files, afterFiles=read['scan_fixture'](api, directory) if holder['closed'] else None,
                             evidence=evidence))
    if holder['closed']:
        system.exit()


if __name__ == '__main__':
    root = os.path.abspath(os.environ['INOPRO_S6B_PLACEMENT_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S6B_PLACEMENT_REPO'])
    mode = os.environ['INOPRO_S6B_PLACEMENT_MODE']
    if not re.match(r'^D:\\InoPro-S6b-DevicePlacement-[0-9-]+$', root, re.I) or mode not in ('baseline','plan','write'):
        raise ValueError('Dedicated attachment fixture required')
    if any(os.path.exists(os.path.join(root, name)) for name in ('insert-dispatched.json',mode+'-result.json')):
        raise ValueError('This stage was previously attempted; replay prohibited')
    api = load_fixed_helpers(repo, projects, system, device_repository)
    run_probe(root, mode, api)
