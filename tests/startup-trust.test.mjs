import test from 'node:test';
import assert from 'node:assert/strict';
import {assessScriptTrust} from '../scripts/lib/startup-trust.mjs';

test('unsigned Internet path is rejected without a download marker; same local bytes remain probe eligible',()=>{
  const remote=assessScriptTrust('RemoteSigned',{signatureStatus:'NotSigned',securityZone:'Internet'},null);
  assert.deepEqual(remote,{eligible:false,code:'REMOTE_SIGNATURE_REQUIRED'});
  assert.deepEqual(assessScriptTrust('RemoteSigned',{signatureStatus:'NotSigned',securityZone:'MyComputer'},null),
    {eligible:true,code:'LOCAL_UNSIGNED_PROBE_ELIGIBLE'});
});
test('untrusted zone and explicit remote markers stay blocked',()=>{
  assert.equal(assessScriptTrust('RemoteSigned',{signatureStatus:'NotSigned',securityZone:'Untrusted'},null).eligible,false);
  for(const zoneId of ['3','4',3,4])assert.equal(assessScriptTrust('RemoteSigned',{signatureStatus:'NotSigned',securityZone:'MyComputer'},zoneId).eligible,false);
});
test('missing, erroneous and unknown OS zones are not inferred from absent ADS',()=>{
  for(const file of [{signatureStatus:'NotSigned'},{signatureStatus:'NotSigned',securityZone:'NoZone'},
    {signatureStatus:'NotSigned',securityZone:'MyComputer',securityZoneError:'getter failed'}])
    assert.deepEqual(assessScriptTrust('RemoteSigned',file,null),{eligible:false,code:'FILE_ZONE_UNCONFIRMED'});
});
test('AllSigned still requires a signature; a valid signature is probe eligibility, not runtime proof',()=>{
  assert.equal(assessScriptTrust('AllSigned',{signatureStatus:'NotSigned',securityZone:'MyComputer'},null).eligible,false);
  assert.deepEqual(assessScriptTrust('AllSigned',{signatureStatus:'Valid',securityZone:'Internet'},null),
    {eligible:true,code:'SIGNED_PROBE_ELIGIBLE'});
});
test('unconfirmed policies and bad signatures cannot become eligible',()=>{
  for(const policy of ['Bypass','Unrestricted','Undefined','Restricted'])assert.equal(assessScriptTrust(policy,{signatureStatus:'Valid'},null).eligible,false);
  for(const signatureStatus of ['HashMismatch','NotTrusted','UnknownError',null])assert.equal(assessScriptTrust('RemoteSigned',{signatureStatus,securityZone:'MyComputer'},null).eligible,false);
});
