"""Independent probe guards; no native writes, no product imports or registration."""
import copy
import re

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
    require(disk_hash == plan['diskHash'], 'Disk version changed')
    row = target(live, plan)
    f = row['rawFields']
    require(isinstance(f['explicit_redirection'], type(u'')) and len(f['explicit_redirection']) > 0,
            'Explicit override absent; this is not a successful clear')
    require(f['explicit_redirection'] == plan['explicitResolution'] and f['is_redirected'] is True,
            'Explicit override changed or not reported redirected')
    equal(before, live, 'Same-handle prewrite evidence changed')


def after_clear(before, after, plan):
    old = target(before, plan);new = target(after, plan)
    nf = new['rawFields']
    require(nf['explicit_redirection'] is None and nf['is_redirected'] is False, 'Explicit override was not cleared to native null')
    require(after['targetRedirection']['value'] is None and after['targetRedirection']['nativeType'] == 'null', 'Override null evidence missing')
    require(nf['effective_resolution'] == plan['defaultResolution'], 'Effective resolution did not fall back to the exact default')
    expected = copy.deepcopy(before)
    er = next(r for r in expected['library']['references'] if r['rawFields']['id'] == plan['referenceId'])
    # Resolution provenance is observed, not guessed. Only the selected reference
    # may change these fields; its default/identity/namespace stay strict.
    for key in ('explicit_redirection', 'is_redirected', 'effective_resolution', 'resolution_info', 'resolver_guid'):
        er['rawFields'][key] = nf[key]
    expected['targetRedirection'] = copy.deepcopy(after['targetRedirection'])
    for key in ('configurationVersion', 'placeholderConfigurationVersion'):
        expected['library'][key] = after['library'][key]
    equal(expected, after, 'Clear changed an unauthorized field')


def clear_once(reference, before, live, plan, disk_hash, mark):
    preflight(before, live, plan, disk_hash)
    mark()
    # Installed ScriptEngine help explicitly authorizes None to delete a
    # redirection. The local wrapper forwards null to Remove(name), then Commit.
    return reference.set_redirection(None)
