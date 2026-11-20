"""Synthetic evidence tests only. No installed runtime or project is invoked."""
import copy
import unittest
from effective_application_evidence import assess, version


def example():
    ctx = dict(operationId="new-read", processId=100, processStartId="new-process",
               handle=8, openEpoch="open-1", projectPath="X:/sample.project",
               fileIdentity="synthetic-file", diskHash="a"*64, phase="opened-before-build")
    target = dict(rootDeviceGuid="root", deviceGuid="module", connectorId=2,
                  interface="Common.inovance2", parameterId=13, memberPath=["Bit0"])
    app = dict(guid="app-current", name="CellApp", parentGuid="logic", projectHandle=8,
               isApplication=True, typeGuid="app-type", deviceGuid="root")
    record = dict(basis="current-native-effective-provider",
                  api=dict(publicEntryConfirmed=True, readOnly=True, configModeSelection=True,
                           parentDelegation=True, scope="target-provider"),
                  context=ctx, capturedWhileOpen=True, target=target,
                  applications=dict(complete=True, errors=[], items=[app]),
                  effective=dict(state="value", kind="object", guid="app-current",
                                 name="CellApp", parentGuid="logic", projectHandle=8),
                  persistentSelection=dict(ioApp="app-current"),
                  configModeState=dict(state="not-read"))
    return record, dict(ctx, target=copy.deepcopy(target))


class EvidenceCases(unittest.TestCase):
    def evaluate(self, change=None, code=None):
        r,e=example()
        if change:change(r,e)
        before=copy.deepcopy(r)
        out=assess(r,e)
        self.assertEqual(r,before)
        self.assertFalse(out["writeAuthorized"])
        if code:self.assertEqual(out["code"],code)
        return out

    def test_unique_object(self):
        out=self.evaluate()
        self.assertEqual(out["guid"],"app-current")
        self.assertFalse(out["validForFutureHandle"])
    def test_native_guid_in_current_bound_context(self):
        self.assertEqual(self.evaluate(lambda r,e:r["effective"].update(kind="guid"))["guid"],"app-current")
    def test_different_persistent_selection_is_not_overwritten(self):
        out=self.evaluate(lambda r,e:r["persistentSelection"].update(ioApp="app-old"))
        self.assertTrue(out["differsFromPersistentSelection"])
        self.assertEqual(out["configModeState"],dict(state="not-read"))
    def test_multiple_apps_with_one_exact_return(self):
        def change(r,e):
            other=copy.deepcopy(r["applications"]["items"][0]);other.update(guid="other",name="Other")
            r["applications"]["items"].append(other)
        self.assertEqual(self.evaluate(change)["guid"],"app-current")
    def test_foreign_native_project(self):
        self.evaluate(lambda r,e:r["effective"].update(projectHandle=77),"RETURN_OBJECT_IDENTITY_MISMATCH")
    def test_foreign_inventory_project(self):
        self.evaluate(lambda r,e:r["applications"]["items"][0].update(projectHandle=77),"APPLICATION_OWNERSHIP_MISMATCH")
    def test_outside_application_list(self):
        self.evaluate(lambda r,e:r["effective"].update(guid="absent"),"RETURN_NOT_IN_APPLICATIONS")
    def test_foreign_device(self):
        self.evaluate(lambda r,e:r["applications"]["items"][0].update(deviceGuid="foreign"),"APPLICATION_OWNERSHIP_MISMATCH")
    def test_return_name_changed(self):
        self.evaluate(lambda r,e:r["effective"].update(name="Renamed"),"RETURN_OBJECT_IDENTITY_MISMATCH")
    def test_duplicate_guid(self):
        self.evaluate(lambda r,e:r["applications"]["items"].append(copy.deepcopy(r["applications"]["items"][0])),
                      "APPLICATION_IDENTITY_AMBIGUOUS")
    def test_incomplete_inventory(self):
        self.evaluate(lambda r,e:r["applications"].update(complete=False),"APPLICATION_ENUMERATION_INCOMPLETE")
    def test_null(self):
        self.evaluate(lambda r,e:r.update(effective=dict(state="null")),"RETURN_NULL")
    def test_missing(self):
        self.evaluate(lambda r,e:r.pop("effective"),"RETURN_MISSING")
    def test_exception(self):
        self.evaluate(lambda r,e:r.update(effective=dict(state="error",type="NativeError",message="first failure")),
                      "RETURN_READ_FAILED")
    def test_stale_handle(self):
        self.evaluate(lambda r,e:r["context"].update(handle=9),"STALE_OR_FOREIGN_CONTEXT")
    def test_stale_operation(self):
        self.evaluate(lambda r,e:r["context"].update(operationId="old"),"STALE_OR_FOREIGN_CONTEXT")
    def test_pid_reuse(self):
        self.evaluate(lambda r,e:r["context"].update(processStartId="old"),"STALE_OR_FOREIGN_CONTEXT")
    def test_old_open_epoch(self):
        self.evaluate(lambda r,e:r["context"].update(openEpoch="old"),"STALE_OR_FOREIGN_CONTEXT")
    def test_old_file(self):
        self.evaluate(lambda r,e:r["context"].update(diskHash="b"*64),"STALE_OR_FOREIGN_CONTEXT")
    def test_changed_phase(self):
        self.evaluate(lambda r,e:r["context"].update(phase="after-build"),"STALE_OR_FOREIGN_CONTEXT")
    def test_closed_handle(self):
        self.evaluate(lambda r,e:r.update(capturedWhileOpen=False),"HANDLE_NOT_OPEN")
    def test_other_connector(self):
        self.evaluate(lambda r,e:r["target"].update(connectorId=1),"TARGET_PROVIDER_MISMATCH")
    def test_persistent_only(self):
        self.evaluate(lambda r,e:r.update(basis="exported-DriverInfo"),"NOT_EFFECTIVE_RETURN")
    def test_script_getter_without_parent_delegation(self):
        self.evaluate(lambda r,e:r["api"].update(parentDelegation=False),"SELECTION_PATH_INCOMPLETE")
    def test_no_config_mode_branch(self):
        self.evaluate(lambda r,e:r["api"].update(configModeSelection=False),"SELECTION_PATH_INCOMPLETE")
    def test_internal_clr_entry_not_confirmed(self):
        self.evaluate(lambda r,e:r["api"].update(publicEntryConfirmed=False),"SCRIPT_ENTRY_UNCONFIRMED")
    def test_old_evidence_version(self):
        r,e=example();old=version(r)
        r["persistentSelection"]["ioApp"]="changed"
        self.assertEqual(assess(r,e,old)["code"],"EVIDENCE_CHANGED")


if __name__=="__main__":unittest.main(verbosity=2)
