# -*- coding: utf-8 -*-
"""Stage-specific decisions for the two independent S8b fixtures only."""
from __future__ import unicode_literals
import copy
import re
from device_add_preflight import tree_difference
from io_mapping_positive_guard import (require, raw, unique, index, rowkey, xmlkey,
    validate_state, change_only)
from io_mapping_export_guard import mapping_matches

NAME = 'HwConfiguratioinDevice'
DESC = {'type':'40005', 'id':'10F4 0005', 'deviceDescriptionVersion':'00.00.00.10'}
DEVICE_TYPE = '225bfe47-7336-4dbc-9419-4105a7c831fa'
PORTS = [(1,'Child','Common.PCI','PCI-Bus','-1'), (2,'Parent','Inovance:System','SystemConfig','1')]
ZERO = '00000000-0000-0000-0000-000000000000'


def derived(st):
    """Require three independent views of the one observed leaf and its parent."""
    tree, snap, exported = st['nativeTree'], st['snapshot'], st['export']
    ids = index(tree, lambda n: n['guid'])
    require(all('identityReadError' not in n and 'connectorReadError' not in n for n in tree),
            'Native tree has unreadable identities')
    root = unique((n for n in tree if n['path']==['Device'] and n['device'] and n['parentGuid'] is None),
                  'Root device missing or ambiguous')
    devs = index(snap['devices'], lambda n: raw(n,'guid'))
    xml_devs = index(exported['devices'], lambda n:n['guid'])
    require(set(devs)==set(n['guid'] for n in tree if n['device'])==set(xml_devs),
            'Device identity coverage differs across tree, getter and export')
    for guid, dev in devs.items():
        node = ids[guid]
        ident = node['identity']
        require(dev['path']==node['path'] and raw(dev,'name')==node['name']==xml_devs[guid]['name']
                and (str(raw(dev['identification'],'type')),raw(dev['identification'],'id'),raw(dev['identification'],'version'))
                ==(ident['type'],ident['id'],ident['deviceDescriptionVersion']), 'Device identity/path disagrees')
    require(len(snap['channels'])==len(exported['rows'])==26,'Fixture channel count differs')
    nodes = [n for n in tree if n['name']==NAME or n.get('identity')==DESC]
    if not nodes:
        return None
    n = unique(nodes, 'Ambiguous compiled device')
    guid = n['guid']
    require(re.match(r'\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z',guid) and guid!=ZERO
            and n['name']==NAME and n['identity']==DESC and n['nativeType']==DEVICE_TYPE
            and n['path']==root['path']+[NAME] and n['parentGuid']==root['guid'] and n['device'] and not n['explicit']
            and not any(child['parentGuid']==guid for child in tree), 'Compiled device identity, parent or leaf differs')
    siblings = [v for v in tree if v['parentGuid']==root['guid']]
    require(siblings[-1]==n and n['index']==len(siblings)-1,'Compiled device is not the appended child')
    ports = [v for v in snap['connectors'] if v['enumeratedFromDeviceGuid']==guid]
    require(len(ports)==2, 'Compiled device connector count differs')
    for port,(cid,role,iface,name,host) in zip(ports,PORTS):
        expected = dict(connector_id=cid, connector_role=role, interface=iface, interface_name=name,
                        host_path=host, ownerGuid=guid)
        require(port['path']==n['path']+['connectors',cid] and
                port['fields']==dict((k,{'state':'value','value':v}) for k,v in expected.items()),
                'Compiled device connector identity, owner or metadata differs')
    handling = dict(ioApplicationSet=False,ioApplicationId=ZERO)
    dev = xml_devs[guid]
    require(dev==dict(handling,guid=guid,name=NAME,deviceDescription={'Type':DESC['type'],'Id':DESC['id'],'Version':DESC['deviceDescriptionVersion']},
                      connectorHandling=[dict(handling,connectorId=i) for i in (1,2)]),
            'Compiled device export handling differs')
    return guid


def retained(st, guid):
    # Only consume the already verified leaf in a transition where it appears/disappears.
    row = copy.deepcopy(st)
    if guid:
        row['nativeTree'] = [n for n in row['nativeTree'] if n['guid']!=guid]
        snap = row['snapshot']
        snap['devices'] = [d for d in snap['devices'] if raw(d,'guid')!=guid]
        snap['connectors'] = [c for c in snap['connectors'] if c['enumeratedFromDeviceGuid']!=guid]
        row['export']['devices'] = [d for d in row['export']['devices'] if d['guid']!=guid]
    return row


def transition(before, after, positive=False, setting=False, cross=False, shape='same'):
    for st, pos in ((before,positive and not setting),(after,positive)):
        validate_state(st,pos,mapping_matches)
    a,b = derived(before),derived(after)
    if shape=='appear':
        require(a is None and b is not None,'Expected exactly one compiled device to appear')
    elif shape=='disappear':
        require(a is not None and b is None,'Expected the compiled device to be absent on reopen')
    else:
        require(shape=='same' and a==b,'Derived device GUID or presence changed within a matched stage')
    left,right = (retained(before,a),retained(after,b)) if shape!='same' else (before,after)
    change = tree_difference(left['nativeTree'], right['nativeTree'], cross_open=cross)
    require(change is None, 'Non-authorized native tree difference: '+str(change))
    for field in ('sourceSnapshot','sources','tasks','applications','applicationId','declaration'):
        require(left[field]==right[field], 'Changed '+field)
    for field in ('devices','connectors'):
        require(left['snapshot'][field]==right['snapshot'][field], 'Changed existing '+field+' or order')
    require(left['export']['devices']==right['export']['devices'], 'Changed existing exported device handling')
    if setting:
        change_only(left,right,mapping_matches,cross)
    else:
        for section, key in (('snapshot','channels'),('export','rows')):
            require(left[section][key]==right[section][key], 'Changed '+key+' across stages')


def control_pattern(a,b,c,d):
    transition(a,b,shape='appear')
    reopen = 'disappear' if derived(c) is None else 'same'
    transition(b,c,cross=True,shape=reopen)
    rebuild = 'appear' if reopen=='disappear' else 'same'
    transition(c,d,shape=rebuild)
    return dict(reopen=reopen,rebuild=rebuild,guids=[derived(st) for st in (a,b,c,d)])
