// Local diagnostics only: never starts MCP/IDE, reads a registry, or changes trust.
import {spawn} from 'node:child_process';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessScriptTrust} from './lib/startup-trust.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const options={};
try {
  for(let i=2;i<process.argv.length;i++) {
    if(process.argv[i]==='--help') {
      console.log('node scripts/check-local-startup.mjs [--script-root <existing-absolute-checkout>] [--probe-dir <new-absolute-directory>]\n'+
        'Checks Windows PowerShell policy/signatures and OS file zones using the OS-native security module.\n'+
        'Optional probes copy and read-lock a new .txt file only. No service/IDE or policy change.');
      process.exit(0);
    }
    const option={'--probe-dir':'probeDir','--script-root':'scriptRoot'}[process.argv[i]];
    if(!option||options[option]||!process.argv[i+1])throw new Error('Unknown/duplicate option or missing value');
    options[option]=process.argv[++i];
    if(!path.isAbsolute(options[option]))throw new Error('Diagnostic paths must be absolute');
  }
  if(process.platform!=='win32')throw new Error('This diagnostic requires Windows; no cross-host fallback');
  const systemRoot=process.env.SystemRoot||process.env.WINDIR;
  if(!systemRoot||!path.isAbsolute(systemRoot))throw new Error('Windows SystemRoot is unavailable');
  const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const scriptRoot=options.scriptRoot??root;
  const scripts=['copy-closed-project.ps1','maintenance-read-lock.ps1'].map(n=>path.join(scriptRoot,'scripts',n));
  const sourceFiles=await Promise.all(scripts.map(async p=>{
    let zone;
    try {zone=await readFile(p+':Zone.Identifier');}
    catch(e) {if(e.code!=='ENOENT')throw e;}
    // Do not print download/referrer URLs, which may contain private tokens.
    const sha256=hash(await readFile(p));
    const bundledSha256=hash(await readFile(path.join(root,'scripts',path.basename(p))));
    return {path:p,sha256,bundledSha256,matchesBundledHelper:sha256===bundledSha256,zoneIdentifierPresent:!!zone,
      zoneIdentifierSha256:zone?hash(zone):null,
      zoneId:zone?.toString('utf8').match(/^ZoneId\s*=\s*(\d+)\s*$/mi)?.[1]??null};
  }));
  if(sourceFiles.some(f=>!f.matchesBundledHelper))throw new Error('Helper contents differ from this diagnostic checkout; no script probe permitted');
  const env={...process.env};
  const parentTemporarySetting=env.PSExecutionPolicyPreference??null;
  // Clear only the diagnostic child's temporary override, never a registry policy
  // or the invoking shell. Do not turn an inherited bypass into a false pass.
  delete env.PSExecutionPolicyPreference;
  env.INOPRO_STARTUP_SCRIPT_PATHS=JSON.stringify(scripts);
  const checks=[];
  async function child(args,input='') {
    const p=spawn(powershell,args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
    p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
    // On a slow process, keep its identity visible; do not retry or terminate it.
    const warning=setTimeout(()=>console.error(JSON.stringify({state:'still-waiting',pid:p.pid,
      message:'Inspect this original diagnostic process; no retry or automatic termination'})),15000);
    let code;
    try {
      code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);p.stdin.on('error',()=>{});p.stdin.end(input);});
    } finally {clearTimeout(warning);}
    const result={pid:p.pid,executable:powershell,args,cwd:root,temporarySettingPassed:null,exitCode:code,stdout,stderr};
    checks.push(result);return result;
  }
  const command=String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
