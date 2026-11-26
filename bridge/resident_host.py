# -*- coding: utf-8 -*-
"""Public primary-thread receiver. One owned project; requests arrive independently.
No IDE exit, project close, compile, save, private editor or user-code evaluation.
"""
import os,sys,json,hashlib,datetime,traceback
_controller=None
_entry_root=None

def load_fixed(path,expected,name):
    with open(path,'rb') as f:raw=f.read()
    if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Fixed helper changed')
    namespace=dict(__name__=name,__file__=path)
    eval(compile(raw.decode('utf-8','strict'),path,'exec'),namespace,namespace)
    return namespace

def publish(path,value):
    data=(json.dumps(value,ensure_ascii=False,indent=2)+u'\n').encode('utf-8')
    temp=path+'.publishing';fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    if os.path.exists(path):raise IOError('Evidence already exists')
    os.rename(temp,path)
    with open(path,'rb') as stream:
        if json.loads(stream.read().decode('utf-8'))!=value:raise ValueError('Evidence publication differs')

def read(path):
    with open(path,'rb') as f:raw=f.read(16000001)
    if len(raw)>16000000:raise ValueError('Request exceeds bounded size')
    return json.loads(raw.decode('utf-8'))

def start():
    global _controller,_entry_root
    intent=read(os.environ['INOPRO_RESIDENT_REQUEST']);root=intent['directory'];_entry_root=root
    publish(os.path.join(root,'entry.json'),dict(pid=os.getpid(),scriptSha256=hashlib.sha256(open(__file__,'rb').read()).hexdigest()))
    if hashlib.sha256(open(__file__,'rb').read()).hexdigest()!=intent['scriptHash']:raise ValueError('Resident entry fingerprint changed')
    core=load_fixed(intent['corePath'],intent['coreHash'],'inopro_resident_core')
    import clr
    clr.AddReference('System.Windows.Forms')
    from System.Diagnostics import Process,StackTrace
    from System.Threading import Thread,ThreadStart
    from System.Windows.Forms import Application
    from scriptengine import projects,system
    p=Process.GetCurrentProcess()
    try:identity=dict(pid=int(p.Id),startId=unicode(p.StartTime.ToUniversalTime().Ticks))
    finally:p.Dispose()
    publish(os.path.join(root,'modules-loaded.json'),dict(launchId=intent['launchId'],processIdentity=identity,coreHash=intent['coreHash']))
    blocked=(('ScriptExecutor','Execute'),('ScriptEngine','OnApplicationReady'),('MainForm','OnLoad'))
    class Controller(object):
        def __init__(self):
            self.frame=None;self.sequence=0;self.first=None;self.directory=None;self.request=None
            self.adapter=core['NativeProjectAdapter'](projects,intent['projectPath'],core['same_public_identity'],lambda:Thread.CurrentThread.ManagedThreadId)
            self.session=core['ResidentSession'](self.adapter,lambda:core['file_hash'](intent['projectPath']),self.evidence,lambda:self.admission(self.request))
        def evidence(self,name,value):publish(os.path.join(self.directory,name),value)
        def capture(self):
            mains=[f for f in Application.OpenForms if unicode(f.GetType().FullName)=='_3S.CoDeSys.Frame.MainForm']
            if len(mains)!=1:raise ValueError('Unique public primary frame unavailable')
            main=mains[0]
            if any(f.Visible and f.Modal for f in Application.OpenForms):raise ValueError('Visible modal prompt; no automatic confirmation')
            asm=main.GetType().Assembly
            current=dict(thread=int(Thread.CurrentThread.ManagedThreadId),handle=unicode(main.Handle.ToInt64()),mvid=unicode(asm.ManifestModule.ModuleVersionId),path=unicode(asm.Location))
            if self.frame is None:self.frame=current
            elif current!=self.frame:raise ValueError('Primary context changed')
            frames=StackTrace(False).GetFrames()
            if not frames:raise ValueError('Primary stack unavailable')
            startup=False
            for f in frames:
                m=f.GetMethod()
                if m is None:raise ValueError('Incomplete primary stack')
                if m.DeclaringType is not None and (unicode(m.DeclaringType.Name),unicode(m.Name)) in blocked:startup=True
            if main.IsDisposed or main.InvokeRequired or not main.Enabled and not startup:raise ValueError('Primary frame not ready')
            return dict(frame=current,startup=startup)
        def primary(self,fn):
            values=[];errors=[]
            def callback():
                try:values.append(fn())
                except Exception as e:errors.append(e)
            system.execute_on_primary_thread(callback)
            if errors:raise errors[0]
            if len(values)!=1:raise ValueError('Primary callback did not complete')
            return values[0]
        def admission(self,req):
            if os.path.exists(os.path.join(root,'stop.json')):raise ValueError('Service stopped native dispatch')
            if req['launchId']!=intent['launchId'] or req['sequence']!=self.sequence+1 or req['projectPath']!=intent['projectPath']:raise ValueError('Request binding differs')
            if datetime.datetime.utcnow()>=datetime.datetime.strptime(req['deadlineUtc'],'%Y-%m-%dT%H:%M:%S.%fZ'):raise ValueError('Request expired')
            for row in req['leases']:
                if core['file_hash'](row['path'])!=row['sha256']:raise ValueError('Lease changed')
            if core['file_hash'](intent['corePath'])!=intent['coreHash']:raise ValueError('Core changed')
        def service(self,req):
            self.capture();self.admission(req)
            self.evidence('request-entered.json',dict(launchId=intent['launchId'],processIdentity=identity,requestHash=core['digest'](req)))
            result=self.session.handle(req)
            result['requestId']=req['requestId']
            result.setdefault('data',{})['residentEvidence']=dict(launchId=intent['launchId'],sequence=req['sequence'],processIdentity=identity,requestHash=core['digest'](req),requestCompleted=True,ideExitRequested=False)
            return result
        def run(self):
            try:
                while True:
                    state=self.primary(self.capture)
                    if not state['startup']:break
                    if datetime.datetime.utcnow()>=datetime.datetime.strptime(intent['deadlineUtc'],'%Y-%m-%dT%H:%M:%S.%fZ'):raise ValueError('Startup deadline expired')
                    Thread.Sleep(50)
                publish(os.path.join(root,'ready.json'),dict(launchId=intent['launchId'],processIdentity=identity,state=state))
                while not os.path.exists(os.path.join(root,'stop.json')):
                    next_path=os.path.join(root,'request-%d.json'%(self.sequence+1))
                    if not os.path.exists(next_path):Thread.Sleep(50);continue
                    req=read(next_path);self.request=req;self.directory=req['directory'];self.admission(req)
                    result=self.primary(lambda:self.service(req))
                    self.evidence('result.json',result)
                    self.evidence('completed.json',dict(launchId=intent['launchId'],sequence=req['sequence'],processIdentity=identity,requestHash=core['digest'](req),resultHash=core['digest'](result)))
                    self.sequence+=1
                    if result['status']!='succeeded' and result.get('data',{}).get('recoverableRejection') is not True:break
            except Exception as error:
                self.first=dict(type=type(error).__name__,message=unicode(error),traceback=traceback.format_exc())
                try:publish(os.path.join(root,'first-error.json'),dict(error=self.first,sequence=self.sequence,request=self.request))
                except Exception:sys.stderr.write('RESIDENT_RECORD_ERROR '+traceback.format_exc())
                sys.stderr.write('RESIDENT_ERROR '+repr(self.first)+'\n');sys.stderr.flush()
            finally:
                try:publish(os.path.join(root,'receiver-stopped.json'),dict(completed=self.sequence,firstError=self.first,ideExitRequested=False,projectClosed=False))
                except Exception:sys.stderr.write('RESIDENT_STOP_RECORD_ERROR '+traceback.format_exc())
    _controller=Controller()
    _controller.background=Thread(ThreadStart(_controller.run));_controller.background.IsBackground=True;_controller.background.Start()

if __name__=='__main__':
    try:start()
    except Exception as error:
        first=dict(type=type(error).__name__,message=unicode(error),traceback=traceback.format_exc())
        if _entry_root is not None:
            try:publish(os.path.join(_entry_root,'first-error.json'),dict(stage='entry',error=first,ideExitRequested=False))
            except Exception:sys.stderr.write('RESIDENT_ENTRY_RECORD_ERROR '+traceback.format_exc())
        sys.stderr.write('RESIDENT_ENTRY_ERROR '+repr(first)+'\n');sys.stderr.flush()