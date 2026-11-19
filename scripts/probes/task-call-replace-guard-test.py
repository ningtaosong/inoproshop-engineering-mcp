# -*- coding: utf-8 -*-
"""Offline replacement gate checks. No IDE, registration or MCP connection."""
import ast
import copy
import json
from pathlib import Path

from task_call_replace_guard import POU_TYPE, ST_TYPE, replace_once

OLD = 'PRG_ReplaceMe'
NEW = 'PRG_Replacement'
TARGET_NOTE = '中文目标备注：保持原文'
ROWS = [['PLC_PRG', '原首项'], [OLD, TARGET_NOTE], ['PRG_Keep', '保留项']]


def product_reader():
    worker = Path(__file__).resolve().parents[2] / 'bridge' / 'worker.py'
    body = ast.parse(worker.read_text(encoding='utf-8')).body
    selected = [f for f in body if isinstance(f, ast.FunctionDef)
                and f.name in ('text', 'task_append_call_row')]
    assert len(selected) == 2
    env = {'basestring': str, 'unicode': str}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(worker), 'exec'), env)
    return env['task_append_call_row']


def state_for(rows):
    app = ['Device', 'Plc Logic', 'Application']
    programs = {
        name: {'objectId': 'id:' + name, 'path': app + [name], 'applicationId': 'app',
               'contentHash': 'hash:' + name, 'nativeTypeId': POU_TYPE,
               'pouType': 'program', 'pouTypeSource': 'native-pou-type-id-and-declaration-header',
               'embeddedObjectTypes': [ST_TYPE]}
        for name in ('PLC_PRG', OLD, NEW, 'PRG_Keep')
    }
    bindings = []
    for i, row in enumerate(rows):
        record = programs[row[0].rsplit('.', 1)[-1]]
        bindings.append({'order': i, 'raw': row[:], 'objectId': record['objectId'],
                         'path': record['path'][:], 'applicationId': 'app'})
    return {'projectPath': 'offline-fixture', 'applicationId': 'app', 'applicationPath': app,
            'sourceSnapshot': 'sources', 'taskConfigurationVersion': 'configuration',
            'programs': programs, 'task': {'taskId': 'task', 'callsComplete': True,
            'unavailableFields': [], 'rawCalls': copy.deepcopy(rows), 'resolvedCalls': bindings}}


class NativeDouble(list):
    def __init__(self, rows, fail_after_replace=False):
        super().__init__(copy.deepcopy(rows))
        self.replacements = []
        self.saves = 0
        self.fail_after_replace = fail_after_replace

    def replace(self, index, name, comment):
        self.replacements.append([index, name, comment])
        self[index] = [name, comment]
        if self.fail_after_replace:
            raise RuntimeError('Unknown result after native call')

    def save(self):
        self.saves += 1


def run():
    read = product_reader()
    results = []

    def check(name, expected=None, *, baseline_rows=None, native_rows=None,
              change_both=None, change_live=None, new=NEW, mark_fail=False, partial=False):
        rows = copy.deepcopy(ROWS if baseline_rows is None else baseline_rows)
        base = state_for(rows)
        if change_both:
            change_both(base)
        live = copy.deepcopy(base)
        if change_live:
            change_live(live)
        calls = NativeDouble(rows if native_rows is None else native_rows, partial)
        before = copy.deepcopy(list(calls))
        marks, error = [], None

        def mark(index, row):
            if mark_fail:
                raise RuntimeError('Dispatch record unavailable')
            marks.append([index, row[:]])

        try:
            replace_once(calls, base, live, OLD, new, read, mark)
            expected_index = next(i for i, row in enumerate(rows) if row[0] == OLD)
            expected_rows = copy.deepcopy(before)
            expected_rows[expected_index][0] = new
            assert list(calls) == expected_rows and marks == [[expected_index, before[expected_index]]]
            calls.save()
        except (ValueError, RuntimeError) as exc:
            error = str(exc)

        assert error == expected, (name, expected, error)
        if not error or partial:
            idx = next(i for i, row in enumerate(rows) if row[0] == OLD)
            assert marks == [[idx, rows[idx]]] and calls.replacements == [[idx, new, rows[idx][1]]]
            assert calls.saves == int(not partial)
        else:
            assert not marks and not calls.replacements and calls.saves == 0 and list(calls) == before
        results.append({'case': name, 'observedError': error, 'dispatchMarks': marks,
                        'replaceCalls': calls.replacements, 'saveCalls': calls.saves, 'rowsAfter': list(calls)})

    check('target missing', 'Old call missing or ambiguous', baseline_rows=[ROWS[0], ROWS[2]])
    check('target duplicated', 'Old call missing or ambiguous', baseline_rows=ROWS + [ROWS[1]])
    check('target at different index', 'Live call names, order or comments changed',
          native_rows=[ROWS[1], ROWS[0], ROWS[2]])
    check('different survivor order', 'Live call names, order or comments changed',
          native_rows=[ROWS[2], ROWS[1], ROWS[0]])
    check('target comment changed', 'Live call names, order or comments changed',
          native_rows=[ROWS[0], [OLD, '另一个备注'], ROWS[2]])
    check('missing comment', '原生调用行须为名称、注释两字段记录', native_rows=[ROWS[0], [OLD], ROWS[2]])
    check('null comment', '原生调用注释须为文本，可用空字符串', native_rows=[ROWS[0], [OLD, None], ROWS[2]])
    check('incorrect name type', '原生调用名称须为非空文本', native_rows=[ROWS[0], [17, TARGET_NOTE], ROWS[2]])
    check('non ST target', 'Native ST PROGRAM unconfirmed: ' + NEW,
          change_both=lambda s: s['programs'][NEW].update(embeddedObjectTypes=['other']))
    check('unbound target', 'PROGRAM identity or scope incomplete: ' + NEW,
          change_both=lambda s: s['programs'][NEW].update(objectId=''))
    check('ambiguous target', 'PROGRAM identity missing or ambiguous: ' + NEW,
          change_both=lambda s: s['programs'].update({NEW.lower(): s['programs'][NEW].copy()}))
    check('wrong Application', 'PROGRAM identity or scope incomplete: ' + NEW,
          change_both=lambda s: s['programs'][NEW].update(applicationId='other'))
    check('new target already called', 'Replacement already present in task', baseline_rows=ROWS + [[NEW, '已经调用']])
    check('same target', 'Old and new PROGRAM names are identical', new=OLD.lower())
    check('same target ID', 'Old and new PROGRAM identities coincide',
          change_both=lambda s: s['programs'][NEW].update(objectId=s['programs'][OLD]['objectId']))
    check('call binding differs', 'Old call binding changed',
          change_both=lambda s: s['task']['resolvedCalls'][1].update(objectId='wrong'))
    check('incomplete task', 'Incomplete task evidence', change_both=lambda s: s['task'].update(callsComplete=False))
    check('version changed', 'Configuration, identity or source changed since baseline',
          change_live=lambda s: s.update(taskConfigurationVersion='later'))
    check('dispatch write failed', 'Dispatch record unavailable', mark_fail=True)
    check('native error after dispatch', 'Unknown result after native call', partial=True)
    check('one target changed, comment preserved')
    check('index derived when target is last', baseline_rows=[ROWS[0], ROWS[2], ROWS[1]])
    return {'scope': 'Offline native collection and save doubles, production strict row reader, actual probe gate',
            'passed': len(results), 'cases': results}


if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=True, indent=2))
