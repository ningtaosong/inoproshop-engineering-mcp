# -*- coding: utf-8 -*-
"""Independent probe guards; no native writes, no product imports or registration."""
import copy
import re
import os

try:
    TEXT_TYPES = (basestring,)
except NameError:
    TEXT_TYPES = (str,)


def require(value, message):
    if not value:
        raise ValueError(message)


def difference(a, b, path='$'):
    if type(a) is not type(b) and not (isinstance(a, TEXT_TYPES) and isinstance(b, TEXT_TYPES)):
        return dict(path=path, before=a, after=b, reason='type')
    if isinstance(a, dict):
        if set(a) != set(b):
            return dict(path=path, before=sorted(a), after=sorted(b), reason='keys')
        for key in sorted(a):
            found = difference(a[key], b[key], path + '.' + key)
            if found: return found
    elif isinstance(a, list):
        if len(a) != len(b):
            return dict(path=path, before=len(a), after=len(b), reason='length')
        for index, (old, new) in enumerate(zip(a, b)):
            found = difference(old, new, path + '[' + str(index) + ']')
            if found: return found
    elif a != b:
        return dict(path=path, before=a, after=b, reason='value')
    return None


def equal(a, b, label):
    found = difference(a, b)
    require(found is None, label + ': ' + repr(found))


def target(state, plan):
    inv = state['library'];scope = inv['scope']
    require(scope['enumerationComplete'] is True and scope['fieldReadComplete'] is True and
            scope['truncated'] is False and scope['enumerationFailures'] == [], 'Incomplete library coverage')
    refs = inv['references']
    require(scope['capturedReferences'] == len(refs), 'Reference count mismatch')
    require(len(inv['managers']) == 1 and inv['managers'][0]['managerId'] == plan['managerId'], 'Manager identity mismatch')
    require(inv['applicationId'] == plan['applicationId'] and state['projectPath'] == plan['projectPath'], 'Application/project mismatch')
    ids = []
    names = []
    for row in refs:
        f = row['rawFields'];identity = f['id']
        require(isinstance(identity, type(u'')) and re.match(r'^[0-9]+\Z', identity), 'Invalid native reference ID')
        require(row['managerId'] == plan['managerId'] and row['unavailableFields'] == [], 'Reference coverage/owner mismatch')
        ids.append(identity)
        if f['is_placeholder'] is True:
            names.append(f['placeholder_name'].lower())
    require(len(ids) == len(set(ids)) and len(names) == len(set(names)), 'Duplicate reference ID or placeholder name')
    found = [r for r in refs if r['rawFields']['id'] == plan['referenceId']]
    require(len(found) == 1, 'Target not unique')
    row = found[0];f = row['rawFields']
    require(f['is_placeholder'] is True and f['is_managed'] is False and f['system_library'] is False,
            'Target is not an ordinary non-system placeholder')
    require(f['placeholder_name'] == plan['placeholderName'] and f['namespace'] == plan['namespace'], 'Target name/namespace mismatch')
    require(f['default_resolution'] == plan['defaultResolution'], 'Default declaration changed')
    require(state['targetRedirection']['available'] is True, 'Native override getter unavailable')
    equal(state['targetRedirection']['value'], f['explicit_redirection'], 'Getter differs from inventory')
    return row


def preflight(before, live, plan, disk_hash):
    require(plan['preparedByThisProbe'] is True and plan['baselineSavedReopened'] is True, 'No fixture ownership/baseline evidence')
    require(plan['normalSavedReopened'] is True, 'No persisted unredirected resolution baseline')
    normal_resolution(plan['normalBaseline'], plan)
    require(disk_hash == plan['diskHash'], 'Disk version changed')
    row = target(live, plan)
    f = row['rawFields']
    require(isinstance(f['explicit_redirection'], type(u'')) and len(f['explicit_redirection']) > 0,
            'Explicit override absent; this is not a successful clear')
    require(f['explicit_redirection'] == plan['explicitResolution'] and f['is_redirected'] is True,
            'Explicit override changed or not reported redirected')
    equal(before, live, 'Same-handle prewrite evidence changed')


