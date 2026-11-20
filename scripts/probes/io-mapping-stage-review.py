"""Verify native phase evidence offline, without opening a project or acquiring a lease.

Arguments: fixture evidence directory, output JSON. Relative exports may also be
resolved through the package's export-index.json (deduplicated XML payloads).
"""
import hashlib
import json
import sys
from pathlib import Path
from io_mapping_export_guard import parse_export, mapping_matches
from io_mapping_positive_guard import mapping_expression,validate_state,index,rowkey,xmlkey
from io_mapping_phase_guard import NAME, derived, transition, control_pattern

def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def review(folder):
    def get(name):
        return read(folder/(name+'.json'))
    states={}
    observations={}
    origin=get('fixture-origin')
    packaged=folder/'export-index.json'
    for fn in sorted(folder.glob('*-state.json')):
        label=fn.name[:-11]
        st=read(fn)
        export=folder/(label+'.export') if not packaged.is_file() else folder/read(packaged)[label]
        expected=[d['guid']['value'] for d in st['snapshot']['devices']]
        assert parse_export(str(export),expected)==st['export'],label
        assert get(label+'-getter')==st['snapshot']
        capture=get(label+'-capture')
        assert sha(export)==capture['exportSha256']==st['export']['exportSha256']
        assert capture['path']==origin['project'] and capture['operationId']==origin['operationId']
        states[label]=st
        if label.startswith('setup-'):continue
        positive=label in ('mapping-after-setter','mapping-before-save','mappedread-saved-reopen','mappedread-final')
        key=validate_state(st,positive,mapping_matches)
        row=index(st['snapshot']['channels'],rowkey)[key]
        rows=index(st['export']['rows'],xmlkey)
        issue=None
        try:
            hw=derived(st)
        except ValueError as exc:
            # Report the original raw node and its position even when the admission gate failed.
            issue=str(exc)
            matches=[n for n in st['nativeTree'] if n['path']==['Device',NAME]]
            hw=matches[0]['guid'] if len(matches)==1 else None
        observations[label]=dict(capture=capture,derivedGuid=hw,admissionIssue=issue,
             addedNode=next((v for v in st['nativeTree'] if v['guid']==hw),None),
             connectors=[v for v in st['snapshot']['connectors'] if v['enumeratedFromDeviceGuid']==hw],
             devices=len(expected),ports=len(st['snapshot']['connectors']), channels=len(rows),
             expression=mapping_expression(st),key=key,
             first=row['mapping'],lists={ 'target':rows[key]['rawMappings'],'otherCount':sum(len(v['rawMappings']) for k,v in rows.items() if k!=key)})
    compiles={}
    for f in sorted(folder.glob('*-build.json')):
        b=read(f);data=b['reply']['data'];diag=data['diagnostics']
        label={'control-baseline-build':'control-open-uncompiled','controlread-saved-build':'controlread-reopened-uncompiled',
               'mapping-baseline-build':'mapping-before','mapping-mapped-build':'mapping-after-setter','mappedread-saved-build':'mappedread-saved-reopen'}[f.stem]
        assert b['inputMappingIndex']==states[label]['export']['exportSha256']
        capture=observations[label]['capture']
        assert capture['disk']==b['diskBefore']==b['diskAfter'] and capture['sourceSnapshot']==b['sourceSnapshot']
        assert b['reply']['status']=='succeeded' and data['diagnosticsComplete']
        compiles[f.stem]=dict(disk=b['diskBefore'],inputExport=b['inputMappingIndex'],persistedInput=b['persistedInput'],
              passed=data['buildPassed'],errors=sum(x['severity'] in ('error','fatalerror') for x in diag),
              warnings=sum(x['severity']=='warning' for x in diag))
    results={}; births=[]
    for f in sorted(folder.glob('*-result.json')):
        r=read(f);m=r['passName'];birth=get(m+'-process')
        assert r['operationId']==origin['operationId'] and r['engine']['creationUtcTicks']==birth['birth']['identity']['startId']
        assert birth['pid']==r['engine']['pid']
        births.append(r['engine']['creationUtcTicks'])
        end=folder/(m+'-exit-observation.json')
        results[m]=dict(status=r['status'],opened=r['opened'],closed=r['closed'],save=r['saveCalls'],
                        setter=r['setterDispatchCount'],compile=r['compileCalls'],diskBefore=r['diskBefore'],
                        afterClose=r['diskAfterClose'],engine=r['engine'],error=r.get('primaryError'),
                        exit=read(end) if end.exists() else None)
    assert len(births)==len(set(births))
    passes=(folder/'probe-complete.json').exists()
    behavior=None
    if passes:
        finish=get('probe-complete')
        assert all(r['closed'] and r['status']=='succeeded' and r['exit']['code']==0 for r in results.values())
        assert get('lease-final')['service']['present'] is False and get('lease-final')['fixture']['present'] is False
        if finish['scenario']=='control':
            behavior=control_pattern(*(states[k] for k in ('control-open-uncompiled','control-compiled-unsaved',
                                        'controlread-reopened-uncompiled','controlread-saved-compiled')))
            assert behavior==get('controlread-behavior')
            assert results['control']['afterClose']==results['controlread']['afterClose']==finish['mainFileSha256']==compiles['controlread-saved-build']['disk']
        else:
            behavior=get('control-proof')['behavior']
            a,b,pre,imm,saved,c,d=[states[k] for k in ('mapping-before','mapping-compiled-baseline','mapping-same-handle-prewrite',
                           'mapping-after-setter','mapping-before-save','mappedread-saved-reopen','mappedread-final')]
            transition(a,b,shape='appear');transition(b,pre)
            transition(pre,imm,positive=True,setting=True);transition(imm,saved,positive=True)
            transition(saved,c,positive=True,cross=True,shape=behavior['reopen'])
            transition(c,d,positive=True,shape=behavior['rebuild'])
            assert results['mapping']['afterClose']==results['mappedread']['afterClose']==finish['mainFileSha256']==compiles['mappedread-saved-build']['disk']
            assert sum(r['setter'] for r in results.values())==1 and get('mapping-dispatch')['expression']==mapping_expression(pre)
    comparisons={}
    if 'control-compiled-unsaved' in states:
        transition(states['control-open-uncompiled'],states['control-compiled-unsaved'],shape='appear')
        comparisons['presave']='exact scoped delta verified'
    if 'controlread' in results and results['controlread']['status']=='failed':
        rr=results['controlread']
        assert rr['setter']==rr['compile']==rr['save']==0 and rr['closed'] and rr['exit']['code']==0
        assert rr['diskBefore']==rr['afterClose']==results['control']['afterClose']
        issue=observations['controlread-reopened-uncompiled']['admissionIssue']
        assert rr['error']['message']==issue and issue
        assert not (folder/'controlread-saved-build.json').exists()
        stop=get('probe-stopped')
        assert stop['uncertain'] is False and not passes
        assert get('lease-final')['service']['present'] is False and get('lease-final')['fixture']['present'] is False
    if 'controlread-reopened-uncompiled' in states:
        before,after=[states[label] for label in ('control-compiled-unsaved','controlread-reopened-uncompiled')]
        left=index(before['nativeTree'],lambda n:tuple(n['path']))
        right=index(after['nativeTree'],lambda n:tuple(n['path']))
        edits=[]
        for key in sorted(set(left)|set(right)):
            a,b=left.get(key),right.get(key)
            if a is None or b is None:edits.append(dict(path=key,before=a,after=b));continue
            for k in sorted(set(a)|set(b)):
                if a.get(k)!=b.get(k):
                    edits.append(dict(path=key,field=k,before=a.get(k),after=b.get(k)))
        comparisons['independentReopen']=dict(treeEdits=edits,
            sameGetterFields={k:before['snapshot'][k]==after['snapshot'][k] for k in ('devices','connectors','channels','coverage')},
            sameExportFields={k:before['export'][k]==after['export'][k] for k in ('devices','rows')},
            sameProgramFields={k:before[k]==after[k] for k in ('sources','tasks','sourceSnapshot','declaration','applications')})
    files={}
    for mode in results:
        pre=get(mode+'-preflight')['files']
        end=folder/(mode+'-after-exit.json')
        if not end.exists():continue
        a,b=({i['path']:i for i in rows} for rows in (pre,read(end)['files']))
        files[mode]=[dict(path=p,before=a.get(p),after=b.get(p),change=(
            'added' if p not in a else 'removed' if p not in b else 'content' if a[p]['sha256']!=b[p]['sha256']
            else 'timestamp' if a[p]['mtimeNs']!=b[p]['mtimeNs'] else 'unchanged')) for p in sorted(set(a)|set(b))]
    return dict(comparisons=comparisons,files=files,origin=origin,stages=observations,compiles=compiles,results=results,complete=passes,
                behavior=behavior,release=get('lease-final') if (folder/'lease-final.json').exists() else None)

if __name__=='__main__':
    data=review(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'complete':data['complete'],'behavior':data['behavior'],'builds':data['compiles']}))
