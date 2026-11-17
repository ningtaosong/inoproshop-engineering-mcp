# -*- coding: utf-8 -*-
"""No-project capability probe for the installed OEM IronPython/UIA runtime."""
import datetime,os,sys,traceback
sys.path.insert(0,os.path.dirname(__file__))
from native_json_publish import publish_json
target=os.environ['FIXTURE_TARGET'];out=os.environ['FIXTURE_PHASE_DIR'];result=os.environ['FIXTURE_RESULT']
record={'target':target,'passed':False,'stages':[]}
seq=[0]
def phase(name,status,detail=None):
    seq[0]+=1
    row={'stage':name,'status':status,'target':target,'atUtc':datetime.datetime.utcnow().isoformat()+'Z'}
    if detail is not None:row['detail']=detail
    publish_json(os.path.join(out,'native-phase-%06d.json'%seq[0]),row)
try:
    phase('uia-capability','started')
    import clr
    clr.AddReference('UIAutomationClient');clr.AddReference('UIAutomationTypes')
    from System.Diagnostics import Process
    from System.Windows.Automation import AutomationElement, ControlType, TreeScope, PropertyCondition, WindowPattern, InvokePattern
    pid=Process.GetCurrentProcess().Id
    birth=Process.GetCurrentProcess().StartTime.ToUniversalTime().ToString('o')
    roots=AutomationElement.RootElement.FindAll(TreeScope.Children,PropertyCondition(AutomationElement.ProcessIdProperty,pid))
    record['runtime']={'python':sys.version,'idePid':pid,'processStartUtc':birth,'ownWindows':len(roots),
                       'windowPattern':unicode(WindowPattern.Pattern.Id),'invokePattern':unicode(InvokePattern.Pattern.Id)}
    record['passed']=True;record['stages'].append('uia-capability')
    phase('uia-capability','succeeded',record['runtime'])
except Exception:
    record['error']=traceback.format_exc();phase('uia-capability','failed',record['error'])
finally:
    phase('result-publish','started');publish_json(result,record);phase('result-publish','succeeded');system.exit()
