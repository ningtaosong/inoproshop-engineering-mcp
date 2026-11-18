param(
    [Parameter(Mandatory=$true)][string]$Fixture,
    [Parameter(Mandatory=$true)][ValidateSet('prepare','read')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Executable
)
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($Fixture)
if($fixture -notmatch '^D:\\InoPro-S7-ReferenceProbe-[0-9-]+$'){throw 'Dedicated S7 fixture required'}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script=Join-Path $PSScriptRoot 'semantic-reference-native.py'
$project=Join-Path $fixture 'engineering\AM610_S7_ReferenceProbe.project'
$seed='89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
$origin=Get-Content -Raw -LiteralPath (Join-Path $fixture 'fixture-origin.json')|ConvertFrom-Json
if($origin.seedSha256 -ne $seed -or $origin.project -ne $project){throw 'Fixture binding changed; no open'}
if((Split-Path -Leaf $Executable) -ne 'InoProShop.exe' -or (Get-Item -LiteralPath $Executable).VersionInfo.FileVersion -ne '1.9.1.6'){
    throw 'Verified native IDE required'
}
$intent=Join-Path $fixture ($Mode+'-launcher-intent.json')
if(Test-Path -LiteralPath $intent){throw 'Native pass already launched; no replay'}
$fingerprints=[ordered]@{}
foreach($rel in 'scripts/probes/semantic-reference-native.py','scripts/probes/semantic-reference-fixture.json','scripts/probes/device_add_preflight.py','bridge/worker.py','bridge/device_catalog.py'){
    $fingerprints[$rel]=(Get-FileHash -LiteralPath (Join-Path $repo $rel)).Hash.ToLowerInvariant()
}
$expected=$seed
if($Mode -eq 'read'){
    $prior=Get-Content -Raw -LiteralPath (Join-Path $fixture 'prepare-launcher-exit.json')|ConvertFrom-Json
    $priorIntent=Get-Content -Raw -LiteralPath (Join-Path $fixture 'prepare-launcher-intent.json')|ConvertFrom-Json
    $priorResult=Get-Content -Raw -LiteralPath (Join-Path $fixture 'prepare-result.json')|ConvertFrom-Json
    if(!$prior.completed -or $prior.exitCode -ne 0 -or $priorResult.status -ne 'succeeded' -or !$priorResult.projectClosed -or !$priorResult.saveAttempted){
        throw 'Preparation did not complete cleanly; no read pass'
    }
    $expected=$priorResult.diskAfter
    foreach($rel in $fingerprints.Keys){
        if($priorIntent.fingerprints.$rel -ne $fingerprints[$rel]){throw 'Preparation used different sources'}
    }
}
if((Get-FileHash -LiteralPath $project).Hash -ne $expected){throw 'Fixture hash changed; no open'}
$owners=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe' OR Name LIKE 'InoProShop%' OR Name='node.exe'" |
    Where-Object {$_.Name -ne 'node.exe' -or $_.CommandLine -match 's6a-daily-fixed-029|s5b-daily-fixed-028|observe-daily\.mjs'})
if($owners.Count){throw 'Possible desktop, IDE or service owner present; no parallel launch'}
[ordered]@{mode=$Mode;project=$project;fixtureSha256=$expected;fingerprints=$fingerprints;when=(Get-Date -Format o)} |
    ConvertTo-Json | Set-Content -LiteralPath $intent -Encoding utf8NoBOM
$priorRoot=$env:INOPRO_S7_PROBE_ROOT
$priorRepo=$env:INOPRO_S7_PROBE_REPO
$priorMode=$env:INOPRO_S7_PROBE_MODE
try{
    $env:INOPRO_S7_PROBE_ROOT=$fixture
    $env:INOPRO_S7_PROBE_REPO=$repo
    $env:INOPRO_S7_PROBE_MODE=$Mode
    $native=Start-Process -FilePath $Executable -ArgumentList ('--profile="InoProShop(V1.9.1.6)" --runscript="'+$script+'"') `
        -WorkingDirectory (Split-Path $Executable) -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $fixture ($Mode+'-stdout.txt')) `
        -RedirectStandardError (Join-Path $fixture ($Mode+'-stderr.txt'))
    $started=$native.StartTime
    $ticks=$started.ToUniversalTime().Ticks.ToString()
    [ordered]@{pid=$native.Id;creation=$started;creationUtcTicks=$ticks;mode=$Mode}|ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-start.json')) -Encoding utf8NoBOM
    if(!$native.WaitForExit(150000)){
        [ordered]@{pid=$native.Id;creationUtcTicks=$ticks;status='unconfirmed';windowTitle=$native.MainWindowTitle;when=(Get-Date -Format o)} |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-wait-unconfirmed.json')) -Encoding utf8NoBOM
        throw 'IDE exit unconfirmed; no dismissal, forced exit or next pass'
    }
    $resultPath=Join-Path $fixture ($Mode+'-result.json')
    $result=if(Test-Path -LiteralPath $resultPath){Get-Content -Raw -LiteralPath $resultPath|ConvertFrom-Json}else{$null}
    $sameInstance=$null -ne $result -and $result.engine.pid -eq $native.Id -and $result.engine.creationUtcTicks -eq $ticks
    $completed=$native.ExitCode -eq 0 -and $sameInstance -and $result.status -eq 'succeeded' -and $result.projectClosed
    [ordered]@{pid=$native.Id;creationUtcTicks=$ticks;exitCode=$native.ExitCode;completed=$completed;resultPresent=($null -ne $result);
        sameInstance=$sameInstance;projectClosed=[bool]$result.projectClosed;status=$result.status;when=(Get-Date -Format o)} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-exit.json')) -Encoding utf8NoBOM
    if(!$completed){throw 'Native sequence not confirmed; no next pass'}
}finally{
    $env:INOPRO_S7_PROBE_ROOT=$priorRoot
    $env:INOPRO_S7_PROBE_REPO=$priorRepo
    $env:INOPRO_S7_PROBE_MODE=$priorMode
}
