param([string]$Repo,[string]$Output)
$ErrorActionPreference='Stop'
$lib='D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10'
$dll=Join-Path $lib 'IronPython.dll'
if((Get-FileHash -LiteralPath $dll).Hash.ToLowerInvariant() -ne 'dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf'){throw 'Runtime differs'}
foreach($n in @('Microsoft.Scripting.Metadata.dll','Microsoft.Scripting.dll','Microsoft.Dynamic.dll','IronPython.dll','IronPython.Modules.dll')){$null=[Reflection.Assembly]::LoadFrom((Join-Path $lib $n))}
$engine=[IronPython.Hosting.Python]::CreateEngine()
$record=[ordered]@{languageVersion=$engine.LanguageVersion.ToString();runtimeSha256=(Get-FileHash $dll).Hash.ToLowerInvariant();compiled=@();passed=$false;ideLaunched=$false}
try {
 $paths=[Collections.Generic.List[string]]::new();$paths.Add('D:\InProShop\CODESYS\ScriptLib\3.5.10.40');$paths.Add((Join-Path $Repo 'bridge'));$paths.Add((Join-Path $Repo 'tests'));$engine.SetSearchPaths($paths)
 foreach($n in @('bridge\resident_core.py','bridge\resident_host.py','tests\test_resident_core.py','tests\test_resident_build.py','tests\test_resident_build_library.py','tests\test_resident_scalar_context.py','tests\test_resident_autosave.py')){
  $p=Join-Path $Repo $n;$code=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($p,[Text.Encoding]::UTF8),$p,[Microsoft.Scripting.SourceCodeKind]::File).Compile()
  $record.compiled+=@{path=$p;sha256=(Get-FileHash $p).Hash.ToLowerInvariant()}
 }
 $hostPath=Join-Path $Repo 'bridge\resident_host.py';$hostScope=$engine.CreateScope();$hostScope.SetVariable('__name__','offline_resident_host');$hostScope.SetVariable('__file__',$hostPath)
 $null=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($hostPath,[Text.Encoding]::UTF8),$hostPath,[Microsoft.Scripting.SourceCodeKind]::File).Execute($hostScope)
 $hostScope.SetVariable('core_path',(Join-Path $Repo 'bridge\resident_core.py'));$hostScope.SetVariable('core_hash',(Get-FileHash (Join-Path $Repo 'bridge\resident_core.py')).Hash.ToLowerInvariant())
 $null=$engine.Execute("import types`nloaded=load_fixed(core_path,core_hash,'offline_loaded_core')`nloaded_module=types.ModuleType('offline_loaded_core')`nloaded_module.__dict__.update(loaded)",$hostScope)
 $record.actualFixedLoader=$true
 $test=Join-Path $Repo 'tests\test_resident_core.py';$scope=$engine.CreateScope();$scope.SetVariable('__name__','offline_resident_tests');$scope.SetVariable('__file__',$test)
 $null=$engine.CreateScriptSourceFromString([IO.File]::ReadAllText($test,[Text.Encoding]::UTF8),$test,[Microsoft.Scripting.SourceCodeKind]::File).Execute($scope)
 $scope.SetVariable('c',$hostScope.GetVariable('loaded_module'))
 $null=$engine.Execute("import StringIO`nstream=StringIO.StringIO()`nsuite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(Cases),unittest.defaultTestLoader.loadTestsFromTestCase(PublicAdapterCases)])`nresult=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)`nresult_json=json.dumps(dict(count=result.testsRun,passed=result.wasSuccessful(),log=stream.getvalue()),ensure_ascii=True)",$scope)
 $record.tests=$scope.GetVariable('result_json')|ConvertFrom-Json;$record.passed=$record.tests.passed
 $null=$engine.Execute("import test_resident_build as build_tests`nbuild_tests.c=c`nstream=StringIO.StringIO()`nsuite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(build_tests.BuildCases),unittest.defaultTestLoader.loadTestsFromTestCase(build_tests.NativeCompileCases)])`nresult=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)`nresult_json=json.dumps(dict(count=result.testsRun,passed=result.wasSuccessful(),log=stream.getvalue()),ensure_ascii=True)",$scope)
 $record.buildTests=$scope.GetVariable('result_json')|ConvertFrom-Json;$record.passed=$record.passed -and $record.buildTests.passed
 $null=$engine.Execute("import test_resident_build_library as library_tests`nlibrary_tests.c=c`nstream=StringIO.StringIO()`nsuite=unittest.defaultTestLoader.loadTestsFromTestCase(library_tests.LibraryCases)`nresult=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)`nresult_json=json.dumps(dict(count=result.testsRun,passed=result.wasSuccessful(),log=stream.getvalue()),ensure_ascii=True)",$scope)
 $record.libraryTests=$scope.GetVariable('result_json')|ConvertFrom-Json;$record.passed=$record.passed -and $record.libraryTests.passed
 $null=$engine.Execute("import test_resident_scalar_context as scalar_tests`nscalar_tests.c=c`nstream=StringIO.StringIO()`nsuite=unittest.defaultTestLoader.loadTestsFromTestCase(scalar_tests.ScalarContextCases)`nresult=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)`nresult_json=json.dumps(dict(count=result.testsRun,passed=result.wasSuccessful(),log=stream.getvalue()),ensure_ascii=True)",$scope)
 $record.scalarTests=$scope.GetVariable('result_json')|ConvertFrom-Json;$record.passed=$record.passed -and $record.scalarTests.passed
 $null=$engine.Execute("import test_resident_autosave as saved_tests`nsaved_tests.c=c`nsaved_tests.f.c=c`nstream=StringIO.StringIO()`nsuite=unittest.defaultTestLoader.loadTestsFromTestCase(saved_tests.SaveCases)`nresult=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)`nresult_json=json.dumps(dict(count=result.testsRun,passed=result.wasSuccessful(),log=stream.getvalue()),ensure_ascii=True)",$scope)
 $record.savedTests=$scope.GetVariable('result_json')|ConvertFrom-Json;$record.passed=$record.passed -and $record.savedTests.passed
}catch{$record.error=$_.Exception.ToString()}finally{$engine.Runtime.Shutdown()}
[IO.File]::WriteAllText($Output,($record|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));[pscustomobject]@{languageVersion=$record.languageVersion;passed=$record.passed;error=$record.error}|ConvertTo-Json -Depth 3
if(-not $record.passed){exit 1}
