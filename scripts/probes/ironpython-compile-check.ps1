param([Parameter(Mandatory=$true)][string]$Manifest,[Parameter(Mandatory=$true)][string]$Output)
# Compile only: never Execute original/native source bodies. Windows PowerShell/.NET Framework.
$ErrorActionPreference='Stop'
$runtime='D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10'
$dll=Join-Path $runtime 'IronPython.dll'
$expected='dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf'
if ((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'IronPython runtime fingerprint differs'}
$assemblies=@()
foreach($name in @('Microsoft.Scripting.Metadata.dll','Microsoft.Scripting.dll','Microsoft.Dynamic.dll','IronPython.dll','IronPython.Modules.dll')){
  $file=Join-Path $runtime $name
  $assembly=[Reflection.Assembly]::LoadFrom($file)
  $assemblies+=@{path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();assemblyVersion=$assembly.GetName().Version.ToString()}
}
$engine=[IronPython.Hosting.Python]::CreateEngine()
if ($engine.LanguageVersion.ToString() -ne '2.7.7.0'){throw 'Unexpected language version'}
$spec=Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$records=@()
foreach($item in $spec.files){
  $record=[ordered]@{path=$item.path;sha256=(Get-FileHash -LiteralPath $item.path -Algorithm SHA256).Hash.ToLowerInvariant();expectedCompile=$item.expectedCompile;compiled=$false;bodyExecuted=$false}
  if($record.sha256 -ne $item.sha256){throw ('Source fingerprint differs: '+$item.path)}
  try {
    $source=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($item.path,[Text.Encoding]::UTF8),$item.path,[Microsoft.Scripting.SourceCodeKind]::File)
    $null=$source.Compile()
    $record.compiled=$true
  } catch {
    $chain=@();$errorItem=$_.Exception
    while($null -ne $errorItem){
      $detail=[ordered]@{type=$errorItem.GetType().FullName;message=$errorItem.Message;stack=$errorItem.StackTrace}
      foreach($field in @('Line','Column','ErrorCode')){if($errorItem.PSObject.Properties[$field]){$detail[$field]=$errorItem.$field}}
      $chain+=,$detail;$errorItem=$errorItem.InnerException
    }
    $record.exceptions=$chain
  }
  $record.matchedExpectation=($record.compiled -eq $item.expectedCompile)
  if($item.expectedMessage){$record.matchedExpectation=$record.matchedExpectation -and (@($record.exceptions | Where-Object {$_.message.Contains([string]$item.expectedMessage)}).Count -gt 0)}
  $records+=,$record
}
$synthetic=$null
if($spec.syntheticTest){
  if([IO.Path]::GetFileName($spec.syntheticTest.path) -ne 'test_probe_fixed_helpers.py'){throw 'Only the audited synthetic helper suite may execute'}
  foreach($file in $spec.syntheticTest.modules){if((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Synthetic module fingerprint differs'}}
  if((Get-FileHash -LiteralPath $spec.syntheticTest.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.syntheticTest.sha256){throw 'Synthetic test fingerprint differs'}
  $search=[Collections.Generic.List[string]]::new()
  $search.Add([IO.Path]::GetDirectoryName($spec.syntheticTest.path))
  $search.Add('D:\InProShop\CODESYS\ScriptLib\3.5.10.40')
  $engine.SetSearchPaths($search)
  $scope=$engine.CreateScope();$scope.SetVariable('__name__','probe_offline_tests')
  $scope.SetVariable('__file__',$spec.syntheticTest.path)
  $testCode=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($spec.syntheticTest.path,[Text.Encoding]::UTF8),$spec.syntheticTest.path,[Microsoft.Scripting.SourceCodeKind]::File).Compile()
  $null=$testCode.Execute($scope)
  $synthetic=$engine.Operations.Invoke($scope.GetVariable('run_cases_json')) | ConvertFrom-Json
}
$engine.Runtime.Shutdown()
$result=@{languageVersion='2.7.7.0';powershellVersion=$PSVersionTable.PSVersion.ToString();clrVersion=[Environment]::Version.ToString();assemblies=$assemblies;manifestSha256=(Get-FileHash -LiteralPath $Manifest -Algorithm SHA256).Hash.ToLowerInvariant();compileOnly=($null -eq $synthetic);originalNativeBodiesExecuted=$false;records=$records;syntheticTests=$synthetic;passed=(@($records | Where-Object {-not $_.matchedExpectation}).Count -eq 0 -and ($null -eq $synthetic -or $synthetic.passed))}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Depth 20))
$stream=[IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
[pscustomobject]$result | Select-Object languageVersion,compileOnly,passed | ConvertTo-Json -Compress
if(-not $result.passed){exit 1}
