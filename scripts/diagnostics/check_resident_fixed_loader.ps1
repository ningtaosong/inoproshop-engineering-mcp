param([Parameter(Mandatory=$true)][string]$Probe,[Parameter(Mandatory=$true)][string]$Module,[Parameter(Mandatory=$true)][string]$Output)
# Offline installed-runtime test only; no IDE launch, start(), or project objects.
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Output){throw 'Evidence output already exists'}
$runtime='D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10'
$dll=Join-Path $runtime 'IronPython.dll'
if((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf'){throw 'Installed runtime fingerprint differs'}
$assemblies=@()
foreach($name in @('Microsoft.Scripting.Metadata.dll','Microsoft.Scripting.dll','Microsoft.Dynamic.dll','IronPython.dll','IronPython.Modules.dll')){
  $path=Join-Path $runtime $name
  $assembly=[Reflection.Assembly]::LoadFrom($path)
  $assemblies+=@{path=$path;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();version=$assembly.GetName().Version.ToString()}
}
$test=Join-Path $PSScriptRoot 'test_resident_fixed_loader.py'
$inputs=@($Probe,$Module,$test,$PSCommandPath) | ForEach-Object { @{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()} }
$engine=[IronPython.Hosting.Python]::CreateEngine()
$record=[ordered]@{languageVersion=$engine.LanguageVersion.ToString();powershellVersion=$PSVersionTable.PSVersion.ToString();assemblies=$assemblies;inputs=$inputs;nativeEntryExecuted=$false;engineeringCalls=0;passed=$false}
try{
  if($record.languageVersion -ne '2.7.7.0'){throw 'Unexpected language version'}
  $paths=[Collections.Generic.List[string]]::new();$paths.Add('D:\InProShop\CODESYS\ScriptLib\3.5.10.40');$engine.SetSearchPaths($paths)
  $scope=$engine.CreateScope();$scope.SetVariable('__name__','offline_fixed_loader_tests');$scope.SetVariable('__file__',$test)
  # Only the audited test definitions execute here. They invoke the ORIGINAL
  # load_fixed function on raw files; ReadAllText is not the loader under test.
  $code=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($test,[Text.Encoding]::UTF8),$test,[Microsoft.Scripting.SourceCodeKind]::File).Compile()
  $null=$code.Execute($scope)
  $scope.SetVariable('probe_path',$Probe);$scope.SetVariable('module_path',$Module)
  $invoke=@'
try:
    result_json=run_cases_json(probe_path,module_path)
except Exception:
    result_json=json.dumps(dict(passed=False,firstPythonException=traceback.format_exc()),ensure_ascii=True)
'@
  $null=$engine.Execute($invoke,$scope)
  $record.tests=$scope.GetVariable('result_json') | ConvertFrom-Json
  foreach($input in $inputs){if((Get-FileHash -LiteralPath $input.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $input.sha256){throw 'Test input changed during execution'}}
  $record.passed=$record.tests.passed
}catch{
  $record.firstException=$_.Exception.ToString()
}finally{
  $engine.Runtime.Shutdown()
}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 24))
$stream=[IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
[ordered]@{languageVersion=$record.languageVersion;passed=$record.passed;count=$record.tests.count;failed=@($record.tests.cases | Where-Object {-not $_.passed} | ForEach-Object {$_.name});firstException=$record.firstException} | ConvertTo-Json -Depth 4
if(-not $record.passed){exit 1}
