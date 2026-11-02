"""첫 화면·재시작 때 로컬 엔진이 연결을 끊지 않는다(10-19 맥 개발 앱에서 디자인 없는 화면·포트 충돌로 뜨던 것)."""
import functools
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen

import server


def start(port=0):
    httpd = server.LocalServer(("127.0.0.1", port), functools.partial(server.Handler, directory=str(server.ROOT)))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


def stop(httpd, thread):
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=3)


class StartupTest(unittest.TestCase):
    def test_first_screen_burst_is_not_reset(self):
        # 첫 화면은 모듈 백여 개를 한꺼번에 연다. 기본 대기열 5개면 넘친 연결이 ERR_CONNECTION_RESET 으로 끊겼다.
        self.assertGreaterEqual(server.LocalServer.request_queue_size, 128)
        httpd, thread = start()
        try:
            url = f"http://127.0.0.1:{httpd.server_port}/app.js"

            def fetch(_):
                with urlopen(url, timeout=20) as response:
                    return response.status

            with ThreadPoolExecutor(max_workers=120) as pool:
                statuses = list(pool.map(fetch, range(120)))
            self.assertEqual(statuses, [200] * 120)
        finally:
            stop(httpd, thread)

    @unittest.skipIf(os.name == "nt", "윈도우는 남의 포트를 가로채지 않게 SO_REUSEADDR 을 켜지 않는다")
    def test_restart_on_same_port_right_after_stop(self):
        # 엔진이 먼저 닫은 연결(TIME_WAIT)이 남아도 같은 포트로 곧바로 다시 뜬다 — 껐다 켜면 '포트 충돌'로 끝나던 것.
        httpd, thread = start()
        port = httpd.server_port
        with urlopen(f"http://127.0.0.1:{port}/app.js", timeout=5) as response:
            response.read()
        stop(httpd, thread)
        again, thread2 = start(port)
        try:
            self.assertEqual(again.server_port, port)
        finally:
            stop(again, thread2)


if __name__ == "__main__":
    unittest.main()