def after_clear_immediate(before, after, plan):
    old = target(before, plan);new = target(after, plan)
    nf = new['rawFields']
    require(nf['explicit_redirection'] is None and nf['is_redirected'] is False, 'Explicit override was not cleared to native null')
    require(after['targetRedirection']['value'] is None and after['targetRedirection']['nativeType'] == 'null', 'Override null evidence missing')
    require(nf['resolver_guid'] == NORMAL_RESOLVER, 'Immediate resolver identity changed')
    for key in ('effective_resolution','resolution_info'):
        require(nf[key] is None or isinstance(nf[key], TEXT_TYPES), 'Immediate resolution field type invalid: '+key)
    expected = copy.deepcopy(before)
    er = next(r for r in expected['library']['references'] if r['rawFields']['id'] == plan['referenceId'])
    # Resolution provenance is observed, not guessed. Only the selected reference
    # may change these fields; its default/identity/namespace stay strict.
    for key in ('explicit_redirection', 'is_redirected', 'effective_resolution', 'resolution_info', 'resolver_guid'):
        er['rawFields'][key] = nf[key]
    er['resolutionStatus'] = 'effective-resolution-reported' if nf['effective_resolution'] else 'unknown'
    expected['targetRedirection'] = copy.deepcopy(after['targetRedirection'])
    for key in ('configurationVersion', 'placeholderConfigurationVersion'):
        expected['library'][key] = after['library'][key]
    equal(expected, after, 'Clear changed an unauthorized field')


def after_clear(before, after, plan):
    after_clear_immediate(before, after, plan)
    require(plan['normalSavedReopened'] is True, 'Normal baseline not saved/reopened')
    normal_resolution(after, plan)
    normal_resolution(plan['normalBaseline'], plan)
    # Restore a measured normal state, not a guessed fallback from default_resolution.
    equal(plan['normalBaseline'], after, 'Clear did not restore the complete measured normal baseline')


NORMAL_RESOLVER = 'b303f5ce-75ff-4668-a777-7da8debb449c'


def normal_resolution(state, plan):
    f = target(state, plan)['rawFields']
    require(f['explicit_redirection'] is None and f['is_redirected'] is False and
            state['targetRedirection']['nativeType'] == 'null', 'Normal baseline has an override or missing null evidence')
    require(isinstance(f['effective_resolution'], TEXT_TYPES) and
            f['effective_resolution'] == plan['normalInstalled']['displayName'], 'Normal resolution is null/unknown/not the exact installed library')
    require(target(state, plan)['resolutionStatus'] == 'effective-resolution-reported', 'Normal resolution status inconsistent')
    require(isinstance(f['resolution_info'], TEXT_TYPES) and f['resolution_info'].strip() not in ('', 'None') and
            f['resolver_guid'] == NORMAL_RESOLVER, 'Native normal resolution source evidence missing/unknown')
    # Raw resolution_info is evidence, not a claim that a particular provider ran.
    if 'normalBaseline' in plan:
        old = target(plan['normalBaseline'], plan)['rawFields']
        for key in ('effective_resolution', 'resolution_info', 'resolver_guid'):
            equal(old[key], f[key], 'Normal resolution provenance changed: '+key)


def created_normal(before, after, plan, api):
    checked_inventory(before, api); checked_inventory(after, api)
    normal_resolution(after, plan)
    old = before['library']['references']; new = after['library']['references']
    require(len(new) == len(old)+1, 'Creation did not add exactly one reference')
    require(not any((r['rawFields']['is_placeholder'] is True and r['rawFields']['placeholder_name'].lower() == plan['placeholderName'].lower()) or
                    r['rawFields']['namespace'].lower() == plan['namespace'].lower() for r in old), 'Name/namespace already present')
    require(new[-1]['rawFields']['id'] == plan['referenceId'], 'Created identity not at observed added row')
    expected = copy.deepcopy(before)
    expected['library']['references'].append(copy.deepcopy(new[-1]))
    expected['library']['scope']['capturedReferences'] += 1
    expected['library']['managers'][0]['capturedReferences'] += 1
    for key in ('configurationVersion', 'placeholderConfigurationVersion'):
        expected['library'][key] = after['library'][key]
    expected['targetRedirection'] = copy.deepcopy(after['targetRedirection'])
    equal(expected, after, 'Creation/load changed pre-existing state')


