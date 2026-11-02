import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import plan_service

def sample():
    return {'categoryId':'1','detailName':'단독주택','floors':1,'buildingAreaM2':60,'site':{'ring':[{'x':0,'z':0},{'x':20,'z':0},{'x':20,'z':25},{'x':0,'z':25}],'extraRings':[],'roadEdgeIndex':0,'roadWidthM':6,'roadEdges':[{'ringIdx':0,'index':0,'widthM':6}],'isBusan':True,'zoneNames':['제2종일반주거지역'],'maxTotalFloorAreaM2':100}}

class PlanningTests(unittest.TestCase):
    def test_dimension_without_display_block_is_preserved(self):
        import ezdxf
        doc=ezdxf.new('R2010');doc.units=4
        doc.modelspace().add_aligned_dim(p1=(0,0),p2=(5000,0),distance=1000)
        output=io.StringIO();doc.write(output)
        result=plan_service.read_generated_dxf(output.getvalue().encode('utf-8'))
        dims=[e for e in result['document']['entities'] if e['type']=='dimension']
        self.assertEqual(len(dims),1)
        self.assertEqual(dims[0]['points'][1]['x'],5000)
        self.assertNotIn('text',dims[0])
        self.assertFalse(any(v for k,v in result['report']['skipped'].items() if k!='ZERO_LENGTH'))

    def test_missing_and_bad_inputs(self):
        for key in ('roadEdges','roadWidthM','zoneNames','maxTotalFloorAreaM2'):
            data=sample();del data['site'][key]
            with self.assertRaises(ValueError):plan_service.validate(data)
        data=sample();data['site']['roadEdgeIndex']=2
        with self.assertRaises(ValueError):plan_service.validate(data)
        data=sample();data['site']['holes']=[]
        with self.assertRaises(ValueError):plan_service.validate(data)

    @patch('plan_service.auth_headers',return_value={})
    @patch('plan_service.urllib.request.urlopen')
    def test_payload_and_blocked_response(self,send,_cookie):
        send.return_value.__enter__.return_value.read.return_value=json.dumps({'blocked':{'reasons':['주차 부족']}}).encode()
        result,status=plan_service.process(sample())
        self.assertEqual(status,200);self.assertIn('blocked',result)
        request=send.call_args.args[0]
        self.assertEqual(request.full_url,plan_service.BASE+'/api/public/plan-suggest')
        self.assertEqual(json.loads(request.data),sample())

    @patch('plan_service.auth_headers',return_value={})
    @patch('plan_service.urllib.request.urlopen',side_effect=HTTPError('https://example.com',429,'limit',{},io.BytesIO(b'')))
    def test_rate_limit_preserved(self,_send,_cookie):
        result,status=plan_service.process(sample());self.assertEqual(status,429);self.assertIn('error',result)

if __name__=='__main__':unittest.main()
