"""Read the fixed old ZIP and the closed control. Produce a reference for the separate recompilation."""
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

def verify():
    assert sha(ARCHIVE.read_bytes())==ARCHIVE_SHA
    with ZipFile(ARCHIVE) as z:
        hashes={n:h for h,n in (ln.split('  ',1) for ln in z.read('SHA256SUMS.txt').decode().splitlines())}
        def member(name):
            b=z.read(name)
            assert sha(b)==hashes[name],name
            return b
        export_index=json.loads(member('control/export-index.json'))
        raw={n[8:]:h for n,h in hashes.items() if n.startswith('control/') and n!='control/export-index.json'}
        for label,target in export_index.items():
            assert target.startswith('../exports/')
            raw[label+'.export']=hashes[target[3:]]
        assert {f.name:sha(f.read_bytes()) for f in ROOT.iterdir() if f.is_file()}==raw
        def get(n):
            return json.loads(member('control/'+n+'.json'))
        origin=get('fixture-origin')
        assert origin['operationId']==OP and origin['project']==str(ROOT/'engineering/AM610_IO_Positive.project')
        assert sha(Path(origin['project']).read_bytes())==DISK
        old_scripts=origin['scripts']
        for filename,h in old_scripts.items():
            name=filename.replace('\\','/')
            actual='executed/io_mapping_phase_guard.py' if name.endswith('/io_mapping_phase_guard.py') else name
            assert sha(member(actual))==h
        starts=[]
        for mode in ('setup','control','controlread'):
            r=get(mode+'-result');p=get(mode+'-process');e=get(mode+'-exit-observation')
            intent=get(mode+'-intent');post=get(mode+'-after-exit')
            assert all(i['operationId']==OP for i in (r,p,e,intent,post))
            assert r['closed'] and r['opened'] and intent['code']==old_scripts and r['setterDispatchCount']==0
            assert r['engine']['creationUtcTicks']==p['birth']['identity']['startId'] and e['code']==0 and e['signal'] is None
            assert r['engine']['pid']==p['pid']==e['pid']
            starts.append(r['engine']['creationUtcTicks'])
            if mode=='controlread':
                assert r['status']=='failed' and r['primaryError']['message']=='Compiled device is not the appended child'
                assert r['diskBefore']==r['diskAfterClose']==DISK and r['saveCalls']==r['compileCalls']==0
            else:
                assert r['status']=='succeeded' and r['saveCalls']==1 and r['compileCalls']==int(mode=='control')
        assert len(set(starts))==3 and 'controlread-saved-build.json' not in raw
        assert get('control-save-receipt')['after']==DISK
        assert get('lease-final')['service']['present'] is False and get('lease-final')['fixture']['present'] is False
        assert get('probe-stopped')['uncertain'] is False
        return dict(archive=str(ARCHIVE),archiveSha256=ARCHIVE_SHA,root=str(ROOT),operationId=OP,
                    project=origin['project'],disk=DISK,fileId=post['fileIdentity'],starts=starts,
                    previousExecutionScripts=old_scripts,rawEvidenceHashes=raw,
                    reviewedCommit='aafcfe3db1dfb4981d1d04e8e5cef3e354bd4d75')
if __name__=='__main__':
    print(json.dumps(verify()))
