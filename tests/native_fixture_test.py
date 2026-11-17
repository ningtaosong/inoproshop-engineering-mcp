import json,os,tempfile,unittest
from pathlib import Path

class NativeFixtureScriptTest(unittest.TestCase):
    def test_all_stages_and_result_published_with_native_substitutes(self):
        class Library:
            displayname='CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)'
            company='CAA Technical Workgroup';title='CAA Mathematics';version='3.5.11.0';default_namespace='MATH'
        class Reference:
            id='1';name='#S5bDemo';namespace='MATH';is_placeholder=True;placeholder_name='S5bDemo'
            is_managed=False;system_library=False;is_redirected=False
            default_resolution=Library.displayname;effective_resolution='None';resolution_info='None';resolver_guid='test'
            def get_redirection(self):return None
        class Manager:
            is_libman=True;guid='manager';references=[]
            def add_placeholder(self,name,lib):self.references.append(Reference())
        manager=Manager()
        class Application:
            is_application=True;guid='application'
            def get_children(self,recursive):return [manager]
        class Project:
            def get_children(self,recursive):return [Application()]
            def save(self):pass
            def close(self):pass
        class Projects:
            primary=None
            def open(self,target,primary):return Project()
        class Catalog:
            def get_all_libraries(self,unused):return [Library()]
        class System:
            exited=False
            def exit(self):self.exited=True
        with tempfile.TemporaryDirectory() as root:
            old={k:os.environ.get(k) for k in ('FIXTURE_TARGET','FIXTURE_RESULT','FIXTURE_PHASE_DIR')}
            os.environ.update(FIXTURE_TARGET=str(Path(root)/'fixture.project'),
                FIXTURE_RESULT=str(Path(root)/'result.json'),FIXTURE_PHASE_DIR=root)
            try:
                code=Path(__file__).resolve().parents[1].joinpath('scripts/native-placeholder-fixture.py').read_text(encoding='utf-8')
                exec(compile(code,'native-placeholder-fixture.py','exec'),{
                    'unicode':str,'librarymanager':Catalog(),'projects':Projects(),'system':System()})
                result=json.loads((Path(root)/'result.json').read_text(encoding='utf-8'))
                phases=[json.loads(x.read_text(encoding='utf-8')) for x in sorted(Path(root).glob('native-phase-*.json'))]
                self.assertTrue(result['passed'])
                self.assertEqual(phases[-1]['stage'],'result-publish')
                self.assertEqual(phases[-1]['status'],'succeeded')
                self.assertIn('reopen',result['stages'])
            finally:
                for k,v in old.items():
                    if v is None:os.environ.pop(k,None)
                    else:os.environ[k]=v

if __name__=='__main__':unittest.main()