def after_override(before, after, plan):
    require(plan['normalSavedReopened'] is True, 'Override requires saved/reopened normal baseline')
    normal_resolution(before, plan)
    equal(plan['normalBaseline'], before, 'Normal baseline changed before override')
    f = target(after, plan)['rawFields']
    require(f['explicit_redirection'] == plan['explicitResolution'] and f['is_redirected'] is True and
            f['effective_resolution'] == plan['explicitResolution'], 'Prepared override not confirmed')
    expected = copy.deepcopy(before)
    row = next(r for r in expected['library']['references'] if r['rawFields']['id'] == plan['referenceId'])
    for key in ('explicit_redirection', 'is_redirected', 'effective_resolution', 'resolution_info', 'resolver_guid'):
        row['rawFields'][key] = f[key]
    expected['targetRedirection'] = copy.deepcopy(after['targetRedirection'])
    for key in ('configurationVersion', 'placeholderConfigurationVersion'):
        expected['library'][key] = after['library'][key]
    equal(expected, after, 'Override changed unauthorized state')


def clear_once(reference, before, live, plan, disk_hash, mark):
    preflight(before, live, plan, disk_hash)
    mark()
    # Installed ScriptEngine help explicitly authorizes None to delete a
    # redirection. The local wrapper forwards null to Remove(name), then Commit.
    return reference.set_redirection(None)


# Observed in 120000 baseline compile, NOT a general compiler/library exemption.
# Native reference IDs remain live, unique identities; these are exact definitions.
STABILIZATION_SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
SYSTEM_ADDITIONS = (
    ('SM3_Basic', 'SM3_Basic', '4.2.2.0'),
    ('SM3_CNC', 'SM3_CNC', '4.2.1.1'),
    ('SM3_Robotics', 'SM3_Robotics', '4.2.2.0'),
    ('SM3_Robotics_Visu', 'SM3_Robotics_Visu', '4.2.0.0'),
    ('SM3_Transformation', 'TRAFO', '4.2.1.0'),
    ('IecVarAccess', 'IecVarAccessLibrary', '3.3.1.20'))
PHASES = ('stabilize', 'stable', 'declare', 'normal', 'prepare', 'baseline', 'clear', 'verify')
PHASE_COUNTS = ((1, 0, 0, 1), (0, 0, 0, 1), (1, 1, 0, 1), (0, 0, 0, 1), (1, 1, 0, 0),
                (0, 0, 0, 1), (1, 0, 1, 1), (0, 0, 0, 1))
PHASE_STATES = ('after-save', 'stable-build-readback', 'after-save', 'normal-build-readback', 'after-save', 'initial', 'after-save')
PHASE_LOADS = (0, 0, 1, 0, 0, 0, 1, 0)
FINGERPRINT_KEYS = ('sha256', 'guardSha256', 'bridgeSha256', 'libraryHelperSha256',
                    'recorderSha256', 'loaderSha256', 'observerSha256',
                    'launcherSha256', 'phaseContractSha256', 'executableSha256')


