# -*- coding: utf-8 -*-
"""Public native project export; narrow, fail-closed decoder for this AM610 fixture."""
from __future__ import unicode_literals

import hashlib
import os
import sys

try:
    text = unicode
except NameError:
    text = str


def require(test, message):
    if not test:
        raise ValueError(message)


class DotNetElement(object):
    """Use installed System.Xml on IronPython without depending on a native expat module."""
    def __init__(self, node):
        self.node = node
        self.tag = text(node.Name)

    def __iter__(self):
        return (DotNetElement(n) for n in self.node.ChildNodes if n.NodeType.ToString() == 'Element')

    def get(self, name):
        return text(self.node.GetAttribute(name)) if self.node.HasAttribute(name) else None

    @property
    def text(self):
        return text(self.node.InnerText)

    @property
    def attrib(self):
        return dict((text(a.Name), text(a.Value)) for a in self.node.Attributes)


def _root(path):
    if sys.platform == 'cli':
        import clr
        clr.AddReference('System.Xml')
        from System.Xml import XmlDocument, XmlReader, XmlReaderSettings, DtdProcessing
        settings = XmlReaderSettings()
        settings.XmlResolver = None
        settings.DtdProcessing = DtdProcessing.Prohibit
        reader = XmlReader.Create(path, settings)
        try:
            doc = XmlDocument()
            doc.XmlResolver = None
            doc.Load(reader)
            return DotNetElement(doc.DocumentElement)
        finally:
            reader.Close()
    from xml.etree import ElementTree
    return ElementTree.parse(path).getroot()


def named(node, field, tag):
    found = [e for e in node if e.get('Name') == field]
    require(len(found) == 1 and found[0].tag == tag, 'Missing, duplicate or malformed export field: '+field)
    return found[0]


def scalar(node, field, typ=None, allow_null=False):
    fields = [e for e in node if e.get('Name') == field]
    require(len(fields) == 1, 'Missing or duplicate export scalar: '+field)
    e = fields[0]
    if e.tag == 'Null' and allow_null:
        return None
    require(e.tag == 'Single' and not list(e), 'Invalid export scalar: '+field)
    require(typ is None or e.get('Type') == typ, 'Unexpected export type: '+field)
    return e.text or ''


def number(s):
    require(s and (s.isdigit() or (s[0] == '-' and s[1:].isdigit())), 'Invalid export integer')
    return int(s)


def raw_node(node):
    kids = list(node)
    return {'tag':node.tag, 'attrs':dict(node.attrib),
            'value':None if kids else node.text or '', 'children':[raw_node(child) for child in kids]}


def mapping_item(m):
    require(m.tag == 'Single', 'Unsupported mapping-list item')
    mode = scalar(m,'CreateVariable','bool')
    require(mode in ('True','False'), 'Unknown serialized CreateVariable value')
    return {'id':number(scalar(m,'Id','long')), 'variable':scalar(m,'Variable','string',True),
            'createVariable':mode=='True', 'xml':raw_node(m)}


def row_key(row):
    return (row['deviceGuid'], row['connectorId'], row['parameterId'], tuple(row['elementPath']))

def io_handling(owner):
    driver = named(owner, 'DriverInfo', 'Single')
    selected = scalar(driver, 'IoAppSet', 'bool')
    require(selected in ('True','False'), 'Unsupported IoAppSet value')
    return {'ioApplicationId':scalar(driver, 'IoApp', 'System.Guid').lower(),
            'ioApplicationSet':selected == 'True'}


