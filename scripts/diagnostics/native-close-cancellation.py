"""Offline reproduction against the production helper; never starts the OEM.

The synthetic host models the installed Frame progress/idle ordering. Passing
these checks means the cancellation gap is reproduced, NOT that it is fixed.
Run from the repository root with Python 3.
"""
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace


def scenario(*, can_close, busy, reentrant=False):
    source = Path('bridge/native_exit.py').resolve()
    spec = importlib.util.spec_from_file_location('production_native_exit', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    callbacks, records, events = [], {}, []
    state = dict(canClose=can_close, lengthyOperationIsActive=busy, exited=False)
    with tempfile.TemporaryDirectory(prefix='inopro-close-cancellation-') as temp:
        root = Path(temp)
        hashes = dict(workerHash='a' * 64, helperHash='b' * 64)
        request = dict(operationId='synthetic-operation', requestId='synthetic-request',
                       requestFingerprint='c' * 64, launchId='synthetic-launch',
                       resultPath=str(root / 'result.json'),
                       normalClosePolicy=dict(version=1, commandGuid=module.NORMAL_EXIT_GUID, **hashes))
        req_path = root / 'request.json'
        req_path.write_text(json.dumps(request), encoding='utf8')

        def publish(name, value):
            assert Path(name).name not in records
            records[Path(name).name] = value

        def execute(args):
            assert args == []
            events.append(dict(event='public-FileExit', canClose=state['canClose'],
                               lengthyOperationIsActive=state['lengthyOperationIsActive']))
            # Both branches return void; the installed OnClosing false branch cancels.
            state['exited'] = state['canClose']

        def schedule(callback, asynchronous):
            assert asynchronous is True
            if reentrant:
                callback()
            else:
                callbacks.append(callback)

        command = SimpleNamespace(guid=module.NORMAL_EXIT_GUID, execute=execute)
        system = SimpleNamespace(ui_present=True, commands={command.guid: command},
                                 execute_on_primary_thread=schedule)
        closer = module.NativeExit(request, str(req_path), system,
                                   SimpleNamespace(primary=None, all=[]), publish,
                                   dict(pid=1, startId='synthetic'), str, lambda: [], hashes)
        closer.preflight()
        closer.queue()
        for callback in callbacks:
            callback()
        assert closer.first_error is None
        assert len(events) == 1
        assert records['normal-close-returned.json']['dispatchCount'] == 1
        return dict(state=state, calls=events, receiptNames=list(records),
                    helperSha256=hashlib.sha256(source.read_bytes()).hexdigest())


def main():
    cancelled = scenario(can_close=False, busy=True)
    assert cancelled['state']['exited'] is False
    pending_idle = scenario(can_close=False, busy=False)
    assert pending_idle['state']['exited'] is False
    normal = scenario(can_close=True, busy=False)
    assert normal['state']['exited'] is True
    nested = scenario(can_close=False, busy=True, reentrant=True)
    assert nested['state']['exited'] is False
    # Never infer exit from an identical returned receipt or an empty project set.
    assert cancelled['receiptNames'] == pending_idle['receiptNames'] == normal['receiptNames']
    print(json.dumps(dict(source='production bridge/native_exit.py + synthetic Frame state',
                         checksPassed=5, nativeExecutions=0, productFixVerified=False,
                         cancelledDuringProgress=cancelled, finishedAwaitingIdle=pending_idle,
                         readyControl=normal, nestedCallback=nested), indent=2))


if __name__ == '__main__':
    main()
