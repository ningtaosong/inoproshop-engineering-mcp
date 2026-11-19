"""Exercise the exact pre-dispatch guard without loading the native IDE."""
import ast
import json
from pathlib import Path

source = Path(__file__).with_name('task-call-append-native.py')
functions = ast.parse(source.read_text(encoding='utf-8-sig'))
guard = {}
exec(compile(ast.Module(body=[node for node in functions.body
                            if isinstance(node, ast.FunctionDef) and node.name in ('expect', 'append_once')],
                        type_ignores=[]), str(source), 'exec'), guard)


class Calls(list):
    def __init__(self, rows):
        super().__init__(rows)
        self.add_count = 0

    def add(self, name, comment):
        self.add_count += 1
        self.append([name, comment])


def check(name, raw, expected_error=None):
    calls, dispatches = Calls([list(row) for row in raw]), []
    prefix = [['PLC_PRG', 'keep original comment']]
    error = None
    try:
        guard['append_once'](calls, prefix, 'PRG_S8Append', str, lambda: dispatches.append('dispatched'))
    except ValueError as exc:
        error = str(exc)
    assert error == expected_error, (name, error)
    count = 0 if error else 1
    assert calls.add_count == len(dispatches) == count
    assert calls == raw + ([['PRG_S8Append', '']] if count else [])
    return dict(case=name, error=error, nativeAddCount=calls.add_count,
                dispatchCount=len(dispatches), originalRowsPreserved=True)


if __name__ == '__main__':
    initial = [['PLC_PRG', 'keep original comment']]
    results = [
        check('case-insensitive target exists', initial + [['prg_s8append', 'keep']],
              'Target already in MainTask'),
        check('incomplete comment', [['PLC_PRG']], 'Incomplete native call tuple'),
        check('prefix comment changed', [['PLC_PRG', 'different']],
              'Native call order or comments changed before dispatch'),
        check('single append preserving prefix', initial),
    ]
    calls = Calls(initial)

    def unavailable_dispatch_record():
        raise TypeError('dispatch record failed before add')

    try:
        guard['append_once'](calls, initial, 'PRG_S8Append', str, unavailable_dispatch_record)
    except TypeError as exc:
        assert str(exc) == 'dispatch record failed before add'
    else:
        raise AssertionError('Expected dispatch recording failure')
    assert calls.add_count == 0 and calls == initial
    results.append(dict(case='dispatch recording failure', nativeAddCount=0, originalRowsPreserved=True))
    print(json.dumps(dict(scope='offline native call collection double', passed=True, cases=results), indent=2))
