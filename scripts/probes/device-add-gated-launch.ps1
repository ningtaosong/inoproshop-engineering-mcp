param(
    [Parameter(Mandatory=$true)][string]$Fixture,
    [Parameter(Mandatory=$true)][ValidateSet('plan','cycle')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Executable
)
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($Fixture)
if($fixture -notmatch '^D:\\InoPro-S6b-DeviceGate-[0-9-]+$'){throw 'Dedicated gated fixture required'}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script=Join-Path $PSScriptRoot 'device-add-gated.py'
$shared=Join-Path $PSScriptRoot 'device_add_preflight.py'
$origin=Get-Content -Raw -LiteralPath (Join-Path $fixture 'fixture-origin.json') | ConvertFrom-Json
$project=Join-Path $fixture 'engineering\AM610_S6b_Gated.project'
$seedHash=$origin.initialProjectSha256
if((Get-FileHash -LiteralPath $project).Hash -ne $seedHash){throw 'Fixture changed; no open'}
if((Split-Path -Leaf $Executable) -ne 'InoProShop.exe' -or (Get-Item -LiteralPath $Executable).VersionInfo.FileVersion -ne '1.9.1.6'){throw 'Verified native IDE required'}
$intent=Join-Path $fixture ($Mode+'-launcher-intent.json')
if(Test-Path -LiteralPath $intent){throw 'Read-only stage was already launched; no replay'}
if(Test-Path -LiteralPath (Join-Path $fixture 'gated-device-dispatched.json')){throw 'Native insert already dispatched; no replay'}
$scriptHash=(Get-FileHash -LiteralPath $script).Hash
$sharedHash=(Get-FileHash -LiteralPath $shared).Hash
$helperHashes=[ordered]@{}
foreach($file in 'device-add-readonly.py','device-add-native.py','../../bridge/worker.py','../../bridge/device_catalog.py'){
    $helperHashes[$file]=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file)).Hash
}
if($Mode -eq 'cycle'){
    $first=Get-Content -Raw -LiteralPath (Join-Path $fixture 'plan-launcher-exit.json')|ConvertFrom-Json
    $firstIntent=Get-Content -Raw -LiteralPath (Join-Path $fixture 'plan-launcher-intent.json')|ConvertFrom-Json
    if(!$first.completed -or !$first.projectClosed -or $first.exitCode -ne 0 -or
       $firstIntent.scriptSha256 -ne $scriptHash -or $firstIntent.sharedSha256 -ne $sharedHash){throw 'First pass or script identity cannot be confirmed'}
    foreach($file in $helperHashes.Keys){
        if($firstIntent.helperHashes.$file -ne $helperHashes[$file]){throw 'First pass used different helpers'}
    }
}
$owners=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe' OR Name LIKE 'InoProShop%' OR Name='node.exe'" |
  Where-Object {$_.Name -ne 'node.exe' -or $_.CommandLine -match 's6a-daily-fixed-029|s5b-daily-fixed-028|observe-daily\.mjs'})
if($owners.Count){throw 'Potential desktop/IDE/service owner present; no launch'}
[ordered]@{mode=$Mode;fixtureSha256=$seedHash;scriptSha256=$scriptHash;sharedSha256=$sharedHash;helperHashes=$helperHashes;when=(Get-Date -Format o)} |
  ConvertTo-Json | Set-Content -LiteralPath $intent -Encoding utf8NoBOM
$priorRoot=$env:INOPRO_S6B_RECHECK_ROOT;$priorRepo=$env:INOPRO_S6B_RECHECK_REPO;$priorMode=$env:INOPRO_S6B_RECHECK_MODE
try{
    $env:INOPRO_S6B_RECHECK_ROOT=$fixture;$env:INOPRO_S6B_RECHECK_REPO=$repo;$env:INOPRO_S6B_RECHECK_MODE=$Mode
    $native=Start-Process -FilePath $Executable -ArgumentList ('--profile="InoProShop(V1.9.1.6)" --runscript="'+$script+'"') -WorkingDirectory (Split-Path $Executable) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture ($Mode+'-stdout.txt')) -RedirectStandardError (Join-Path $fixture ($Mode+'-stderr.txt'))
    [ordered]@{pid=$native.Id;creation=$native.StartTime;mode=$Mode}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-start.json')) -Encoding utf8NoBOM
    $deadline=(Get-Date).AddSeconds(120)
    $resultPath=Join-Path $fixture ($Mode+'-result.json')
    while(!$native.WaitForExit(300) -and (Get-Date) -lt $deadline){
        if(Test-Path -LiteralPath $resultPath){
            $result=Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
            if($result.hasOpenHandle){
                [ordered]@{pid=$native.Id;state='retained-open';notTerminated=$true} | ConvertTo-Json |
                  Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-held.json')) -Encoding utf8NoBOM
                return
            }
        }
    }
    if(!$native.HasExited){
        [ordered]@{pid=$native.Id;state='unknown';notTerminated=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-timeout.json')) -Encoding utf8NoBOM
        throw 'Native result uncertain. No termination or replay.'
    }
    $resultPath=Join-Path $fixture ($Mode+'-result.json')
    $status=if(Test-Path -LiteralPath $resultPath){Get-Content -Raw -LiteralPath $resultPath|ConvertFrom-Json}else{$null}
    [ordered]@{pid=$native.Id;exitCode=$native.ExitCode;completed=($status.status -eq 'succeeded');
      projectClosed=[bool]$status.state.closed;resultPresent=[bool]$status;nativeStatus=$status.status} |
      ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-exit.json')) -Encoding utf8NoBOM
    if($native.ExitCode -ne 0 -or !$status){throw 'Native stage did not publish a confirmed result'}
}finally{
    $env:INOPRO_S6B_RECHECK_ROOT=$priorRoot;$env:INOPRO_S6B_RECHECK_REPO=$priorRepo;$env:INOPRO_S6B_RECHECK_MODE=$priorMode
}
