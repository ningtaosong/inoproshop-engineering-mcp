"""Verify native phase evidence offline, without opening a project or acquiring a lease.

Arguments: fixture evidence directory, output JSON. Relative exports may also be
resolved through the package's export-index.json (deduplicated XML payloads).
"""
import hashlib
import json
import sys
import zipfile
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
        positive=label in ('mapping-after-setter','mapping-before-save','mappedread-saved-reopen','mappedread-final','mapped-supplement-saved-before-build','mapped-supplement-saved-after-build')
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
        label={'mapped-supplement-saved-build':'mapped-supplement-saved-before-build','supplement-saved-build':'supplement-saved-before-build','control-baseline-build':'control-open-uncompiled','controlread-saved-build':'controlread-reopened-uncompiled',
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
        elif finish['scenario'] in ('supplement','mapped-supplement'):
            mode=finish['scenario']
            mapped=mode=='mapped-supplement'
            group='mapping' if mapped else 'control'
            history=get('historical-'+group)
            packaged_history=folder.parent/'history'/(group+'.zip')
            arc=packaged_history if packaged_history.is_file() else Path(history['archive'])
            assert sha(arc)==history['archiveSha256']
            with zipfile.ZipFile(arc) as z:
                def historical(label):
                    name=label+'-state.json'
                    data=z.read(group+'/'+name)
                    assert hashlib.sha256(data).hexdigest()==history['rawEvidenceHashes'][name]
                    return json.loads(data)
                if mapped:
                    b,c=map(historical,('mapping-before-save','mappedread-saved-reopen'))
                    chain=[b,c]
                else:
                    a,b,c=map(historical,('control-open-uncompiled','control-compiled-unsaved','controlread-reopened-uncompiled'))
                    transition(a,b,shape='appear')
                    chain=[a,b,c]
            now=states[mode+'-saved-before-build']; final=states[mode+'-saved-after-build']
            transition(b,c,positive=mapped,cross=True,shape='saved-placement')
            transition(c,now,positive=mapped,cross=True,shape='saved-placement' if mapped else 'same')
            transition(now,final,positive=mapped)
            behavior=get(mode+'-behavior')
            assert behavior['guids']==[derived(v) for v in chain+[now,final]]
            assert behavior['supplementOperationId']==origin['operationId'] and behavior['oldOperationId']==history['operationId']
            result=results[mode]
            assert result['save']==result['setter']==0 and result['compile']==1
            compile_result=compiles[mode+'-saved-build']
            assert compile_result['passed'] and compile_result['persistedInput']
            assert result['engine']['creationUtcTicks'] not in history['starts']
            assert result['afterClose']==result['diskBefore']==history['disk']==finish['mainFileSha256']==compile_result['disk']
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
        if issue is None and rr['error']['message']=='Compiled device is not the appended child':
            transition(states['control-compiled-unsaved'],states['controlread-reopened-uncompiled'],cross=True,shape='saved-placement')
            comparisons['oldRejection']='Archived position refusal; re-evaluated offline by the corrected guard'
        else:
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
    if 'mappedread-saved-reopen' in states:
        key_names=('mapping-before','mapping-compiled-baseline','mapping-same-handle-prewrite',
                   'mapping-after-setter','mapping-before-save','mappedread-saved-reopen')
        a,b,pre,imm,presave,reopened=[states[n] for n in key_names]
        transition(a,b,shape='appear')
        transition(b,pre)
        transition(pre,imm,positive=True,setting=True)
        transition(imm,presave,positive=True)
        receipt=results['mapping']
        checking=results['mappedread']
        disk=receipt['afterClose']
        assert receipt['status']=='succeeded' and receipt['closed'] and receipt['exit']['code']==0
        assert receipt['setter']==receipt['save']==1 and receipt['compile']==2
        assert receipt['diskBefore']!=disk==checking['diskBefore']==checking['afterClose']
        assert observations['mappedread-saved-reopen']['capture']['disk']==disk
        assert get('mapping-dispatch')['expression']==mapping_expression(pre)
        behavior=get('control-proof')['behavior']
        actual_refusal=None
        try:
            transition(presave,reopened,positive=True,cross=True,shape=behavior['reopen'])
        except ValueError as err:
            actual_refusal=str(err)
        if checking['status']=='failed':
            if origin['operationId']=='e81c282d-d409-4c1d-b2f7-a311d92cbec0':
                assert checking['error']['message']=='Saved position would cross different siblings' and actual_refusal is None
            else:
                assert actual_refusal and actual_refusal==checking['error']['message']
            assert checking['closed'] and checking['exit']['code']==checking['save']==checking['setter']==checking['compile']==0
            assert not passes and not (folder/'mappedread-saved-build.json').exists()
            assert get('probe-stopped')['uncertain'] is False
        else:
            assert actual_refusal is None
        gid=derived(presave)
        assert gid==derived(reopened)
        parent=next(n['parentGuid'] for n in presave['nativeTree'] if n['guid']==gid)
        comparisons['mappingReopen']={
            'beforeChildren':[n for n in presave['nativeTree'] if n['parentGuid']==parent],
            'afterChildren':[n for n in reopened['nativeTree'] if n['parentGuid']==parent],
            'mappingExportShaBefore':presave['export']['exportSha256'],
            'mappingExportShaReopened':reopened['export']['exportSha256'],
            'channelRowsIdentical':presave['snapshot']['channels']==reopened['snapshot']['channels'],
            'completeMappingListsIdentical':presave['export']['rows']==reopened['export']['rows'],
            'programEvidence':{k:presave[k]==reopened[k] for k in ('tasks','sources','sourceSnapshot','declaration','applications')},
            'byNativeIdentity':{},'fullScanOrderIdentical':{},'originalError':checking['error'],'currentOfflineRefusal':actual_refusal}
        for section,key in (('devices',lambda d:d['guid']['value']),
                            ('connectors',lambda c:(c['enumeratedFromDeviceGuid'],c['fields']['connector_id']['value']))):
            old,new=presave['snapshot'][section],reopened['snapshot'][section]
            comparisons['mappingReopen']['byNativeIdentity'][section]=index(old,key)==index(new,key)
            comparisons['mappingReopen']['fullScanOrderIdentical'][section]=old==new
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
