"""Stage guard for the one-shot fixture, independent of IDE startup."""
from device_add_preflight import ProbeRejected, check_equal, verify_preflight


PRECOMPILE = 'opened-before-compile'


def check_plan_stage(plan, stage):
    check_equal('PLAN_STAGE_MISMATCH', PRECOMPILE, plan.get('stage'), '$.plan.stage')
    check_equal('LIVE_STAGE_MISMATCH', PRECOMPILE, stage, '$.live.stage')


def verify_stage(api, target, seed, repository, plan, stage, nodes, placements, catalog, controls,
                 journal=None, cross_open=False):
    check_plan_stage(plan, stage)
    return verify_preflight(api, target, seed, repository, plan, nodes, placements, catalog, controls,
                            journal, cross_open=cross_open)


def require_attachment_control(proofs):
    verified = [row for row in proofs if row.get('status') == 'verified']
    if not verified:
        raise ProbeRejected('PARENT_CONNECTOR_READBACK_UNPROVEN',
                            dict(path='$.attachmentControl', expected='instance-bound parent connector ID and owner', actual=proofs))
    return verified
