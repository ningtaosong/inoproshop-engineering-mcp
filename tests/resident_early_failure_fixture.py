# -*- coding: utf-8 -*-
"""Offline producer for the Node early-ownership contract regression.

Uses production ResidentSession, NativeProjectAdapter and OwnershipRecorder.
The supplied JSON is test data; no IDE, real project or user source execution.
"""
import sys,os,json
sys.path.insert(0,os.path.dirname(__file__))
import test_resident_core as f
import resident_host as host

def produce(value):
    request=value['request'];intent=value['intent'];identity=value['identity'];records={}
    fixture=f.PublicAdapterCases('test_public_open_once_and_owned_replace');fixture.setUp()
    adapter=fixture.adapter;adapter.path=request['projectPath'];original=fixture.projects.open
    def opened(path,primary):
        project=original(path,primary);project.path=path;return project
    fixture.projects.open=opened
    recorder=host.OwnershipRecorder(f.c.__dict__,intent,identity,lambda name,row:records.update({name:row}))
    adapter.observe_ownership=lambda row:recorder.observe(row,adapter.handle,adapter.attempts)
    # Real public source read fails AFTER the ownership receipt is produced.
    fixture.item.textual_declaration.text=None
    recorder.begin(request)
    result=f.c.ResidentSession(adapter,lambda:request['diskHash'],lambda name,row:records.update({name:row})).handle(request)
    result['requestId']=request['requestId']
    result['data']['residentEvidence']=dict(launchId=request['launchId'],sequence=request['sequence'],requestHash=f.c.digest(request),processIdentity=identity,requestCompleted=True,ideExitRequested=False,ownershipRecords=recorder.records)
    return dict(result=result,records=records,attempts=adapter.attempts)

if __name__=='__main__':
    # Node sends UTF-8 bytes; Windows' default stdin encoding is not UTF-8.
    raw=getattr(sys.stdin,'buffer',sys.stdin).read()
    if isinstance(raw,bytes):raw=raw.decode('utf-8')
    sys.stdout.write(json.dumps(produce(json.loads(raw)),ensure_ascii=True))
