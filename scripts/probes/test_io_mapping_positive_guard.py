# -*- coding: utf-8 -*-
"""Independent synthetic source/export evidence. No OEM or project calls are made."""
import copy
import unittest
from xml.etree import ElementTree
from io_mapping_read import mapping_state, val
from io_mapping_positive_guard import DECL, EXPRESSION, change_only, validate_state, invariant
from io_mapping_export_guard import mapping_item, mapping_matches


def field(value):
    return {'state':'null' if value is None else 'value', 'value':value}


def row(name):
    mapping = {k:field(v) for k,v in {
        'Id':-1, 'variable':None, 'default_variable':None, 'mapping_creates_variable':False,
        'maps_to_existing_variable':True, 'manual_iec_address':'%IX0.0' if name=='Bit0' else '%IX0.1'
    }.items()}
    return dict(identifier=field(name), identityStatus='unique-in-view',
                view='connector.host_parameters', deviceGuid='module-guid',connectorId=2,
                parameter=dict(id=field(13),name=field('InputData'),channel_type=field('Input'),
                               ownerGuid=field('module-guid')),
                elementIdentifiers=[name],element=dict(base_type=field('BOOL'),bit_size=field(1)),
                mapping=mapping,mappingState=mapping_state(mapping))


def device(name_path,guid,model):
    return dict(path=name_path,guid=field(guid),
                identification=dict(zip(('type','id','version'),map(field,model))))


def state():
    rows=[row('Bit0'),row('Bit1')]
    return dict(applicationId='app',declaration=dict(name='GVL_IOProbe',text=DECL,guid='gvl',
                typeGuid='ffbfa93a-b94d-45fc-a329-229860183b1d',parentGuid='app'),
                sources={'PLC_PRG':'source A'},tasks={'MainTask':['PLC_PRG']},
                snapshot=dict(devices=[device(['Device'],'root',(4102,'10f4 0002','3.5.11.11')),
                                       device(['Device','HIGH_SPEED_IO'],'module-guid',(40600,'10F4 0600','00.00.00.20'))],
                              connectors=[dict(enumeratedFromDeviceGuid='module-guid',
                                  fields=dict(connector_id=field(2),ownerGuid=field('module-guid'),
                                              interface=field('Common.inovance2')))],
                              channels=rows,issues=[],unclassified=[],scans=[{'endObserved':True}],
                              coverage=dict(enumerationComplete=True,truncated=False,mappingStates={})),
                export=dict(complete=True,rows=[dict(deviceGuid='module-guid',connectorId=2,parameterId=13,
                            elementPath=[name],rawMappings=[]) for name in ('Bit0','Bit1')]))


def exported_mapping(expression, create=False):
    node = ElementTree.Element('Single', Method='IArchivable')
    for name, typ, value in [('Variable','string',expression), ('Id','long','-1'),
                             ('CreateVariable','bool',str(create)), ('DefaultVariable','string',''),
                             ('IoChannelFBInstance','string','')]:
        ElementTree.SubElement(node, 'Single', Name=name, Type=typ).text = value
    return mapping_item(node)


def positive(before,expr=EXPRESSION,export_expr=EXPRESSION):
    after=copy.deepcopy(before)
    first=after['snapshot']['channels'][0]
    first['mapping']['variable']=field(expr)
    first['mapping']['default_variable']=field('')
    first['mappingState']=mapping_state(first['mapping'])
    after['export']['rows'][0]['rawMappings']=[exported_mapping(export_expr)]
    return after