def parse_export(path, expected_devices):
    """Read only owned DataElement/SubElements. BaseType templates do not add rows."""
    expected = set(text(g).lower() for g in expected_devices)
    require(expected, 'No selected devices')
    root = _root(path)
    require(root.tag == 'ExportFile', 'Unexpected export root')
    entry_lists = [x for v in root if v.tag == 'StructuredView' for s in v if s.tag == 'Single'
                   for x in s if x.tag == 'List2' and x.get('Name') == 'EntryList']
    require(len(entry_lists) == 1, 'Export must contain a single native EntryList')
    devices, captured, rows, keys = [], set(), [], set()

    def index_set(ps, guid, conn):
        params = named(ps, 'Params', 'List2')
        param_ids = set()
        for param in params:
            require(param.tag == 'Single', 'Unrecognized native parameter row')
            pid = number(scalar(param, 'Id'))
            require(pid not in param_ids, 'Duplicate parameter in parameter set')
            param_ids.add(pid)
            direction = scalar(param,'ChannelType')
            if direction == 'None':
                continue
            require(direction in ('Input','Output','OutputReadOnly'), 'Unknown ChannelType: '+direction)
            def element(node, relative):
                m = named(node,'IoMapping','Single')
                records = named(named(m,'Mappings','Single'),'Mappings','List2')
                row = {'deviceGuid':guid, 'connectorId':conn, 'parameterId':pid, 'elementPath':relative,
                       'identifier':scalar(node,'Identifier'), 'direction':direction,
                       'name':scalar(named(node,'VisibleName','Single'),'Default'),
                       'rawMappings':[mapping_item(e) for e in records]}
                key = row_key(row)
                require(key not in keys, 'Duplicate channel identity in export')
                keys.add(key)
                rows.append(row)
                children = named(named(node,'SubElements','Single'),'elements','List2')
                for child in children:
                    require(child.tag == 'Single', 'Unknown owned member in SubElements')
                    token = scalar(child,'Identifier')
                    require(token, 'Empty owned member identifier')
                    element(child, relative+[token])
            element(named(param,'DalaElement','Single'), [])

    for record in entry_lists[0]:
        require(record.tag == 'Single', 'Unsupported EntryList record')
        meta = named(record,'MetaObject','Single')
        guid = scalar(meta,'Guid').lower()
        obj = named(record,'Object','Single')
        if guid not in expected:
            require(not any(c.get('Name') in ('DeviceParameterSet','ConnectorList') for c in obj),
                    'Unexpected device owner in export')
            continue
        require(guid not in captured, 'Duplicate device export')
        captured.add(guid)
        dev = named(obj,'Id','Single')
        identity = dict((k,scalar(dev,k)) for k in ['Type','Id','Version'])
        device = io_handling(obj)
        device.update(guid=guid,name=scalar(meta,'Name'),deviceDescription=identity,connectorHandling=[])
        devices.append(device)
        index_set(named(obj,'DeviceParameterSet','Single'),guid,None)
        connectors = named(named(obj,'ConnectorList','Single'),'InnerList','List')
        connector_ids = set()
        for c in connectors:
            require(c.tag == 'Single', 'Unsupported connector record')
            cid = number(scalar(c,'ConnectorId'))
            require(cid not in connector_ids, 'Duplicate connector identity')
            connector_ids.add(cid)
            handling = io_handling(c)
            handling['connectorId'] = cid
            device['connectorHandling'].append(handling)
            require(not any(v.get('Name') == 'ParameterSet' for v in c), 'Additional unclassified parameter view')
            index_set(named(c,'HostParameterSet','Single'),guid,cid)
    require(captured == expected, 'Selected device missing from export')
    with open(path,'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    return {'complete':True, 'exportSha256':digest, 'devices':devices, 'rows':rows}


def export_index(project, device_items, absolute_new_path):
    """Export just the native selected devices, then validate and index the resulting file."""
    require(os.path.isabs(absolute_new_path) and not os.path.lexists(absolute_new_path),
            'Native export requires an unused absolute path')
    devices = list(device_items)
    ids = [text(d.guid).lower() for d in devices]
    require(devices and all(d.is_device for d in devices) and len(set(ids)) == len(ids),
            'Native device selection incomplete or duplicate')
    project.export_native(devices, absolute_new_path, False)
    return parse_export(absolute_new_path, ids)


def mapping_matches(record, expression):
    return record['variable'] == expression and record['createVariable'] is False
