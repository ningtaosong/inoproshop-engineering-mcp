# -*- coding: utf-8 -*-
"""Bounded, exact UI Automation handling for the OEM library-load information dialog.

Only the service-owned initial project_open stage may instantiate this observer.
The native project result remains authoritative; these records are diagnostic only.
"""
import datetime
import re
import time

MESSAGE = u"在此工程中，加载一个或多个库失败。请查看信息窗口获得更多细节。"
TITLE = u"InoProShop(V1.9.1.6)"

def normalized(value):
    return re.sub(u"\\s+", u"", unicode(value))

class WindowsDialogBackend(object):
    def __init__(self):
        import clr
        clr.AddReference('UIAutomationClient')
        clr.AddReference('UIAutomationTypes')
        from System.Diagnostics import Process
        from System.Windows.Automation import AutomationElement, ControlType, TreeScope, PropertyCondition, WindowPattern, InvokePattern
        self.Process, self.AutomationElement = Process, AutomationElement
        self.ControlType, self.TreeScope, self.PropertyCondition = ControlType, TreeScope, PropertyCondition
        self.WindowPattern, self.InvokePattern = WindowPattern, InvokePattern
        self.process = Process.GetCurrentProcess()
        self.pid = self.process.Id
        self.birth = self.process.StartTime.ToUniversalTime().ToString('o')

    def identity_matches(self):
        current = self.Process.GetCurrentProcess()
        return current.Id == self.pid and current.StartTime.ToUniversalTime().ToString('o') == self.birth

    def dialogs(self):
        A, C, S, P = self.AutomationElement, self.ControlType, self.TreeScope, self.PropertyCondition
        roots = A.RootElement.FindAll(S.Children, P(A.ProcessIdProperty, self.pid))
        result = []
        windows = []
        for root in roots:
            windows.append(root)
            try:
                windows.extend(root.FindAll(S.Descendants, P(A.ControlTypeProperty, C.Window)))
            except Exception:
                pass
        for window in windows:
            try:
                if window.Current.ProcessId != self.pid or window.Current.ControlType != C.Window or unicode(window.Current.Name).strip() != TITLE:
                    continue
                pattern = window.GetCurrentPattern(self.WindowPattern.Pattern)
                if not pattern.Current.IsModal:
                    continue
                texts = window.FindAll(S.Descendants, P(A.ControlTypeProperty, C.Text))
                buttons = window.FindAll(S.Descendants, P(A.ControlTypeProperty, C.Button))
                body = [unicode(item.Current.Name) for item in texts if item.Current.AutomationId == '65535' and normalized(item.Current.Name) == normalized(MESSAGE)]
                confirm = [item for item in buttons if item.Current.AutomationId == '2' and unicode(item.Current.Name).strip() == u'确定' and item.Current.IsEnabled]
                other = [item for item in buttons if item not in confirm and unicode(item.Current.Name).strip() != u'关闭']
                if len(body) == 1 and len(confirm) == 1 and not other:
                    result.append({'handle':int(window.Current.NativeWindowHandle), 'body':body[0],
                                   'button':u'确定', 'element':window, 'confirm':confirm[0]})
            except Exception:
                # A disappearing or inaccessible window is never treated as a match.
                continue
        return result

    def confirm(self, dialog):
        dialog['confirm'].GetCurrentPattern(self.InvokePattern.Pattern).Invoke()

    def remains(self, handle):
        return any(row['handle'] == handle for row in self.dialogs())

class LibraryInfoObserver(object):
    def __init__(self, backend, record, operation_id, deadline, now=None, sleep=None):
        self.backend, self.record, self.operation_id = backend, record, operation_id
        self.deadline = deadline
        self.now = now or datetime.datetime.utcnow
        self.sleep = sleep or time.sleep
        self.active = True
        self.handles = set()
        self.confirmations = 0
        self.evidence_error = None

    def emit(self, action, dialog=None, **extra):
        row = {'operationId':self.operation_id, 'action':action,
               'utc':self.now().isoformat()+'Z', 'pid':self.backend.pid, 'processStartUtc':self.backend.birth,
               'stage':'initial-open'}
        if dialog is not None:
            row.update(handle=dialog['handle'], body=dialog['body'], button=dialog['button'])
        row.update(extra)
        self.record(row)

    def tick(self):
        if not self.active or self.confirmations >= 1 or self.now() >= self.deadline:
            return
        if not self.backend.identity_matches():
            self.active = False
            return
        matches = self.backend.dialogs()
        if len(matches) != 1:
            return
        dialog = matches[0]
        if dialog['handle'] in self.handles:
            return
        self.handles.add(dialog['handle'])
        try:
            self.emit('observed', dialog)
            if not self.active or self.now() >= self.deadline or not self.backend.identity_matches():
                return
            self.backend.confirm(dialog)
            self.confirmations += 1
            self.emit('confirmation-sent', dialog)
            self.sleep(0.3)
            self.emit('window-state-after-confirmation', dialog, remains=self.backend.remains(dialog['handle']))
        except Exception as error:
            self.evidence_error = unicode(error)
            self.active = False

    def run(self):
        while self.active and self.now() < self.deadline:
            try:self.tick()
            except Exception as error:
                self.evidence_error = unicode(error)
                self.active = False
                try:self.emit('observer-failed', reason=self.evidence_error)
                except Exception:pass
                return
            if self.confirmations or not self.active:
                return
            self.sleep(0.2)

