param(
    [Parameter(Mandatory=$true)][string]$Fixture,
    [Parameter(Mandatory=$true)][ValidateSet('read','insert')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Executable
)
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($Fixture)
if($fixture -notmatch '^D:\\InoPro-S6b-DeviceAdd-[0-9-]+$'){throw 'Dedicated disposable fixture only'}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script=Join-Path $PSScriptRoot 'device-add-native.py'
if(!(Test-Path -LiteralPath $Executable -PathType Leaf) -or (Split-Path -Leaf $Executable) -ne 'InoProShop.exe'){throw 'Native InoProShop.exe required'}
$known=(Get-Item -LiteralPath $Executable).VersionInfo.FileVersion
if($known -ne '1.9.1.6'){throw 'Only the verified native IDE version is eligible'}
if(Test-Path -LiteralPath (Join-Path $fixture 'device-insert-dispatched.json')){throw 'Previous write dispatched; no replay'}
$startedPath=Join-Path $fixture ($Mode+'-launcher-intent.json')
if(Test-Path -LiteralPath $startedPath){throw 'Do not replay a native process stage'}
if($Mode -eq 'insert' -and !(Test-Path -LiteralPath (Join-Path $fixture 'plan.json') -PathType Leaf)){throw 'Explicit plan required'}
$owners=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe' OR Name LIKE 'InoProShop%' OR Name='node.exe'" |
  Where-Object {$_.Name -ne 'node.exe' -or $_.CommandLine -match 's6a-daily-fixed-029|s5b-daily-fixed-028|observe-daily\.mjs'})
if($owners.Count){throw 'Potential IDE/service owner present; no launch'}
$proj=Join-Path $fixture 'AM610_S6b_Probe.project'
$seed=(Get-Content -Raw -LiteralPath (Join-Path $fixture 'fixture-origin.json')|ConvertFrom-Json).initialProjectSha256
if((Get-FileHash -LiteralPath $proj).Hash -ne $seed){throw 'Fixture changed; no launch'}
[ordered]@{mode=$Mode;fileSha256=$seed;scriptSha256=(Get-FileHash -LiteralPath $script).Hash;ideVersion=$known;when=(Get-Date -Format o)} | ConvertTo-Json | Set-Content -LiteralPath $startedPath -Encoding utf8NoBOM
$priorRoot=$env:INOPRO_S6B_PROBE_ROOT;$priorRepo=$env:INOPRO_S6B_PROBE_REPO;$priorMode=$env:INOPRO_S6B_PROBE_MODE
try{
    $env:INOPRO_S6B_PROBE_ROOT=$fixture;$env:INOPRO_S6B_PROBE_REPO=$repo;$env:INOPRO_S6B_PROBE_MODE=$Mode
    $native=Start-Process -FilePath $Executable -ArgumentList ('--profile="InoProShop(V1.9.1.6)" --runscript="'+$script+'"') -WorkingDirectory (Split-Path $Executable) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture ($Mode+'-stdout.txt')) -RedirectStandardError (Join-Path $fixture ($Mode+'-stderr.txt'))
    [ordered]@{pid=$native.Id;creation=$native.StartTime;mode=$Mode}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-start.json')) -Encoding utf8NoBOM
    if(!$native.WaitForExit(120000)){
        [ordered]@{pid=$native.Id;state='unknown';notTerminated=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-timeout.json')) -Encoding utf8NoBOM
        throw 'Native result uncertain. No termination or replay.'
    }
    [ordered]@{pid=$native.Id;exitCode=$native.ExitCode;completedEntry=(Test-Path -LiteralPath (Join-Path $fixture ($Mode+'-complete.json')))}|
      ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($Mode+'-launcher-exit.json')) -Encoding utf8NoBOM
    if($native.ExitCode -ne 0 -or !(Test-Path -LiteralPath (Join-Path $fixture ($Mode+'-complete.json')))){throw 'Native stage not formally complete'}
}finally{
    $env:INOPRO_S6B_PROBE_ROOT=$priorRoot;$env:INOPRO_S6B_PROBE_REPO=$priorRepo;$env:INOPRO_S6B_PROBE_MODE=$priorMode
}
