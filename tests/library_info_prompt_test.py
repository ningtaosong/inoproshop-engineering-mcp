"""Offline tests of the production exact-dialog selector and bounded observer."""
import datetime
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('library_info_prompt', Path('bridge/library_info_prompt.py'))
prompt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prompt)
prompt.unicode = str

class FakeBackend:
    def __init__(self, rows=None, owner=True):
        self.pid, self.birth = 120, '2026-11-17T00:00:00.0000000Z'
        self.rows, self.owner, self.calls = rows or [], owner, []
    def identity_matches(self):return self.owner
    def dialogs(self):return self.rows
    def confirm(self, dialog):self.calls.append(dialog['handle']);self.rows=[]
    def remains(self, handle):return any(x['handle']==handle for x in self.rows)

class PromptObserverTest(unittest.TestCase):
    def setUp(self):
        self.now=datetime.datetime(2026,11,17)
        self.rows=[]
        self.dialog={'handle':42,'body':prompt.MESSAGE,'button':'确定'}
    def observer(self, backend, deadline=None):
        return prompt.LibraryInfoObserver(backend,self.rows.append,'op-1',deadline or self.now+datetime.timedelta(seconds=10),
                                          now=lambda:self.now,sleep=lambda _:None)
    def test_exact_owned_prompt_is_confirmed_once_and_dismissal_recorded(self):
        backend=FakeBackend([self.dialog]); guard=self.observer(backend)
        guard.tick();guard.tick()
        self.assertEqual(backend.calls,[42]);self.assertEqual([x['action'] for x in self.rows],
          ['observed','confirmation-sent','window-state-after-confirmation'])
        self.assertFalse(self.rows[-1]['remains'])
    def test_wrong_owner_or_expired_operation_is_never_confirmed(self):
        for backend,deadline in [(FakeBackend([self.dialog],False),None),(FakeBackend([self.dialog]),self.now)]:
            guard=self.observer(backend,deadline);guard.tick();self.assertEqual(backend.calls,[])
        self.assertEqual(self.rows,[])
    def test_failed_confirmation_is_bounded(self):
        backend=FakeBackend([self.dialog]);backend.confirm=lambda dialog:(_ for _ in ()).throw(RuntimeError('invoke failed'))
        guard=self.observer(backend);guard.tick();guard.tick()
        self.assertEqual(guard.confirmations,0);self.assertFalse(guard.active)
        self.assertEqual(len(self.rows),1)
    def test_unavailable_window_query_stops_observer_without_unhandled_thread_error(self):
        backend=FakeBackend([self.dialog]);backend.dialogs=lambda:(_ for _ in ()).throw(RuntimeError('UIA unavailable'))
        guard=self.observer(backend);guard.run()
        self.assertFalse(guard.active);self.assertEqual(backend.calls,[])
        self.assertEqual(self.rows[-1]['action'],'observer-failed')
    def test_each_stage_is_labeled_and_repeated_prompt_is_not_confirmed(self):
        backend=FakeBackend([self.dialog]);guard=prompt.LibraryInfoObserver(
            backend,self.rows.append,'op-1',self.now+datetime.timedelta(seconds=10),
            now=lambda:self.now,sleep=lambda _:None,stage='reopen')
        guard.tick()
        backend.rows=[{'handle':99,'body':prompt.MESSAGE,'button':'确定'}]
        guard.tick()
        self.assertEqual(backend.calls,[42])
        self.assertTrue(all(row['stage']=='reopen' for row in self.rows))
    def test_multiple_matching_windows_stop_without_confirmation(self):
        backend=FakeBackend([self.dialog,dict(self.dialog,handle=99)])
        guard=self.observer(backend);guard.tick()
        self.assertFalse(guard.active)
        self.assertEqual(backend.calls,[])
        self.assertEqual(self.rows[-1]['action'],'ambiguous-dialogs')
    def test_unknown_before_confirmation_never_clicks(self):
        backend=FakeBackend([self.dialog]);calls=[0]
        def active():
            calls[0]+=1
            return calls[0]==1
        guard=prompt.LibraryInfoObserver(backend,self.rows.append,'op-1',
            self.now+datetime.timedelta(seconds=10),now=lambda:self.now,sleep=lambda _:None,
            operation_active=active)
        guard.tick()
        self.assertEqual(backend.calls,[])
        self.assertFalse(guard.active)

class Element:
    def __init__(self,name='',kind='',pid=120,aid='',enabled=True,modal=False,handle=0,children=None):
        self.Current=SimpleNamespace(Name=name,ControlType=kind,ProcessId=pid,AutomationId=aid,
                                     IsEnabled=enabled,NativeWindowHandle=handle)
        self.modal=modal;self.children=children or []
    def GetCurrentPattern(self,pattern):return SimpleNamespace(Current=SimpleNamespace(IsModal=self.modal))
    def FindAll(self,scope,condition):
        entries=list(self.children)
        if scope=='desc':
            for child in self.children:entries.extend(child.FindAll(scope,condition))
        return [x for x in entries if condition.matches(x)]
class Condition:
    def __init__(self,field,value):self.field,self.value=field,value
    def matches(self,item):return getattr(item.Current,self.field)==self.value

class SelectorTest(unittest.TestCase):
    def backend(self,body=prompt.MESSAGE,button='确定',pid=120,aid='2',modal=True):
        dialog=Element(prompt.TITLE,'window',pid,modal=modal,handle=42,children=[
            Element(body,'text',pid,aid='65535'),Element(button,'button',pid,aid=aid)])
        root=Element(prompt.TITLE,'window',120,children=[dialog])
        backend=prompt.WindowsDialogBackend.__new__(prompt.WindowsDialogBackend)
        backend.pid=120;backend.birth='identity';backend.ControlType=SimpleNamespace(Window='window',Text='text',Button='button')
        backend.TreeScope=SimpleNamespace(Children='children',Descendants='desc')
        backend.AutomationElement=SimpleNamespace(RootElement=Element(children=[root]),
          ProcessIdProperty='ProcessId',ControlTypeProperty='ControlType')
        backend.PropertyCondition=Condition
        backend.WindowPattern=SimpleNamespace(Pattern='window-pattern')
        return backend
    def test_exact_structure_and_whitespace(self):
        self.assertEqual(len(self.backend(body='在此工程中，加载一个或多个库失败。  请查看信息窗口获得更多细节。').dialogs()),1)
    def test_similar_text_wrong_button_pid_or_nonmodal_not_selected(self):
        for changes in [{'body':prompt.MESSAGE+'!'}, {'button':'保存'}, {'pid':121}, {'modal':False}, {'aid':'9'}]:
            self.assertEqual(self.backend(**changes).dialogs(),[],changes)

if __name__=='__main__':unittest.main()
