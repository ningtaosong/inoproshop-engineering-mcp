# -*- coding: utf-8 -*-
"""One fixed five-request diagnostic; project remains open and unsaved."""
import os,sys,json,hashlib,datetime,traceback

def sha(path):
    with open(path,'rb') as f:return hashlib.sha256(f.read()).hexdigest()

def load_fixed(path,expected,name):
    if sha(path)!=expected:raise ValueError('Fixed module fingerprint differs: '+path)
    namespace=dict(__name__=name,__file__=path)
    with open(path,'rb') as f:code=compile(f.read(),path,'exec')
    eval(code,namespace,namespace)
    return namespace

def start():
    intent=json.loads(open(os.environ['INOPRO_RESIDENT_INTENT'],'rb').read().decode('utf-8'))
    root=intent['directory']
    # Earliest entry independent of auxiliary module import.
    entry=os.open(os.path.join(root,'entry.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    stream=os.fdopen(entry,'wb')
    try:stream.write(json.dumps(dict(pid=os.getpid(),scriptSha256=sha(__file__))).encode('utf-8'));stream.flush();os.fsync(stream.fileno())
    finally:stream.close()
    base=load_fixed(intent['twoReadModule'],intent['twoReadSha256'],'resident_read_helpers')
    base['_root']=root;base['_binding']=dict((k,intent[k]) for k in ('operationId','requestId','launchId','requestFingerprint','scriptSha256'))
    try:
        if intent['scope']!='one-owned-project-five-unsaved-requests' or sha(__file__)!=intent['scriptSha256']:raise ValueError('Fixed scope/script differs')
        for item in intent['fixedFiles']:
            if sha(item['path'])!=item['sha256']:raise ValueError('Fixed dependency changed: '+item['path'])
        module=load_fixed(intent['sessionModule'],intent['sessionSha256'],'resident_session_helpers')
        import clr
        clr.AddReference('System.Windows.Forms');clr.AddReferenceToFileAndPath(intent['fileIdentityDll'])
        from System.Diagnostics import Process,StackTrace
        from System.Threading import Thread,ThreadStart
        from System.Windows.Forms import Application
        from System import StringComparer
        from System.IO import Path
        from scriptengine import projects,system
        from ResidentFileIdentity import Read
        base.update(Process=Process,StackTrace=StackTrace,Thread=Thread,ThreadStart=ThreadStart,Application=Application,StringComparer=StringComparer,Path=Path,projects=projects,system=system)
        def process_identity():
            p=Process.GetCurrentProcess()
            try:return dict(pid=int(p.Id),startId=unicode(p.StartTime.ToUniversalTime().Ticks))
            finally:p.Dispose()
        identity=process_identity();base['_binding'].update(identity)
        def file_identity(path):
            values=Read(path)
            return dict(path=path,realPath=unicode(values[0]),fileId=unicode(values[1]),sha256=unicode(values[2]))
        base['record']('modules-loaded',process=identity,modules=intent['fixedFiles'])
        session_intent=dict(intent);session_intent['processIdentity']=identity
        class Probe(base['TwoReadProbe']):
            def __init__(self):
                base['TwoReadProbe'].__init__(self,intent)
                self.adapter=module['NativeProjectAdapter'](projects,intent['projectPath'],module['same_public_identity'],lambda:Thread.CurrentThread.ManagedThreadId,lambda proof:base['record']('project-ownership-observed',proof=proof))
                self.session=module['ResidentSequence'](session_intent,self.adapter,self.engineering_admission,self.primary_dispatch,base['publish'],process_identity,file_identity)
            def project_status(self):
                if self.adapter.project is None:return base['TwoReadProbe'].project_status(self)
                self.adapter._owned()
                proof=self.adapter.last_ownership
                return dict(primaryIsNone=False,openProjectCount=len(proof['all']),backgroundLibraryCount=len(proof['all'])-1,uiPresent=bool(system.ui_present),projectHandle=self.adapter.handle,projectPath=unicode(self.adapter.project.path))
            def engineering_admission(self):
                self.admission()
                sequence=self.session.completed+1
                receipt=base['read_json'](os.path.join(root,'gate-%d.json'%sequence),1048576)
                if receipt['launchId']!=intent['launchId'] or receipt['sequence']!=sequence or receipt['projectPath']!=intent['projectPath'] or receipt['globalFrozen'] or receipt['related'] or receipt['processIdentity']!=identity:raise ValueError('Current formal engineering gate denies request')
                limit=datetime.datetime.strptime(receipt['deadlineUtc'],'%Y-%m-%dT%H:%M:%S.%fZ')
                if datetime.datetime.utcnow()>=limit:raise ValueError('Engineering admission expired')
                for row in receipt['protectedFiles']:
                    if bool(os.path.exists(row['path']))!=row['exists'] or (sha(row['path']) if row['exists'] else None)!=row['sha256']:raise ValueError('Formal evidence changed inside request')
                return True
            def primary_dispatch(self,callback):
                errors=[]
                def wrapped():
                    try:
                        state=self.capture()
                        base['stable_identity'](self.first_state,state)
                        if state['startupFramesPresent']:raise ValueError('Native startup has not returned')
                        callback()
                    except Exception as error:
                        if self.callback_error is None:self.callback_error=base['exception_detail'](error)
                        errors.append(error)
                system.execute_on_primary_thread(wrapped)
                if errors:raise errors[0]
            def run(self):
                try:
                    base['record']('receiver-started',thread=Thread.CurrentThread.ManagedThreadId)
                    while True:
                        self.admission();state=self.on_primary();base['stable_identity'](self.first_state,state)
                        if not state['startupFramesPresent']:
                            base['publish']('ready.json',dict(binding=dict(base['_binding']),state=state));break
                        Thread.Sleep(100)
                    for seq in range(1,6):
                        path=os.path.join(root,'request-%d.json'%seq)
                        while not os.path.exists(path):self.admission();Thread.Sleep(100)
                        self.engineering_admission()
                        base['record']('request-entered',sequence=seq,requestSha256=sha(path))
                        response=module['process_request_file'](self.session,path)
                        if response['status']!='memory-verified':raise ValueError('Request stopped: '+response['status'])
                        state=self.on_primary();base['stable_identity'](self.first_state,state)
                        base['record']('request-completed',sequence=seq,memoryVersion=response['memoryVersion'],context=state)
                    base['record']('sequence-completed',requests=self.session.completed,modifications=self.session.modifications,saved=False,closed=False,ideRetained=True)
                except Exception as error:base['fail']('resident-receiver',error)
                finally:
                    try:base['record']('receiver-stopped',completed=self.session.completed,firstError=base['_first_error'],sessionError=self.session.first_error,ideExitRequested=False)
                    except Exception as error:base['fail']('receiver-stop-publication',error)
        probe=Probe();base['_controller']=probe;probe.admission();system.execute_on_primary_thread(probe.initialize)
        if base['_first_error'] is not None or not probe.initialization_complete:return
        probe.background=Thread(ThreadStart(probe.run));probe.background.IsBackground=True;probe.background.Start()
    except Exception as error:base['fail']('resident-start',error)

if __name__=='__main__':
    try:start()
    except Exception:
        # Entry/import failure remains visible without calling any engineering API.
        sys.stderr.write('RESIDENT_ENTRY_ERROR '+traceback.format_exc());sys.stderr.flush()