# Explicit native path avoids loading the 7.x module into Windows PowerShell 5.1.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$paths = ConvertFrom-Json $env:INOPRO_STARTUP_SCRIPT_PATHS
$files = @($paths | ForEach-Object {
  $p = $_; $sig = Get-AuthenticodeSignature -LiteralPath $p
  $zone = $null; $zoneError = $null
  try { $zone = [Security.Policy.Zone]::CreateFromUrl(([Uri]$p).AbsoluteUri).SecurityZone.ToString() }
  catch { $zoneError = $_.Exception.Message }
  [ordered]@{path=$p;signatureStatus=$sig.Status.ToString();securityZone=$zone;securityZoneError=$zoneError}
})
[ordered]@{pid=$PID;executable=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;
version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;
securityModulePath=(Get-Module Microsoft.PowerShell.Security).Path;
temporarySetting=$env:PSExecutionPolicyPreference;effectivePolicy=(Get-ExecutionPolicy).ToString();
policies=@(Get-ExecutionPolicy -List | ForEach-Object {[ordered]@{scope=$_.Scope.ToString();policy=$_.ExecutionPolicy.ToString()}});
files=$files} | ConvertTo-Json -Depth 6
`;
  const metadata=await child(['-NoLogo','-NoProfile','-NonInteractive','-Command',command]);
  const result={scope:'Startup diagnostics, not engineering or a service handoff controller',
    root,scriptRoot,node:{executable:process.execPath,version:process.version},parentTemporarySetting,
    machineOrUserPolicyChanged:false,trustChanged:false,serviceStarted:false,sourceFiles,checks};
  if(metadata.exitCode!==0)throw Object.assign(new Error('Native PowerShell metadata unavailable; retain raw error, do not infer policy or continue probes'),{result});
  result.powerShell=JSON.parse(metadata.stdout);
  const ps=result.powerShell;
  if(!Array.isArray(ps.files)||ps.files.length!==scripts.length||
    !ps.files.every(f=>typeof f.path==='string'&&scripts.includes(f.path)&&
      typeof f.signatureStatus==='string'&&['Valid','NotSigned'].includes(f.signatureStatus)))
    throw Object.assign(new Error('Incomplete or untrusted signature metadata; no helper probe accepted'),{result});
  const policyConfirmed=ps.temporarySetting==null||ps.temporarySetting==='';
  if(!policyConfirmed||['Bypass','Unrestricted'].includes(ps.effectivePolicy))
    throw Object.assign(new Error('Ordinary policy was not confirmed; no helper probe accepted'),{result});
  if(!['RemoteSigned','AllSigned'].includes(ps.effectivePolicy))
    throw Object.assign(new Error('Current execution policy does not permit validating these local scripts; no policy change made'),{result});
  if(parentTemporarySetting&&['bypass','unrestricted'].includes(parentTemporarySetting.toLowerCase()))
    throw Object.assign(new Error('Invoking process still has a temporary bypass; diagnostic child is clean, but normal launch is not validated'),{result});
  result.scriptTrust=ps.files.map(f=>({path:f.path,securityZone:f.securityZone,
    ...assessScriptTrust(ps.effectivePolicy,f,sourceFiles.find(s=>s.path===f.path)?.zoneId)}));
  if(result.scriptTrust.some(f=>!f.eligible))throw Object.assign(new Error('Script trust is blocked or unconfirmed; inspect OS zone and signature evidence. No automatic unblock, policy change or alternate-root fallback'),{result});
  if(options.probeDir) {
    await mkdir(options.probeDir); // No recursive creation and no reuse/overwrite.
    const source=path.join(options.probeDir,'startup-source.txt'),copy=path.join(options.probeDir,'startup-copy.txt');
    await writeFile(source,'InoProShop startup diagnostic text only.\n',{flag:'wx'});
    const copied=await child(['-NoProfile','-File',scripts[0],'-SourcePath',source,'-DestinationPath',copy]);
    if(copied.exitCode!==0)throw Object.assign(new Error('Copy helper failed; see original child result'),{result});
    if(hash(await readFile(source))!==hash(await readFile(copy)))throw Object.assign(new Error('Diagnostic text copy mismatch'),{result});
    const held=await child(['-NoProfile','-NonInteractive','-File',scripts[1]],JSON.stringify([source])+'\n\n');
    if(held.exitCode!==0||!held.stdout.includes('{"ready":true}'))throw Object.assign(new Error('Read-only helper failed or readiness unknown'),{result});
    result.probes={directory:options.probeDir,textSha256:hash(await readFile(source)),copyAndReadHandlePassed:true};
  }
  result.passed=true;
  console.log(JSON.stringify(result,null,2));
} catch(e) {
  console.error(JSON.stringify({passed:false,error:e.message,...(e.result?{evidence:e.result}:{})},null,2));
  process.exitCode=1;
}