def checked_inventory(state, api):
    inv = state['library']
    require(api['complete_placeholder_inventory'](inv), 'Library inventory incomplete')
    require(inv['applicationId'] == state['applicationId'] and
            inv['applicationPath'] == state['applicationPath'] and
            inv['projectPath'] == state['projectPath'], 'Inventory ownership differs')
    require(len(inv['managers']) == 1, 'Expected one complete manager')
    m = inv['managers'][0]
    require(m['managerId'] == state['managerId'] and m['path'] == state['managerPath'] and
            m['capturedReferences'] == len(inv['references']) and
            m['enumerationComplete'] is True and m['unavailableFields'] == [], 'Manager coverage differs')
    require(inv['scope']['capturedReferences'] == len(inv['references']), 'Count differs')
    ids, names = [], []
    for index, row in enumerate(inv['references']):
        identity = row['rawFields']['id']
        require(isinstance(identity, TEXT_TYPES) and re.match(r'^[1-9][0-9]*\Z', identity), 'Invalid reference identity')
        require(type(row['index']) is int and type(row['order']) is int and
                row['index'] == index and row['order'] == index and row['parentIndex'] is None,
                'Reference indices/order incomplete')
        equal(row['managerPath'], state['managerPath'], 'Reference manager path changed')
        equal(row['path'], state['managerPath'] + ['references', str(index)], 'Reference path changed')
        require(row['managerId'] == state['managerId'] and row['unavailableFields'] == [], 'Reference owner/coverage differs')
        ids.append(identity)
        if row['rawFields']['is_placeholder'] is True:
            names.append(row['rawFields']['placeholder_name'].lower())
    require(len(ids) == len(set(ids)) and len(names) == len(set(names)), 'Duplicate reference identity/name')
    for key, fn in (('configurationVersion', 'library_configuration_version'),
                    ('placeholderConfigurationVersion', 'placeholder_configuration_version')):
        equal(inv[key], api[fn](inv), 'Inventory version not reproducible: ' + key)


def stabilization_row(state, index, identity, definition):
    name, namespace, version = definition
    iec = name == 'IecVarAccess'
    default = name + ', ' + version + (' (System)' if iec else ' (3S - Smart Software Solutions GmbH)')
    fields = dict(id=identity, name='#'+name, namespace=namespace, is_placeholder=True,
                  is_managed=False, system_library=True, optional=False, qualified_only=False,
                  placeholder_name=name, default_resolution=default,
                  effective_resolution='IecVarAccess, 3.5.11.0 (System)' if iec else default,
                  resolution_info=u'库配置文件解析' if iec else u'由SoftMotion配置文件4.2.2.0解决',
                  resolver_guid='b303f5ce-75ff-4668-a777-7da8debb449c',
                  is_redirected=False, explicit_redirection=None)
    return dict(managerId=state['managerId'], managerPath=copy.deepcopy(state['managerPath']),
                path=state['managerPath']+['references', str(index)], index=index, order=index,
                parentIndex=None, rawFields=fields, unavailableFields=[], installedStatus='not-queried',
                resolutionStatus='effective-resolution-reported',
                resolutionBasis='Native effective_resolution string only; not an independent loaded/missing flag')


def stabilize_transition(before, after, context, api):
    require(context['mode'] == 'stabilize' and context['seedSha256'] == STABILIZATION_SEED and
            context['expectedDisk'] == STABILIZATION_SEED and context['nativeVersion'] == '1.9.1.6',
            'First compile exception requires exact neutral seed and stage')
    device = before['device']
    require([device['type'], device['descriptionId'], device['version']] == [4102, '10f4 0002', '3.5.11.11'], 'Unsupported stabilization device')
    checked_inventory(before, api); checked_inventory(after, api)
    absent = dict(available=False, value=None, nativeType='null')
    equal(before['targetRedirection'], absent, 'Target must not exist before stabilization')
    equal(after['targetRedirection'], absent, 'Target must not exist after stabilization')
    names = [r['rawFields']['placeholder_name'].lower() for r in before['library']['references']
             if r['rawFields']['is_placeholder'] is True]
    require('clearprobeowned' not in names and 'caa mathematics' not in names and not set(names).intersection(d[0].lower() for d in SYSTEM_ADDITIONS),
            'Target/system additions already present before first compile')
    expected = copy.deepcopy(before)
    old_count = len(before['library']['references'])
    require(len(after['library']['references']) == old_count + len(SYSTEM_ADDITIONS), 'Not the exact six additions')
    for offset, definition in enumerate(SYSTEM_ADDITIONS):
        index = old_count + offset
        identity = after['library']['references'][index]['rawFields']['id']
        expected['library']['references'].append(stabilization_row(before, index, identity, definition))
    expected['library']['scope']['capturedReferences'] += len(SYSTEM_ADDITIONS)
    expected['library']['managers'][0]['capturedReferences'] += len(SYSTEM_ADDITIONS)
    expected['library']['configurationVersion'] = api['library_configuration_version'](expected['library'])
    expected['library']['placeholderConfigurationVersion'] = api['placeholder_configuration_version'](expected['library'])
    equal(expected, after, 'First compile changed more than the exact system additions')


