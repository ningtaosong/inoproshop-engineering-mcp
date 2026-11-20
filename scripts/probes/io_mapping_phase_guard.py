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


def parent_children(tree, guid):
    node = unique((n for n in tree if n['guid']==guid), 'Derived GUID not unique')
    siblings = [n for n in tree if n['parentGuid']==node['parentGuid']]
    require([n['index'] for n in siblings]==list(range(len(siblings))), 'Native sibling indices inconsistent')
    return siblings


def saved_placement_tree(tree, guid):
    """Project the one archived B-to-C move on a copy; keep every node and subtree."""
    siblings = parent_children(tree,guid)
    require(len(siblings)==9 and siblings[8]['guid']==guid, 'Unexpected pre-save derived position')
    crossed = siblings[6:8]
    require([(n['name'],n['nativeType']) for n in crossed]==[
        ('Resources List','c3ac3f32-605b-4001-a449-9dbff0a9b9e1'),
        ('HardWare Configuration','ed103b54-add2-4aaa-8e19-1402c5a26800')],
        'Saved position would cross different siblings')
    projected = list(tree)
    leaf = projected.pop(projected.index(siblings[8]))
    for n in crossed:
        i = projected.index(n)
        projected[i] = dict(n,index=n['index']+1)
    projected.insert(tree.index(crossed[0]),dict(leaf,index=crossed[0]['index']))
    return projected


def transition(before, after, positive=False, setting=False, cross=False, shape='same'):
    for st, pos in ((before,positive and not setting),(after,positive)):
        validate_state(st,pos,mapping_matches)
        snap = st['snapshot']
        cov = snap['coverage']
        require(snap['scans'] and cov['totalInTraversedViews']==cov['observedMappableRows']==26,
                'Missing or inconsistent coverage totals')
    a,b = derived(before),derived(after)
    if shape=='appear':
        require(a is None and b is not None,'Expected exactly one compiled device to appear')
        require(parent_children(after['nativeTree'],b)[-1]['guid']==b, 'New compiled device is not the appended child')
    elif shape=='saved-placement':
        require(cross and not setting and a and a==b,'Saved placement requires the same identified device across reopen')
        parent_children(after['nativeTree'],b)
    elif shape=='disappear':
        require(a is not None and b is None,'Expected the compiled device to be absent on reopen')
    else:
        require(shape=='same' and a==b,'Derived device GUID or presence changed within a matched stage')
    left,right = (retained(before,a),retained(after,b)) if shape in ('appear','disappear') else (before,after)
    tree = saved_placement_tree(left['nativeTree'],a) if shape=='saved-placement' else left['nativeTree']
    change = tree_difference(tree, right['nativeTree'], cross_open=cross)
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


def reopen_shape(before,after):
    guid = derived(after)
    if guid is None:
        return 'disappear'
    pos = lambda st: unique((n['index'] for n in st['nativeTree'] if n['guid']==guid),'Saved device identity differs')
    return 'same' if pos(before)==pos(after) else 'saved-placement'


def control_pattern(a,b,c,d):
    transition(a,b,shape='appear')
    reopen = reopen_shape(b,c)
    transition(b,c,cross=True,shape=reopen)
    rebuild = 'appear' if reopen=='disappear' else 'same'
    transition(c,d,shape=rebuild)
    return dict(reopen=reopen,rebuild=rebuild,guids=[derived(st) for st in (a,b,c,d)])
