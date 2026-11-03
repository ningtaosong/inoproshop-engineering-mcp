"""直接执行生产桥接函数的故障测试；替代厂商对象，不作为 IDE 或计时实测。"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import uuid


class Buffer:
    def __init__(self, owner, field, value=''):
        self.owner, self.field, self.text = owner, field, value

    def replace(self, value):
        if self.field == 'implementation' and self.owner.project.control.get('fail_write'):
            self.owner.project.control['fail_write'] = False
            raise RuntimeError('implementation write failed')
        self.text = value


class Node:
    def __init__(self, project, name, app=False, declaration=None, implementation=None, guid=None, nativeType=None):
        self.project, self.name, self.is_application = project, name, app
        self.guid, self.type = guid or str(uuid.uuid4()), nativeType or '6f9dac99-8de1-4efc-8465-68ac443b7d08'
        self.children = []
        self.has_textual_declaration = declaration is not None
        self.has_textual_implementation = implementation is not None
        self.textual_declaration = Buffer(self, 'declaration', declaration)
        self.textual_implementation = Buffer(self, 'implementation', implementation)

    def get_name(self): return self.name
    def get_children(self, recursive): return self.children

    def create_pou(self, name, kind, language, return_type=None):
        self.project.control['factory_calls'] += 1
        if self.project.control.get('return_existing'):
            return self.children[0]
        header={'FB':'FUNCTION_BLOCK','PRG':'PROGRAM','FUN':'FUNCTION'}[kind]+' '+name
        if kind=='FUN':header+=' : '+return_type
        node = Node(self.project, name, declaration=header, implementation='')
        if self.project.control.get('wrong_return_type') and kind=='FUN':node.textual_declaration.text='FUNCTION '+name+' : INT'
        self.children.append(node)
        if self.project.control.get('factory_throw_after_create'):
            raise RuntimeError('factory failed before returning GUID')
        return node

    def create_gvl(self, name):
        return self.create_declaration(name,'gvl','ffbfa93a-b94d-45fc-a329-229860183b1d','VAR_GLOBAL\nEND_VAR')

    def create_dut(self, name, kind, base):
        assert kind=='Structure' and base==''
        return self.create_declaration(name,'structure','2db5746d-d284-4425-9f7f-2663a34b0ebc','TYPE '+name+' :\nSTRUCT\nEND_STRUCT\nEND_TYPE')

    def create_declaration(self, name, kind, native, declaration):
        self.project.control['factory_calls'] += 1
        if self.project.control.get('return_existing'): return self.children[0]
        node=Node(self.project,name,declaration=declaration,nativeType=native)
        self.children.append(node)
        if self.project.control.get('wrong_native'): node.type='00000000-0000-4000-8000-000000000000'
        if self.project.control.get('factory_throw_after_create'): raise RuntimeError('factory failed before GUID')
        return node

    def remove(self):
        self.project.control['removed'].append(self.guid)
        if self.project.control.get('fail_remove'): raise RuntimeError('remove failed')
        def remove_from(parent):
            if self in parent.children: parent.children.remove(self); return True
            return any(remove_from(child) for child in parent.children)
        assert remove_from(self.project)

    def dump(self):
        return dict(name=self.name, app=self.is_application, guid=self.guid, nativeType=self.type,
                    declaration=self.textual_declaration.text, implementation=self.textual_implementation.text,
                    children=[x.dump() for x in self.children])


class Project:
    def __init__(self, manager, rows=None):
        self.manager, self.control = manager, manager.control
        self.children = []
        def load(row):
            node = Node(self, **{k:v for k,v in row.items() if k != 'children'})
            node.children = [load(x) for x in row['children']]
            return node
        if rows is not None: self.children = [load(x) for x in rows]
        else:
            app = Node(self, 'Application', app=True)
            app.children.append(Node(self, 'PLC_PRG', declaration='PROGRAM PLC_PRG', implementation='// retained'))
            self.children = [app]

    def get_children(self, recursive): return self.children
    def save(self): self.manager.saved = [x.dump() for x in self.children]
    def close(self): pass


class Manager:
    def __init__(self):
        self.control = dict(factory_calls=0, removed=[])
        self.saved = None
    def open(self, path, primary): return Project(self, self.saved)


class BridgeCreation(unittest.TestCase):
    def setUp(self):
        # 只载入函数定义：不执行 worker 顶层派发、System 导入或 IDE 退出。
        tree = ast.parse(Path('bridge/worker.py').read_text(encoding='utf-8'))
        module = ast.Module(body=[x for x in tree.body if isinstance(x, ast.FunctionDef)], type_ignores=[])
        self.env = dict(unicode=str, hashlib=hashlib, json=json, re=re, os=os, CONTRACT='1.0.0')
        exec(compile(module, 'bridge/worker.py', 'exec'), self.env)
        self.manager = Manager()
        self.project = Project(self.manager); self.project.save()
        self.app = self.project.children[0]
        self.published = []
        self.env.update(projects=self.manager, publish=lambda p,v:self.published.append((p,v)),
                        scriptengine=SimpleNamespace(PouType=SimpleNamespace(FunctionBlock='FB',Program='PRG',Function='FUN'), ImplementationLanguages=SimpleNamespace(st='ST')))
        self.before = self.env['snapshot'](self.project)
        self.before_ids = {x.guid for x,n,a in self.env['walk'](self.project)}
        self.args = dict(applicationId=self.app.guid, parentId=self.app.guid, name='FB_Test', pouType='function_block',
                         expectedSnapshot=self.before, declaration='FUNCTION_BLOCK FB_Test\nVAR\nEND_VAR\n', implementation='// content\n')
        self.req = dict(projectPath='test.project', checkpointPath='checkpoint.project', resultPath='operation/result.json')

    def create(self): return self.env['create_pou'](self.project, self.req, self.args)

    def test_real_function_saves_reopens_and_verifies_new_guid(self):
        result, reopened = self.create()
        self.assertEqual(result['status'], 'succeeded')
        self.assertIsNot(reopened, self.project)
        self.assertNotIn(result['data']['objectId'], self.before_ids)
        self.assertEqual(result['data']['implementation'], self.args['implementation'])
        self.assertTrue(result['data']['reopened'])
        self.assertEqual(self.manager.control['factory_calls'], 1)
        self.assertEqual(len(self.published), 2)

    def test_stale_snapshot_and_case_insensitive_collision_do_not_call_factory(self):
        self.args['expectedSnapshot'] = '0'*64
        self.assertEqual(self.create()[0]['error']['code'], 'SNAPSHOT_CONFLICT')
        self.args.update(expectedSnapshot=self.before, name='plc_prg', declaration='FUNCTION_BLOCK plc_prg')
        self.assertEqual(self.create()[0]['error']['code'], 'OBJECT_EXISTS')
        self.assertEqual(self.manager.control['factory_calls'], 0)

    def test_partial_write_removes_only_returned_new_guid_then_reopens_original(self):
        self.manager.control['fail_write'] = True
        result, reopened = self.create()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['data']['recovery']['status'], 'succeeded')
        self.assertEqual(self.manager.control['removed'], [result['data']['createdObjectId']])
        self.assertEqual(self.env['snapshot'](reopened), self.before)
        self.assertEqual({x.guid for x,n,a in self.env['walk'](reopened)}, self.before_ids)

    def test_remove_failure_is_unknown(self):
        self.manager.control.update(fail_write=True, fail_remove=True)
        result, project = self.create()
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(result['data']['recovery']['status'], 'unknown')

    def test_factory_failure_without_guid_never_deletes_by_name(self):
        self.manager.control['factory_throw_after_create'] = True
        result, project = self.create()
        self.assertEqual(result['status'], 'unknown')
        self.assertIsNone(result['data']['createdObjectId'])
        self.assertEqual(self.manager.control['removed'], [])

    def test_factory_returning_old_guid_cannot_modify_or_remove_original(self):
        self.manager.control['return_existing'] = True
        result, reopened = self.create()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(self.manager.control['removed'], [])
        self.assertEqual(self.env['snapshot'](reopened), self.before)

    def test_program_and_dint_function_native_factories_persist_exact_text(self):
        for kind,name,header in [('program','PRG_Test','PROGRAM PRG_Test'),('function','F_Test','FUNCTION F_Test : DINT')]:
            with self.subTest(kind=kind):
                self.setUp()
                self.args.update(pouType=kind,name=name,declaration=header+'\nVAR\nEND_VAR\n')
                if kind=='function':self.args['returnType']='DINT'
                result,reopened=self.create()
                self.assertEqual(result['status'],'succeeded')
                self.assertEqual(result['data']['objectType'],'st_pou')
                self.assertEqual(result['data']['pouType'],kind)
                self.assertEqual(result['data']['declaration'],self.args['declaration'])
                self.assertEqual(result['data']['returnType'] if kind=='function' else None,self.args.get('returnType'))
                self.assertEqual(self.env['read_object'](*self.env['locate'](reopened,self.app.guid,result['data']['objectId']))['implementation'],self.args['implementation'])

    def test_function_return_type_mismatch_is_not_silently_replaced(self):
        self.args.update(pouType='function',name='F_Test',returnType='DINT',declaration='FUNCTION F_Test : INT')
        self.assertEqual(self.create()[0]['error']['code'],'INVALID_POU_DECLARATION')
        self.assertEqual(self.manager.control['factory_calls'],0)
        self.args['declaration']='FUNCTION F_Test : DINT'
        self.manager.control['wrong_return_type']=True
        result,reopened=self.create()
        self.assertEqual(result['status'],'failed')
        self.assertIn('before write',result['data']['primaryException']['message'])
        self.assertEqual(self.env['snapshot'](reopened),self.before)


if __name__ == '__main__': unittest.main(verbosity=2)