def stable_state(before, after, api):
    checked_inventory(before, api); checked_inventory(after, api)
    equal(before, after, 'Stabilized state differs; no post-stabilize library exception')


def stage_preflight(intent, mode, root, load, sha):
    """No project action. Bind predecessor success, close, observed exit and code bytes."""
    require(mode in PHASES and intent['mode'] == mode, 'Wrong stage')
    require(intent['seedSha256'] == STABILIZATION_SEED and intent['nativeVersion'] == '1.9.1.6', 'Wrong seed/runtime')
    for key in FINGERPRINT_KEYS:
        require(isinstance(intent[key], TEXT_TYPES) and re.match(r'^[0-9a-f]{64}\Z', intent[key]), 'Missing stage code fingerprint: '+key)
    index = PHASES.index(mode)
    link = intent['previousStage']
    if index == 0:
        require(link is None and intent['expectedDisk'] == STABILIZATION_SEED, 'First stage requires pristine seed')
        return None
    previous = PHASES[index-1]
    require(link['mode'] == previous, 'Stage skipped or reordered')
    values = {}
    for key, suffix in (('intent', 'intent'), ('result', 'result'), ('observation', 'observation-complete'),
                        ('state', PHASE_STATES[index-1])):
        filename = os.path.join(root, previous+'-'+suffix+'.json')
        equal(sha(filename), link[key+'Sha256'], 'Prior stage evidence changed: '+key)
        values[key] = load(filename)
    prior, result, observation = values['intent'], values['result'], values['observation']
    for key in FINGERPRINT_KEYS + ('operationId', 'project', 'seedSha256', 'nativeVersion'):
        equal(intent[key], prior[key], 'Different stage provenance: '+key)
    require(prior['mode'] == previous and result['mode'] == previous and result['status'] == 'succeeded' and
            result['closed'] is True and result['operationId'] == intent['operationId'] and
            result['projectPath'] == intent['project'] and result['diskBefore'] == prior['expectedDisk'] and
            result['diskAfterClose'] == intent['expectedDisk'], 'Predecessor is not a successful closed version')
    counts = PHASE_COUNTS[index-1]
    for key, value in zip(('saveCount','fixtureMutationCount','clearDispatchCount','compileCount'), counts):
        equal(result[key], value, 'Predecessor dispatch count differs: '+key)
    equal(result['compileCompletedCount'], counts[3], 'Predecessor compile incomplete')
    equal(result['publicLoadCount'], PHASE_LOADS[index-1], 'Predecessor public load count differs')
    if previous in ('declare','normal','prepare','baseline'):
        equal(sha(os.path.join(root,previous+'-plan.json')),result['planSha256'],'Predecessor plan version changed')
    require(observation['status'] == 'succeeded' and observation['timedOut'] is False and
            observation['identityMatches'] is True and observation['normalExit'] is True and
            observation['primaryException'] is None and observation['loggerErrors'] == [] and
            observation['exit']['code'] == 0 and observation['exit']['signal'] is None, 'Predecessor exit unconfirmed')
    binding = dict(operationId=intent['operationId'], launchId=prior['launchId'], scriptSha256=prior['sha256'])
    equal(observation['binding'], binding, 'Predecessor observer binding differs')
    trace = result['traceBinding'];birth = observation['birth']
    require(birth['state'] == 'running' and result['engine']['pid'] == trace['pid'] == birth['identity']['pid'] and
            result['engine']['creationUtcTicks'] == trace['creationUtcTicks'] == birth['identity']['startId'], 'Predecessor process identity differs')
    for key, value in binding.items(): equal(trace[key], value, 'Predecessor result binding differs: '+key)
    require(observation['result']['exists'] is True and observation['result']['sha256'] == link['resultSha256'], 'Predecessor receipt differs')
    equal(observation['result']['value'], result, 'Predecessor published result differs')
    return values['state']
