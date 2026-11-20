# -*- coding: utf-8 -*-
"""Offline AM610 channel evidence. Public getter and export paths verified in probe 4307d8d."""
from __future__ import unicode_literals
import os
from io_channels import as_text, channels_for, value, int_types
from io_export import export_index, row_key

ROOT = (4102, '10f4 0002', '3.5.11.11')
MODULE = (40600, '10F4 0600', '00.00.00.20')


def device_record(obj, path):
    ident = obj.get_device_identification()
    return dict(guid=as_text(obj.guid).lower(), path=path, type=ident.type,
                id=ident.id, deviceDescriptionVersion=ident.version)


def matches(record, model):
    return (record['type'], record['id'], record['deviceDescriptionVersion']) == model


def scalar(field):
    if field is None:
        return {'state':'missing'}
    if field['state']=='error':
        return field
    v=field['value']
    if isinstance(v,int_types) and abs(v)>9007199254740991:
        return {'state':'value','decimal':as_text(v),'nativeType':field.get('nativeType','integer')}
    return v


def reported_fields(group, names):
    return dict((name,scalar(group.get(name))) for name in names)


def combine(snapshot, exported, problem, device, connector):
    """Join on native identity. A null count explicitly withholds any list/absence conclusion."""
    xml_rows = {} if exported is None else dict((row_key(r),r) for r in exported['rows'])
    rows, keys, gaps = [], set(), []
    field_gaps=0
    complete=snapshot['coverage']['enumerationComplete'] and not snapshot['coverage']['truncated']
    if not complete:
        gaps.append('incomplete-channel-enumeration')
    if problem:
        gaps.append(problem)
    for ch in snapshot['channels']:
        p,m,e=ch['parameter'],ch.get('mapping') or {},ch['element']
        key=(ch['deviceGuid'],ch['connectorId'],value(p['id']),tuple(ch['elementIdentifiers']))
        unique=(ch['identityStatus']=='unique-in-view' and key[0]==device['guid'] and
                value(p['ownerGuid'])==key[0] and key[1]==2 and key not in keys)
        keys.add(key)
        x=xml_rows.get(key)
        items=None if x is None else x['rawMappings']
        fields=reported_fields(m,('Id','variable','default_variable','maps_to_existing_variable',
                                  'mapping_creates_variable','automatic_iec_address','manual_iec_address'))
        consistent=False
        if complete and unique and items is not None and x['identifier']==value(ch['identifier']) and x['direction']==value(p['channel_type']):
            if items:
                first=items[0]
                consistent=(ch['mappingState'] in ('mapping-text-read','empty-expression') and
                            first['variable']==fields['variable'] and first['id']==value(m.get('Id')) and
                            first['createVariable'] is fields['mapping_creates_variable'] and
                            fields['maps_to_existing_variable'] is (not first['createVariable']) and
                            first['defaultVariable']==fields['default_variable'])
            else:
                consistent=(ch['mappingState']=='no-first-mapping-native-sentinel' and
                            m.get('default_variable',{}).get('state')=='null')
        if not unique or not consistent:
            gaps.append('channel-identity-or-export-incomplete')
        parameter=reported_fields(p,('name','type_string','iec_type','param_type','channel_type'))
        element=reported_fields(e,('visible_name','base_type','bit_size','unit'))
        field_gaps+=sum(isinstance(v,dict) and v.get('state') in ('error','missing')
                        for group in (parameter,element,fields) for v in group.values())
        pid=key[2]
        if isinstance(pid,int_types) and abs(pid)>9007199254740991:
            pid=as_text(pid)
        rows.append(dict(channelKey=dict(deviceGuid=key[0],connectorId=key[1],parameterId=pid,memberPath=list(key[3])),
            identityStatus=ch['identityStatus'] if unique else 'unconfirmed',parameter=parameter,
            identifier=scalar(ch['identifier']),element=element,
            getter=fields,getterState=ch['mappingState'],getterError=ch.get('mappingError'),
            exportState='verified' if consistent else ('unavailable' if x is None else 'inconsistent'),
            mappingCount=len(items) if consistent else None,
            exportedMappings=None if items is None else [dict(i,id=scalar({'state':'value','value':i['id']})) for i in items]))
    if exported is not None and (set(xml_rows)!=keys or len(xml_rows)!=len(exported['rows'])):
        gaps.append('getter-export-key-coverage-differs')
    return dict(device=device,connector=connector,channels=rows,
        coverage=dict(enumerationComplete=complete,observed=len(rows),truncated=snapshot['coverage']['truncated'],
                      missingOrFailedFieldCount=field_gaps,enumerationErrors=snapshot['issues'],mappingListsComplete=not gaps,
                      gaps=sorted(set(gaps)),exportSha256=exported and exported['exportSha256'],
                      getterSource='IScriptIoMapping first entry',listSource='same-handle native export',
                      directionReference='unverified',finalAutomaticAddress='not-read',declarationBinding='not-available',
                      runtime='not-read',scope='selected connector.host_parameters and owned mappable members'))


def inventory(project,args,directory,version,success,failure):
    if version!='1.9.1.6':
        return failure('unsupported','IO_IDE_VERSION',u'仅验证 InoProShop 1.9.1.6')
    candidates=[]
    for parent in project.get_children(False):
        if not parent.is_device:
            continue
        root=device_record(parent,[as_text(parent.get_name())])
        if not matches(root,ROOT):
            continue
        for module in parent.get_children(False):
            if not module.is_device:
                continue
            dev=device_record(module,root['path']+[as_text(module.get_name())])
            if matches(dev,MODULE) and (not args.get('deviceId') or dev['guid']==args['deviceId'].lower()):
                candidates.append((module,dev,root))
    if len(candidates)!=1:
        return failure('unsupported','IO_DEVICE_SCOPE',u'已验根设备下的目标设备缺失或不唯一',{'candidates':[d for _,d,_ in candidates]})
    module,dev,root=candidates[0]
    ports=[c for c in module.connectors if c.connector_id==2]
    if len(ports)!=1 or ports[0].interface!='Common.inovance2' or as_text(ports[0].get_device_object().guid).lower()!=dev['guid']:
        return failure('unsupported','IO_CONNECTOR_SCOPE',u'目标连接器身份、归属或接口不符')
    port=ports[0]
    con=dict(id=port.connector_id,interface=port.interface,ownerGuid=dev['guid'],path=dev['path']+['connectors',2])
    snap=channels_for(port,dev['guid'],dev['path'])
    xml,problem=None,None
    try:
        xml=export_index(project,[module],os.path.join(directory,'io-device.export'))
        d=xml['devices'][0]
        if (d['guid']!=dev['guid'] or d['deviceDescription']!={'Type':as_text(dev['type']),'Id':dev['id'],'Version':dev['deviceDescriptionVersion']} or
                d['name']!=dev['path'][-1] or len(d['connectorHandling'])!=1 or d['connectorHandling'][0]['connectorId']!=2):
            raise ValueError('Export owner, description or connector differs')
    except Exception as exc:
        xml,problem=None,'native-export: '+as_text(exc)
    data=combine(snap,xml,problem,dev,con)
    data.update(rootDevice=root,projectId=args['projectId'],projectPath=as_text(project.path))
    return success(u'已读取限定连接器的离线通道与映射证据',data)
