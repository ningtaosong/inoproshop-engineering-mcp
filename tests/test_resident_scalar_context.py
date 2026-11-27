# -*- coding: utf-8 -*-
"""Offline production scalar/session checks; CLR cases require installed IronPython."""
import os,sys,copy,unittest
sys.path.insert(0,os.path.dirname(__file__))
from test_resident_build import BuildNative,APP,OBJ,OTHER
from test_resident_core import c

class ScalarContextCases(unittest.TestCase):
    def test_null_empty_literal_and_primitive_kinds_remain_distinct(self):
        values=[None,False,0,'','None','0']
        records=[c.scalar(v) for v in values]
        self.assertEqual(records[0],dict(kind='null',value=None))
        self.assertEqual(len(set(c.digest(r) for r in records)),len(records))

    def test_type_getter_failure_is_not_hidden(self):
        class Broken(object):
            def GetType(self):raise ValueError('first type read failure')
        self.assertRaises(ValueError,c.scalar,Broken())

    @unittest.skipUnless(sys.platform=='cli','actual installed IronPython only')
    def test_first_scalar_already_has_clr_identity(self):
        for value,native in [(False,'System.Boolean'),(0,'System.Int32'),(u'','System.String'),(1.25,'System.Double')]:
            self.assertEqual(c.scalar(value)['nativeType'],native)

    @unittest.skipUnless(sys.platform=='cli','actual installed IronPython only')
    def test_loaded_assembly_read_cannot_change_scalar_metadata(self):
        values=[None,False,True,0,1,2147483647,1.25,u'',u'None',u'20',u'\u4e2d\u6587']
        before=[c.scalar(v) for v in values]
        self.assertEqual(before[-1]['value'],u'\u4e2d\u6587')
        c.compiler_library_support()
        self.assertEqual(before,[c.scalar(v) for v in values])

    @unittest.skipUnless(sys.platform=='cli','actual installed IronPython only')
    def test_clr_guid_enum_timespan_preserve_native_kind(self):
        from System import Guid,TimeSpan,DayOfWeek
        for value,kind,native in [(Guid('10000000-0000-4000-8000-000000000001'),'guid','System.Guid'),
                (TimeSpan.FromTicks(1234567),'timespan-ticks','System.TimeSpan'),
                (DayOfWeek.Monday,'enum','System.DayOfWeek')]:
            actual=c.scalar(value);self.assertEqual(actual['kind'],kind);self.assertEqual(actual['nativeType'],native)

    @unittest.skipUnless(sys.platform=='cli','actual installed IronPython only')
    def test_unhandled_clr_int64_remains_rejected_without_coercion(self):
        from System import Int64
        self.assertRaises(ValueError,c.scalar,Int64(9223372036854775807))

    def session(self,pubfault=None,mutate=None):
        class ScalarNative(BuildNative):
            def snapshot(n):
                n.state['nodes'][OTHER]['taskFields']=dict(interval=c.scalar('20'),core_binding=c.scalar(0),enabled=c.scalar(False))
                return BuildNative.snapshot(n)
            def build_library_support(n):
                if sys.platform=='cli':c.compiler_library_support()
                return None
        n=ScalarNative();records={}
        def publish(name,value):
            if name==pubfault:raise IOError('publish '+name)
            records[name]=copy.deepcopy(value)
            if mutate:mutate(n,name)
        s=c.ResidentSession(n,lambda:'a'*64,publish,lambda:None)
        first=s.handle(dict(command='read',args=dict(applicationId=APP,objectId=OBJ),operationId='read',requestId='read',directory='offline'))
        result=s.handle(dict(command='build',args=dict(applicationId=APP,expectedResidentVersion=first['data']['residentVersion']),operationId='build',requestId='build',directory='offline'))
        return n,s,records,result

    def test_production_session_stable_scalar_recheck(self):
        n,s,records,result=self.session()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(records['checkpoint.json']['state']['nodes'][OTHER]['taskFields'],records['predispatch.json']['state']['nodes'][OTHER]['taskFields'])
        self.assertEqual(n.builds,1);self.assertEqual(n.saves,0)

    def test_true_change_before_build_keeps_zero_dispatch(self):
        def mutate(n,name):
            if name=='checkpoint.json':n.state['nodes'][OBJ]['implementation']='changed'
        n,s,records,result=self.session(mutate=mutate)
        self.assertEqual(result['status'],'conflict');self.assertEqual(n.builds,0);self.assertEqual(n.saves,0)
        self.assertNotIn('dispatch.json',records)

    def test_publication_failure_preserves_first_error_and_freezes(self):
        n,s,records,result=self.session(pubfault='compiler-library-support-before.json')
        self.assertEqual(result['status'],'unknown');self.assertEqual(n.builds,0);self.assertEqual(n.saves,0)
        self.assertEqual(result['data']['firstError']['message'],'publish compiler-library-support-before.json')
        self.assertRaises(c.Conflict,s.handle,dict(command='read',args=dict(applicationId=APP,objectId=OBJ),operationId='later',directory='offline'))

if __name__=='__main__':unittest.main()
