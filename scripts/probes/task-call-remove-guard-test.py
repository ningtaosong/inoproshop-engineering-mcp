"""Exercise the native removal guard and the product's strict row reader offline."""
import ast
import copy
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
repo = directory.parents[1]
env = dict(basestring=str)
for file, selected in (
    (repo / 'bridge' / 'worker.py', {'text', 'task_append_call_row'}),
    (directory / 'task-call-remove-native.py', {'expect', 'same_call_name', 'remove_once'}),
):
    functions = [f for f in ast.parse(file.read_text(encoding='utf-8')).body
                 if isinstance(f, ast.FunctionDef) and f.name in selected]
    assert len(functions) == len(selected)
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(file), 'exec'), env)
env['unicode'] = str
target = 'PRG_RemoveMe'
prefix = [['PLC_PRG', ''], [target, 'remove note'], ['PRG_Keep', 'keep note']]


class Calls(list):
    def __init__(self, rows):
        super().__init__(copy.deepcopy(rows))
        self.calls = []

    def remove(self, index):
        self.calls.append(index)
        assert type(index) is int
        del self[index]


def run(name, rows, expected_error=None, fail_record=False):
    calls, dispatches = Calls(rows), []
    error = None

    def mark(index, row):
        if fail_record:
            raise ValueError('Cannot write dispatch evidence')
        dispatches.append([index, row])

    try:
        env['remove_once'](calls, prefix, target, 1, env['task_append_call_row'], mark)
    except ValueError as exc:
        error = str(exc)
    assert error == expected_error, (name, error)
    assert calls.calls == ([] if expected_error else [1])
    assert dispatches == ([] if expected_error else [[1, prefix[1]]])
    assert calls == (rows if expected_error else [prefix[0], prefix[2]])
    return {'case':name, 'error':error, 'removeCount':len(calls.calls),
            'indices':calls.calls, 'dispatchCount':len(dispatches), 'rowsAfter':calls}


if __name__ == '__main__':
    results = [
        run('missing-target', [prefix[0], prefix[2]], 'Target call missing or duplicated'),
        run('case-insensitive-qualified-duplicate', prefix + [['Application.prg_removeme', 'another']],
            'Target call missing or duplicated'),
        run('target-moved', [prefix[0], prefix[2], prefix[1]], 'Target call position changed'),
        run('missing-comment', [prefix[0], [target], prefix[2]], '原生调用行须为名称、注释两字段记录'),
        run('null-comment', [prefix[0], [target, None], prefix[2]], '原生调用注释须为文本，可用空字符串'),
        run('whole-string-row', [prefix[0], prefix[1], 'AB'], '原生调用行须为名称、注释两字段记录'),
        run('surviving-comment-changed', prefix[:2] + [['PRG_Keep', 'changed']],
            'Native call order or comments changed before dispatch'),
        run('dispatch-record-failed', prefix, 'Cannot write dispatch evidence', fail_record=True),
        run('exact-single-index-removal', prefix),
    ]
    print(json.dumps({'scope':'offline collection double, actual native guard and strict row decoder',
                      'passed':True, 'cases':results}, indent=2))
