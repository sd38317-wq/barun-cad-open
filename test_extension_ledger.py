"""증축·대수선: 기존 면적은 건축물대장에서 채운다(괴정 2026-10-30 — 미리가 사용자에게 물었다)."""
import unittest
from unittest.mock import patch
import bridge
import parcel_service

DOC={'layers':[{'id':'s','name':'A-SITE'}],'entities':[{'id':'p','type':'polyline','closed':True,'layer':'s','parcelRole':'site','attributes':{'pnu':'2638010100102130017'},
     'points':[{'x':0,'y':0},{'x':10000,'y':0},{'x':10000,'y':10000}]}]}


class ExtensionLedgerTest(unittest.TestCase):
    def test_existing_areas_come_from_register(self):
        ledger={'pnu':'2638010100102130017','jibun':'213-17','lotAreaM2':222.0,'archAreaM2':119.05,'totalAreaM2':382.21,'groundFloors':4}
        with patch.object(bridge,'_bound_state_locked',return_value={'document':DOC}),patch.object(parcel_service,'ledger',return_value=ledger):
            out,filled=bridge._extension_from_ledger({'target':{},'added':{'floor':30}})
        self.assertEqual((out['existing'],out['siteArea'],out['floors']),({'arch':119.05,'floor':382.21},222.0,4))
        self.assertEqual(filled['existing.floor']['from'],'건축물대장 213-17')

    def test_given_values_are_kept_and_no_lookup(self):
        with patch.object(parcel_service,'ledger',side_effect=AssertionError('조회 안 함')):
            args={'target':{},'existing':{'arch':1,'floor':2}}
            self.assertEqual(bridge._extension_from_ledger(args),(args,{}))


if __name__=='__main__':unittest.main()
