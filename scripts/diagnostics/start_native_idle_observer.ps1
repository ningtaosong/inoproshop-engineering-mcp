param(
 [Parameter(Mandatory=$true)][string]$Node,
 [Parameter(Mandatory=$true)][string]$Observer,
 [Parameter(Mandatory=$true)][string]$Intent,
 [Parameter(Mandatory=$true)][string]$Receipt,
 [switch]$Launch
)
# Preparation is the default. One explicit launch is reviewed separately.
# Break away from an outer job so ending the invocation cannot clean up the IDE.
# Failure to obtain this process relationship is a stop, never a fallback.
$ErrorActionPreference='Stop'
foreach($p in @($Node,$Observer,$Intent,$Receipt)){
 if(-not [IO.Path]::IsPathRooted($p) -or $p.Contains('"') -or $p.Contains("`r") -or $p.Contains("`n")){throw 'Invalid absolute argument'}
}
if(-not (Test-Path -LiteralPath $Node) -or -not (Test-Path -LiteralPath $Observer) -or -not (Test-Path -LiteralPath $Intent)){throw 'Input missing'}
$line='"'+$Node+'" "'+$Observer+'" "'+$Intent+'"'
if(-not $Launch){@{command=$line;cwd='D:\InProShop\CODESYS\Common';flags='CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW';launched=$false}|ConvertTo-Json;return}
if(Test-Path -LiteralPath $Receipt){throw 'Launch receipt exists; no repeated launch'}
$reservation=[IO.File]::Open(($Receipt+'.launch-reservation'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$reservation.Dispose()
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class NoProjectObserverProcess {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]public struct STARTUPINFO {
  public int cb;public string reserved,desktop,title;public int x,y,xSize,ySize,xCount,yCount,fill,dwFlags;
  public short show,cbReserved;public IntPtr lpReserved,hInput,hOutput,hError;
 }
 [StructLayout(LayoutKind.Sequential)]public struct PROCESS_INFORMATION {public IntPtr process,thread;public int pid,tid;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool CreateProcess(
  string application,StringBuilder command,IntPtr procAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
}
'@
$si=New-Object NoProjectObserverProcess+STARTUPINFO
$si.cb=[Runtime.InteropServices.Marshal]::SizeOf($si);$si.dwFlags=1;$si.show=0
$pi=New-Object NoProjectObserverProcess+PROCESS_INFORMATION
$record=[ordered]@{atUtc=[DateTime]::UtcNow.ToString('o');command=$line;cwd='D:\InProShop\CODESYS\Common';flags='0x09000200';parentPid=$PID;launched=$false;
 intentPath=[IO.Path]::GetFullPath($Intent);intentSha256=(Get-FileHash -LiteralPath $Intent).Hash.ToLowerInvariant();
 observerPath=[IO.Path]::GetFullPath($Observer);observerSha256=(Get-FileHash -LiteralPath $Observer).Hash.ToLowerInvariant();
 nodePath=[IO.Path]::GetFullPath($Node);nodeSha256=(Get-FileHash -LiteralPath $Node).Hash.ToLowerInvariant();
 launcherPath=$PSCommandPath;launcherSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()}
try {
 $ok=[NoProjectObserverProcess]::CreateProcess($Node,[Text.StringBuilder]::new($line),[IntPtr]::Zero,[IntPtr]::Zero,$false,0x09000200,[IntPtr]::Zero,$record.cwd,[ref]$si,[ref]$pi)
 if(-not $ok){throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())}
 $record.launched=$true;$record.pid=$pi.pid
 $job=$false;if(-not [NoProjectObserverProcess]::IsProcessInJob($pi.process,[IntPtr]::Zero,[ref]$job)){throw 'Cannot confirm observer job membership'}
 $record.inJob=$job;$record.startId=(Get-Process -Id $pi.pid).StartTime.ToUniversalTime().Ticks.ToString()
 if($job){throw 'Observer was launched in a Job; startup independence is not confirmed'}
}catch{$record.error=@{type=$_.Exception.GetType().FullName;message=$_.Exception.Message};throw}
finally{
 if($pi.thread -ne [IntPtr]::Zero){$null=[NoProjectObserverProcess]::CloseHandle($pi.thread)}
 if($pi.process -ne [IntPtr]::Zero){$null=[NoProjectObserverProcess]::CloseHandle($pi.process)}
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 6));$stream=[IO.File]::Open(($Receipt+'.publishing'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 [IO.File]::Move(($Receipt+'.publishing'),$Receipt)
}
$record|ConvertTo-Json -Depth 6