class ProbeTests(unittest.TestCase):
    def reject_before_dispatch(self, s, reason):
        counts=dict(setter=0,save=0)
        with self.assertRaisesRegex(ValueError,reason):
            validate_state(s,False)
            counts['setter']+=1
            counts['save']+=1
        self.assertEqual(counts,dict(setter=0,save=0))

    def test_positive_uses_qualified_existing_expression_even_when_native_id_stays_minus_one(self):
        baseline=state()
        self.assertEqual(validate_state(baseline,False),('module-guid',2,13,('Bit0',)))
        after=positive(baseline)
        self.assertEqual(after['snapshot']['channels'][0]['mapping']['Id'],field(-1))
        self.assertEqual(after['snapshot']['channels'][0]['mappingState'],'mapping-text-read')
        self.assertEqual(validate_state(after,True,mapping_matches),('module-guid',2,13,('Bit0',)))
        self.assertIsNone(change_only(baseline,after,mapping_matches))

    def test_changed_member_id_observed_by_both_sources(self):
        b=state()
        b['snapshot']['channels'][0]['elementIdentifiers']=['Bit9']
        b['export']['rows'][0]['elementPath']=['Bit9']
        self.reject_before_dispatch(b,'Complete target channel key not found')

    def test_rebound_channel_identity_after_dispatch_stops_verification(self):
        b=state();a=positive(b)
        new='changed-module'
        a['snapshot']['devices'][1]['guid']=field(new)
        c=a['snapshot']['connectors'][0]
        c.update(enumeratedFromDeviceGuid=new)
        c['fields']['ownerGuid']=field(new)
        for r in a['snapshot']['channels']:
            r['deviceGuid']=new
            r['parameter']['ownerGuid']=field(new)
        for r in a['export']['rows']:
            r['deviceGuid']=new
        validate_state(a,True,mapping_matches)
        with self.assertRaisesRegex(ValueError,'Source, declaration, task, address, connector or another channel changed'):
            change_only(b,a,mapping_matches)

    def test_cross_open_enumeration_order_only(self):
        original=state()
        key=validate_state(original,False)
        changed=copy.deepcopy(original)
        changed['snapshot']['devices'].reverse()
        self.assertNotEqual(invariant(original,key),invariant(changed,key))
        self.assertEqual(invariant(original,key,True),invariant(changed,key,True))
        changed['snapshot']['devices'][0]['path']+=['different']
        self.assertNotEqual(invariant(original,key,True),invariant(changed,key,True))
        changed['snapshot']['devices'].append(changed['snapshot']['devices'][0])
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            invariant(changed,key,True)

    def test_non_bool_variable_declined(self):
        b=state();b['declaration']['text']=DECL.replace('BOOL','DINT')
        self.reject_before_dispatch(b,'Existing unique root BOOL declaration differs')

    def test_existing_mapping_declined(self):
        b = positive(state())
        b['snapshot']['channels'][0]['mapping']['default_variable'] = field(None)
        self.reject_before_dispatch(b,'Existing mapping, nonempty export, or conflicting empty read')

    def test_empty_getter_does_not_prove_empty_export(self):
        b=state()
        b['export']['rows'][0]['rawMappings']=[dict(variable='other',createVariable=False)]
        self.reject_before_dispatch(b,'Existing mapping, nonempty export, or conflicting empty read')

    def test_getter_and_export_disagree_after_setter(self):
        b=state()
        for item in [[exported_mapping('GVL_Other.Input0')], [exported_mapping(EXPRESSION, create=True)],
                     [exported_mapping(EXPRESSION), exported_mapping(EXPRESSION)], []]:
            a=positive(b)
            a['export']['rows'][0]['rawMappings']=item
            with self.assertRaisesRegex(ValueError,'Getter disagrees with the independently exported mapping entry'):
                change_only(b,a,mapping_matches)

    def test_empty_string_and_null_are_distinct(self):
        b=state();first=b['snapshot']['channels'][0]
        first['mapping']['variable']=field('')
        first['mappingState']=mapping_state(first['mapping'])
        self.assertEqual(first['mappingState'],'empty-expression')
        self.reject_before_dispatch(b,'Existing mapping, nonempty export, or conflicting empty read')

    def test_incomplete_observations_declined(self):
        for change,reason in [(lambda b:b['snapshot']['coverage'].update(truncated=True),'Incomplete channel enumeration'),
                (lambda b:b['snapshot']['scans'][0].update(endObserved=False),'Incomplete channel enumeration'),
                (lambda b:b['export'].update(complete=False),'Incomplete independent export'),
                (lambda b:b['export']['rows'].pop(),'Getter/export channel coverage differs')]:
            b=state();change(b)
            self.reject_before_dispatch(b,reason)

    def test_default_variable_changes_from_null_to_empty_after_dispatch(self):
        before = state()
        after = positive(before)
        key = ('module-guid', 2, 13, ('Bit0',))
        # Equal-phase comparisons must retain this metadata, even on the selected row.
        self.assertNotEqual(invariant(before,key), invariant(after,key))
        original = copy.deepcopy(before)
        self.assertIsNone(change_only(before, after, mapping_matches))
        self.assertEqual(before, original)

    def test_other_channel_default_change_declined(self):
        before = state()
        after = positive(before)
        after['snapshot']['channels'][1]['mapping']['default_variable'] = field('')
        with self.assertRaisesRegex(ValueError, 'another channel changed'):
            change_only(before, after, mapping_matches)

    def test_clearing_a_nonempty_default_is_not_the_authorized_transition(self):
        before = state()
        before['snapshot']['channels'][0]['mapping']['default_variable'] = field('GVL_Other.Input')
        after = positive(before)
        with self.assertRaisesRegex(ValueError, 'default_variable'):
            change_only(before, after, mapping_matches)

    def test_missing_errored_or_contradictory_getter_evidence_declined(self):
        for side in ('before','after'):
            for replacement in (None, {'state':'error','errorType':'IOException','message':'read failed'},
                                {'state':'null'}, {'state':'value'}, {'state':'null','value':''},
                                field(' '), field('GVL_Other.Input'),
                                field('') if side == 'before' else field(None)):
                with self.subTest(side=side, sample=replacement):
                    before = state()
                    after = positive(before)
                    mapping = (before if side == 'before' else after)['snapshot']['channels'][0]['mapping']
                    if replacement is None:
                        del mapping['default_variable']
                    else:
                        mapping['default_variable'] = replacement
                    with self.assertRaisesRegex(ValueError, 'default_variable'):
                        change_only(before, after, mapping_matches)

    def test_export_must_have_one_typed_empty_default_scalar(self):
        for fault in ('missing','duplicate','null','nonempty','whitespace','wrong-type','nested','missing-value'):
            with self.subTest(fault=fault):
                before = state()
                after = positive(before)
                children = after['export']['rows'][0]['rawMappings'][0]['xml']['children']
                node = next(child for child in children if child['attrs']['Name'] == 'DefaultVariable')
                if fault == 'missing':
                    children.remove(node)
                elif fault == 'duplicate':
                    children.append(copy.deepcopy(node))
                elif fault == 'null':
                    node.update(tag='Null', value=None)
                elif fault == 'wrong-type':
                    node['attrs']['Type'] = 'bool'
                elif fault == 'nested':
                    node['children'].append(copy.deepcopy(node))
                elif fault == 'missing-value':
                    del node['value']
                else:
                    node['value'] = ' ' if fault == 'whitespace' else 'GVL_Other.Input'
                with self.assertRaisesRegex(ValueError, 'DefaultVariable'):
                    change_only(before, after, mapping_matches)

    def test_mapping_to_different_expression_or_new_variable_declined(self):
        before = state()
        changed = positive(before, expr='GVL_IOProbe.Other', export_expr='GVL_IOProbe.Other')
        with self.assertRaisesRegex(ValueError, 'requested existing-variable expression'):
            change_only(before, changed, mapping_matches)
        changed = positive(before)
        changed['snapshot']['channels'][0]['mapping']['maps_to_existing_variable'] = field(False)
        changed['snapshot']['channels'][0]['mapping']['mapping_creates_variable'] = field(True)
        changed['export']['rows'][0]['rawMappings'] = [exported_mapping(EXPRESSION, create=True)]
        with self.assertRaisesRegex(ValueError, 'requested existing-variable expression'):
            change_only(before, changed, mapping_matches)

    def test_other_address_cannot_change_with_selected_expression(self):
        b=state();a=positive(b)
        a['snapshot']['channels'][1]['mapping']['manual_iec_address']=field('%IX1.1')
        with self.assertRaisesRegex(ValueError,'Source, declaration, task, address, connector or another channel changed'):
            change_only(b,a,mapping_matches)

    def test_cross_open_allows_only_enumeration_order_and_same_handle_stays_strict(self):
        b=state()
        c=copy.deepcopy(b['snapshot']['connectors'][0])
        c['fields']['connector_id']=field(19)
        b['snapshot']['connectors'].append(c)
        a=positive(b)
        a['snapshot']['devices'].reverse()
        a['snapshot']['connectors'].reverse()
        with self.assertRaisesRegex(ValueError,'Source, declaration, task, address, connector or another channel changed'):
            change_only(b,a,mapping_matches)
        self.assertIsNone(change_only(b,a,mapping_matches,cross_open=True))
        a['snapshot']['connectors'][0]['fields']['interface']=field('Changed.Other.Connector')
        with self.assertRaisesRegex(ValueError,'Source, declaration, task, address, connector or another channel changed'):
            change_only(b,a,mapping_matches,cross_open=True)

    def test_int64_identifier_round_trip_above_53_bits(self):
        class Type:
            FullName='System.Int64'
        class Box:
            def GetType(self):return Type()
            def __str__(self):return '9007199254740993'
        self.assertEqual(val(lambda:Box()),dict(state='value',value=9007199254740993,nativeType='System.Int64'))


if __name__=='__main__':
    unittest.main(verbosity=2)
