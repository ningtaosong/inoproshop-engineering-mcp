# -*- coding: utf-8 -*-
"""Write gate for the isolated native task-call replacement probe."""

POU_TYPE = '6f9dac99-8de1-4efc-8465-68ac443b7d08'
ST_TYPE = '3b83b776-fb25-43b8-99f2-3c507c9143fc'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def root_program(state, name):
    matches = [record for key, record in state['programs'].items()
               if key.lower() == name.lower()]
    require(len(matches) == 1, 'PROGRAM identity missing or ambiguous: ' + name)
    record = matches[0]
    path = record.get('path') or []
    require(record.get('objectId') and record.get('contentHash') and
            record.get('applicationId') == state['applicationId'] and
            path[:-1] == state['applicationPath'] and path and path[-1].lower() == name.lower(),
            'PROGRAM identity or scope incomplete: ' + name)
    require(record.get('nativeTypeId') == POU_TYPE and record.get('pouType') == 'program' and
            record.get('pouTypeSource') == 'native-pou-type-id-and-declaration-header' and
            ST_TYPE in (record.get('embeddedObjectTypes') or ()), 'Native ST PROGRAM unconfirmed: ' + name)
    return record


def matching_rows(rows, name):
    # Include qualified spellings for duplicate detection. The supported target
    # must itself have the unqualified spelling and a separately resolved ID.
    return [i for i, row in enumerate(rows) if row[0].rsplit('.', 1)[-1].lower() == name.lower()]


def replace_once(calls, baseline, live, old_name, new_name, read_row, mark):
    """Use only the validated native index; preserve the live comment verbatim."""
    require(baseline == live, 'Configuration, identity or source changed since baseline')
    require(live.get('projectPath') and live.get('applicationId') and live.get('applicationPath') and
            live.get('sourceSnapshot') and live.get('taskConfigurationVersion'), 'Incomplete project evidence')
    task = live['task']
    require(task.get('taskId') and task.get('callsComplete') is True and
            not task.get('unavailableFields'), 'Incomplete task evidence')
    require(old_name.lower() != new_name.lower(), 'Old and new PROGRAM names are identical')
    old = root_program(live, old_name)
    new = root_program(live, new_name)
    require(old['objectId'].lower() != new['objectId'].lower(), 'Old and new PROGRAM identities coincide')

    planned = [read_row(row) for row in baseline['task']['rawCalls']]
    indices = matching_rows(planned, old_name)
    require(len(indices) == 1, 'Old call missing or ambiguous')
    index = indices[0]
    require(planned[index][0].lower() == old_name.lower(), 'Old call is qualified or ambiguous')
    require(not matching_rows(planned, new_name), 'Replacement already present in task')
    bindings = task.get('resolvedCalls') or []
    require(len(bindings) == len(planned), 'Incomplete call bindings')
    binding = bindings[index]
    require(binding.get('order') == index and binding.get('raw') == planned[index] and
            binding.get('objectId') == old['objectId'] and binding.get('path') == old['path'] and
            binding.get('applicationId') == live['applicationId'], 'Old call binding changed')

    rows = [read_row(calls[i]) for i in range(len(calls))]
    require(rows == planned, 'Live call names, order or comments changed')
    require(callable(getattr(calls, 'replace', None)), 'Native replace method unavailable')
    mark(index, rows[index])
    return calls.replace(index, new['path'][-1], rows[index][1])
