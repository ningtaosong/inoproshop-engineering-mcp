# -*- coding: utf-8 -*-
"""Read the active local device repository without opening a project."""

ENTRY_LIMIT = 10000
SOURCE_LIMIT = 64
FIELD_LIMIT = 256
IDENTITY_FIELDS = ('type', 'id', 'deviceDescriptionVersion')


def _native_field(obj, name, convert=unicode):
    try:
        value = getattr(obj, name)
        return convert(value) if value is not None else None
    except Exception:
        return None


def _text_field(obj, name):
    value = _native_field(obj, name)
    # Keep native text intact within the bound. Never truncate an identity.
    return value if value is not None and value.strip() and len(value) <= FIELD_LIMIT else None


def _device_fields(device):
    ident = _native_field(device, 'device_id', lambda value: value)
    info = _native_field(device, 'device_info', lambda value: value)
    return {
        'type': _text_field(ident, 'type'),
        'id': _text_field(ident, 'id'),
        'deviceDescriptionVersion': _text_field(ident, 'version'),
        'name': _text_field(info, 'name'),
        'vendor': _text_field(info, 'vendor')
    }


def _repository_entries(repository):
    entries, failures = [], []
    truncated, sources = False, 0
    try:
        for source in repository.sources:
            if sources == SOURCE_LIMIT:
                truncated = True
                break
            source_info = {'name': _text_field(source, 'name'),
                           'isInternal': _native_field(source, 'is_internal', bool)}
            try:
                for item in repository.get_all_devices(source=source):
                    if len(entries) == ENTRY_LIMIT:
                        truncated = True
                        break
                    row = _device_fields(item)
                    missing = [name for name in sorted(row) if row[name] is None]
                    missing += ['source.' + name for name in sorted(source_info) if source_info[name] is None]
                    row.update(source=source_info, unavailableFields=missing)
                    entries.append(row)
            except Exception:
                failures.append({'stage': 'source-devices', 'sourceIndex': sources})
            sources += 1
            if truncated:
                break
    except Exception:
        failures.append({'stage': 'repository-sources', 'sourceIndex': None})
    return entries, {'capturedSources': sources, 'truncated': truncated, 'enumerationFailures': failures}


def device_catalog_inventory(repository, detail=None):
    entries, scope = _repository_entries(repository)
    lookup = {'status': 'not-requested'}
    if detail:
        matches = [entry for entry in entries if all(entry[key] == detail[key] for key in IDENTITY_FIELDS)]
        if scope['truncated'] or scope['enumerationFailures'] or any(
                any(entry[key] is None for key in IDENTITY_FIELDS) for entry in entries):
            lookup = {'status': 'coverage-incomplete'}
        elif len(matches) != 1:
            lookup = {'status': 'ambiguous' if matches else 'not-found'}
        else:
            try:
                native = repository.create_device_identification(
                    int(detail['type']), detail['id'], detail['deviceDescriptionVersion'])
                found = repository.get_device(native)
                lookup = {'status': 'returned', 'fields': _device_fields(found)} if found is not None else {'status': 'lookup-unavailable'}
            except Exception:
                lookup = {'status': 'lookup-unavailable'}
    return {'entries': entries, 'scope': scope, 'detailLookup': lookup, 'projectOpened': False}
