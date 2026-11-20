"""Verify the frozen archive and the normally closed fixture. Produce a reference for the separate recompilation."""
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(r'D:\InoPro-S8b-Positive-20261120-091939')
ARCHIVE=Path(r'D:\InoPro\deliveries\InoPro-review-20261120-092812.zip')
ARCHIVE_SHA='3326c57ba07f6e21e38ea9d8e265d1bf8658d2e9b6c1be215b46564b6498f9a1'
DISK='0b569b51e267993c3bcb686b464ef882354795b4c05befbd3df93d976f62403c'
OP='3613a01f-48bb-420b-bdba-297bea5f1f20'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def verify(mapped=False):
    root,archive,archive_sha,disk,op = ROOT,ARCHIVE,ARCHIVE_SHA,DISK,OP
    group='mapping' if mapped else 'control'
    if mapped:
        root=Path(r'D:\InoPro-S8b-Positive-20261120-094036')
        archive=ARCHIVE.with_name('InoPro-review-20261120-094734.zip')
        archive_sha='75fbe4f6c15a8000fceec1d98c3814efa02864342c28db164b5c7d07864f1b77'
        disk='cf1cf53f17397fc46641572ef6f068ea0a7754e708f06aecc009e4feef02b371'
        op='e81c282d-d409-4c1d-b2f7-a311d92cbec0'

    assert sha(archive.read_bytes())==archive_sha
    with ZipFile(archive) as z:
        hashes={n:h for h,n in (ln.split('  ',1) for ln in z.read('SHA256SUMS.txt').decode().splitlines())}
        def member(name):
            b=z.read(name)
            assert sha(b)==hashes[name],name
            return b
        export_index=json.loads(member(group+'/export-index.json'))
        raw={n[len(group)+1:]:h for n,h in hashes.items() if n.startswith(group+'/') and n!=group+'/export-index.json'}
        if mapped:
            assert sha(member('fixtures/mapping.project'))==disk
            raw['checkpoint.project']=sha(member('fixtures/mapping-checkpoint.project'))
        for label,target in export_index.items():
            assert target.startswith('../exports/')
            raw[label+'.export']=hashes[target[3:]]
        assert {f.name:sha(f.read_bytes()) for f in root.iterdir() if f.is_file()}==raw
        def get(n):
            return json.loads(member(group+'/'+n+'.json'))
        origin=get('fixture-origin')
        assert origin['operationId']==op and origin['project']==str(root/'engineering/AM610_IO_Positive.project')
        assert sha(Path(origin['project']).read_bytes())==disk
        old_scripts=origin['scripts']
        for filename,h in old_scripts.items():
            name=filename.replace('\\','/')
            actual='executed/io_mapping_phase_guard.py' if not mapped and name.endswith('/io_mapping_phase_guard.py') else name
            assert sha(member(actual))==h
        starts=[]
        read_mode='mappedread' if mapped else 'controlread'
        for mode in ('setup',group,read_mode):
            r=get(mode+'-result');p=get(mode+'-process');e=get(mode+'-exit-observation')
            intent=get(mode+'-intent');post=get(mode+'-after-exit')
            assert all(i['operationId']==op for i in (r,p,e,intent,post))
            assert r['closed'] and r['opened'] and intent['code']==old_scripts and r['setterDispatchCount']==int(mapped and mode==group)
            assert r['engine']['creationUtcTicks']==p['birth']['identity']['startId'] and e['code']==0 and e['signal'] is None
            assert r['engine']['pid']==p['pid']==e['pid']
            starts.append(r['engine']['creationUtcTicks'])
            if mode==read_mode:
                assert r['status']=='failed' and r['primaryError']['message']==('Saved position would cross different siblings' if mapped else 'Compiled device is not the appended child')
                assert r['diskBefore']==r['diskAfterClose']==disk and r['saveCalls']==r['compileCalls']==0
            else:
                assert r['status']=='succeeded' and r['saveCalls']==1 and r['compileCalls']==((2 if mapped else 1) if mode==group else 0)
        assert len(set(starts))==3 and read_mode+'-saved-build.json' not in raw
        if mapped:
            assert get('mapping-result')['diskAfterClose']==disk
            assert get('mapping-dispatch')['expression']=='Application.GVL_IOProbe.Input0'
            assert get('mapping-after-exit')['fileIdentity']==post['fileIdentity']==get('mappedread-preflight')['fileIdentity']
        else:
            assert get('control-save-receipt')['after']==disk
        assert get('lease-final')['service']['present'] is False and get('lease-final')['fixture']['present'] is False
        assert get('probe-stopped')['uncertain'] is False
        return dict(archive=str(archive),archiveSha256=archive_sha,root=str(root),operationId=op,
                    project=origin['project'],disk=disk,fileId=post['fileIdentity'],starts=starts,
                    previousExecutionScripts=old_scripts,rawEvidenceHashes=raw,
                    reviewedCommit='8fa4f131eeae8d76e4e0de6d1efa0e325a04b059' if mapped else 'aafcfe3db1dfb4981d1d04e8e5cef3e354bd4d75')
if __name__=='__main__':
    print(json.dumps(verify(sys.argv[1:]==["mapped"])))
