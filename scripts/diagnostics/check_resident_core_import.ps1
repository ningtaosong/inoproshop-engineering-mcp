param([Parameter(Mandatory=$true)][string]$Repo,[Parameter(Mandatory=$true)][string]$Output)
# Offline IronPython namespace registration only. No IDE, engine getter,
# project, command execution, event subscription, or product service.
$ErrorActionPreference='Stop'
$lib='D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10'
$dll=Join-Path $lib 'IronPython.dll'
$corePath='D:\InProShop\CODESYS\Common\Core.dll'
if((Get-FileHash $dll).Hash.ToLowerInvariant() -ne 'dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf'){throw 'IronPython changed'}
if((Get-FileHash $corePath).Hash.ToLowerInvariant() -ne 'b9169084ad15230ea9be121d026d80a2a4f71e020c424959dd2090385e8430ca'){throw 'Core changed'}
if(Test-Path -LiteralPath $Output){throw 'Do not overwrite previous evidence'}
foreach($n in @('Microsoft.Scripting.Metadata.dll','Microsoft.Scripting.dll','Microsoft.Dynamic.dll','IronPython.dll','IronPython.Modules.dll')){$null=[Reflection.Assembly]::LoadFrom((Join-Path $lib $n))}
$core=[Reflection.Assembly]::LoadFrom($corePath)
$engine=[IronPython.Hosting.Python]::CreateEngine()
$paths=[Collections.Generic.List[string]]::new();$paths.Add('D:\InProShop\CODESYS\ScriptLib\3.5.10.40');$engine.SetSearchPaths($paths)
$scope=$engine.CreateScope()
$record=[ordered]@{at=[DateTime]::UtcNow.ToString('o');languageVersion=$engine.LanguageVersion.ToString();runtimeSha256=(Get-FileHash $dll).Hash.ToLowerInvariant();coreSha256=(Get-FileHash $corePath).Hash.ToLowerInvariant();ideLaunched=$false;enginePropertyAccessed=$false;objectManagerAccessed=$false;compiled=@();passed=$false}
try {
 foreach($relative in @('scripts\diagnostics\resident_save_observer.py','scripts\diagnostics\resident_save_probe_entry.py','bridge\resident_host.py','bridge\resident_core.py')){
  $p=Join-Path $Repo $relative
  $null=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($p,[Text.Encoding]::UTF8),$p,[Microsoft.Scripting.SourceCodeKind]::File).Compile()
  $record.compiled+=@{path=$p;sha256=(Get-FileHash $p).Hash.ToLowerInvariant();compiled=$true}
 }
 try {
  $null=$engine.Execute("import clr`nfrom _3S.CoDeSys.Core import SystemInstances",$scope)
  $record.before=@{importPassed=$true}
 }catch{$record.before=@{importPassed=$false;error=$_.Exception.ToString()}}
 $observer=Join-Path $Repo 'scripts\diagnostics\resident_save_observer.py'
 $scope.SetVariable('__name__','offline_save_observer');$scope.SetVariable('__file__',$observer)
 $null=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($observer,[Text.Encoding]::UTF8),$observer,[Microsoft.Scripting.SourceCodeKind]::File).Execute($scope)
 # Execute the actual corrected loader; do not execute install or any getters.
 $null=$engine.Execute("public_type=load_public_system_instances()`nactual_type=clr.GetClrType(public_type)`nactual_name=actual_type.FullName`nactual_assembly=actual_type.Assembly.FullName",$scope)
 $record.after=@{importPassed=$true;actualHelperExecuted=$true;typeName=$scope.GetVariable('actual_name');assembly=$scope.GetVariable('actual_assembly')}
 $record.passed=(!$record.before.importPassed -and $record.before.error.Contains('No module named _3S.CoDeSys.Core') -and $record.after.typeName -eq '_3S.CoDeSys.Core.SystemInstances' -and $record.after.assembly -eq $core.FullName)
}catch{$record.error=$_.Exception.ToString()}finally{$engine.Runtime.Shutdown()}
[IO.File]::WriteAllText($Output,($record|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{languageVersion=$record.languageVersion;beforeImport=$record.before.importPassed;afterImport=$record.after.importPassed;compiled=$record.compiled.Count;passed=$record.passed;error=$record.error}|ConvertTo-Json
if(!$record.passed){exit 1}
