// Diagnostic eligibility only. Never changes execution policy, trust or signatures.
export function assessScriptTrust(policy, file, zoneId) {
  if (!['RemoteSigned', 'AllSigned'].includes(policy))
    return {eligible: false, code: 'POLICY_UNCONFIRMED'};
  if (!['Valid', 'NotSigned'].includes(file.signatureStatus))
    return {eligible: false, code: 'SIGNATURE_UNCONFIRMED'};
  if (file.signatureStatus === 'Valid')
    return {eligible: true, code: 'SIGNED_PROBE_ELIGIBLE'};
  if (policy === 'AllSigned')
    return {eligible: false, code: 'SIGNATURE_REQUIRED'};
  // No Zone.Identifier does not prove a local origin. The OS can classify the
  // same unsigned bytes differently at two local-looking file paths.
  if (['Internet', 'Untrusted'].includes(file.securityZone) || ['3', '4'].includes(String(zoneId)))
    return {eligible: false, code: 'REMOTE_SIGNATURE_REQUIRED'};
  if (!['MyComputer', 'Intranet', 'Trusted'].includes(file.securityZone) || file.securityZoneError)
    return {eligible: false, code: 'FILE_ZONE_UNCONFIRMED'};
  return {eligible: true, code: 'LOCAL_UNSIGNED_PROBE_ELIGIBLE'};
}
