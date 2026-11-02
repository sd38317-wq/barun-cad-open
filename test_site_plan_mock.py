import copy
import os
import unittest
from unittest.mock import patch
import site_plan_mock as mock
import site_plan_service as service

class SitePlanMockTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ, {"BARUN_SITE_PLAN_MOCK":"1"})
        self.env.start()
        mock._JOBS.clear()
        self.spec={"site":{"crs":"EPSG:5187","parcel":[[200000,400000],[200020,400000],[200020,400010],[200000,400010]]},"zoning":{},"program":{"floors":3}}
    def tearDown(self):
        mock._JOBS.clear()
        self.env.stop()
    def test_service_submit_poll_contract_and_snapshot(self):
        original=copy.deepcopy(self.spec)
        submitted,code=service.process_jobs({"action":"submit","request":self.spec})
        self.assertEqual(code,202)
        self.assertEqual(submitted["status"],"queued")
        jid=submitted["job_id"]
        self.spec["program"]["floors"]=9
        running,code=service.process_jobs({"action":"status","jobId":jid})
        self.assertEqual(running["status"],"running")
        mock._JOBS[jid]["created"]-=mock.MOCK_DELAY_SECONDS
        done,code=service.process_jobs({"action":"status","jobId":jid})
        self.assertEqual(done["status"],"succeeded")
        result=done["result"]
        self.assertEqual(result["entities"]["units"],"m")
        self.assertEqual(result["entities"]["crs"],"EPSG:5187")
        self.assertTrue(result["report"]["meta"]["mock"])
        self.assertEqual(result["report"]["numbers"]["floors"],3)
        self.assertEqual(len(result["report"]["geometry"]["floors"]),3)
        self.assertFalse(result["report"]["sunlight"]["applies"])
        self.assertTrue(result["report"]["warnings"])
        self.assertFalse(result["report"]["checks"][0]["ok"])
        self.assertEqual(result["entities"]["entities"][0]["points"],original["site"]["parcel"])
    def test_default_and_non_one_never_use_mock(self):
        for value in ("", "0", "true"):
            with patch.dict(os.environ,{"BARUN_SITE_PLAN_MOCK":value}),patch.object(service,"_json_request",return_value={"job_id":"a"*32,"status":"queued"}) as remote:
                self.assertIsNone(mock.generate(self.spec))
                service.process_jobs({"action":"submit","request":self.spec})
                remote.assert_called_once()
    def test_expired_and_bounded(self):
        submitted=mock.generate(self.spec)
        mock._JOBS[submitted["job_id"]]["created"]-=901
        self.assertEqual(mock.status(submitted["job_id"])[1],404)
        with patch.object(mock,"MOCK_MAX_JOBS",1):
            mock.generate(self.spec)
            with self.assertRaises(RuntimeError):mock.generate(self.spec)
    def test_sync_mock_waits_without_network(self):
        with patch("time.sleep") as sleep,patch.object(service.urllib.request,"urlopen") as remote:
            result,code=service.process(self.spec,"generate")
            self.assertEqual(code,200)
            self.assertTrue(result["meta"]["mock"])
            self.assertEqual(result["entities"]["units"],"m")
            sleep.assert_called_once_with(mock.MOCK_DELAY_SECONDS)
            remote.assert_not_called()

if __name__=="__main__":unittest.main()
