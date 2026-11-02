"""One-shot converter warmup must yield to real drawing work."""
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import batch_converter as bc


class FakeProcess:
    def __init__(self, *args, **kwargs):
        self.args = args[0]
        self.kwargs = kwargs
        self.returncode = 0
        self.killed = False
    def communicate(self, timeout=None): return (b'', None)
    def poll(self): return self.returncode
    def kill(self): self.killed = True; self.returncode = -9


@unittest.skipUnless(os.name == 'nt', 'Windows converter warmup')
class ConverterWarmupTest(unittest.TestCase):
    def setUp(self):
        self.old = bc._WARMUP
        bc._WARMUP = None
    def tearDown(self):
        bc.cancel_warmup()
        if bc._WARMUP and bc._WARMUP.thread: bc._WARMUP.thread.join(2)
        bc._WARMUP = self.old

    def schedule(self, delay=0):
        with patch.dict(os.environ, {'BARUN_DWG_WARMUP': '1'}):
            return bc.schedule_warmup(delay=delay)

    def test_disabled_has_no_thread_or_process(self):
        with patch.dict(os.environ, {'BARUN_DWG_WARMUP': '0'}), patch.object(bc.threading, 'Thread') as thread:
            self.assertIsNone(bc.schedule_warmup(delay=0)); thread.assert_not_called()

    def test_schedule_is_delayed_once_and_does_not_start_a_converter_at_startup(self):
        with patch.object(bc.subprocess, 'Popen') as popen:
            first = self.schedule(60)
            self.assertIs(first, self.schedule(60))
            self.assertTrue(first.thread.daemon)
            popen.assert_not_called()
            bc.cancel_warmup(); first.thread.join(1)
            self.assertFalse(first.thread.is_alive())

    def test_foreground_before_delay_permanently_skips_warmup(self):
        with patch.object(bc.subprocess, 'Popen') as popen:
            task = self.schedule(60); bc.cancel_warmup(); task.thread.join(1)
            self.assertIs(task, self.schedule(0)); popen.assert_not_called()

    def test_busy_or_battery_or_recent_input_skips_without_waiting_for_lock(self):
        with patch.object(bc, '_warmup_allowed', return_value=False), patch.object(bc.subprocess, 'Popen') as popen:
            task = self.schedule(); task.thread.join(2); popen.assert_not_called()
        bc._WARMUP = None
        with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen') as popen:
            with bc.LOCK:
                task = self.schedule(); task.thread.join(2)
                self.assertFalse(task.thread.is_alive()); popen.assert_not_called()

    def test_one_tiny_verified_conversion_uses_low_priority_timeout_job_and_own_temp(self):
        calls = []; prepared = []
        def spawn(args, **kwargs):
            calls.append(FakeProcess(args, **kwargs))
            import ezdxf
            doc = ezdxf.readfile(args[1]); prepared.append((len(doc.modelspace()), doc.modelspace()[0].dxf.layer))
            self.assertNotEqual(Path(args[1]).parent, bc.RUNTIME)
            self.assertEqual(Path(args[1]).parent, Path(args[2]).parent)
            self.assertNotIn('--defer-verify', args)
            return calls[-1]
        with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen', side_effect=spawn), patch.object(bc, '_attach_to_job') as attach:
            task = self.schedule(); task.thread.join(3)
            self.assertFalse(task.thread.is_alive())
            self.assertEqual(prepared, [(1, 'A-WALL')]); self.assertEqual(len(calls), 1)
            self.assertTrue(calls[0].kwargs['creationflags'] & getattr(subprocess, 'IDLE_PRIORITY_CLASS', 0))
            attach.assert_called_once_with(calls[0])
            self.assertFalse(Path(calls[0].args[1]).parent.exists())

    def test_running_warmup_is_killed_and_reaped_before_foreground_gets_lock(self):
        entered = threading.Event(); stopped = threading.Event(); events = []
        class Running(FakeProcess):
            returncode = None
            def __init__(self, *a, **kw): super().__init__(*a, **kw); self.returncode = None
            def communicate(self, timeout=None):
                entered.set()
                if not stopped.wait(2): raise AssertionError('warmup blocked foreground')
                events.append('reaped'); return (b'', None)
            def kill(self): super().kill(); events.append('killed'); stopped.set()
        with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen', Running), patch.object(bc, '_attach_to_job'):
            task = self.schedule(); self.assertTrue(entered.wait(2))
            bc.cancel_warmup()
            self.assertTrue(bc.LOCK.acquire(timeout=2))
            try: events.append('foreground')
            finally: bc.LOCK.release()
            task.thread.join(2)
            self.assertEqual(events, ['killed', 'reaped', 'foreground'])

    def test_spawn_failure_and_timeout_release_lock_and_never_escape_to_save(self):
        for failure in (OSError('blocked'), subprocess.TimeoutExpired('converter', 5)):
            bc._WARMUP = None
            with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen', side_effect=failure):
                task = self.schedule(); task.thread.join(2)
                self.assertFalse(task.thread.is_alive()); self.assertTrue(bc.LOCK.acquire(False)); bc.LOCK.release()
            with patch.object(bc, 'process', side_effect=self.convert):
                raw, _ = bc.dxf_to_dwg(b'0\nEOF\n')
                self.assertEqual(raw, b'AC1032test')

    def test_cancel_never_blocks_request_parsing_while_process_creation_is_slow(self):
        entered = threading.Event(); release = threading.Event(); cancelled = threading.Event(); calls = []
        def spawn(*args, **kwargs):
            entered.set(); release.wait(2)
            process = FakeProcess(*args, **kwargs); process.returncode = None; calls.append(process); return process
        with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen', side_effect=spawn), patch.object(bc, '_attach_to_job'):
            task = self.schedule(); self.assertTrue(entered.wait(2))
            cancel = threading.Thread(target=lambda: (task.cancel(), cancelled.set()), daemon=True); cancel.start()
            try: self.assertTrue(cancelled.wait(.2), 'a request must not wait for optional process creation')
            finally: release.set(); cancel.join(2); task.thread.join(2)
            self.assertTrue(calls[0].killed); self.assertFalse(task.thread.is_alive())

    def test_cancel_kill_failure_still_retries_cleanup_and_clears_process_reference(self):
        class RetryKill(FakeProcess):
            def __init__(self): super().__init__(['converter']); self.returncode = None; self.kill_calls = 0
            def kill(self):
                self.kill_calls += 1
                if self.kill_calls == 1: raise OSError('transient termination failure')
                super().kill()
        process = RetryKill()
        def spawn(*args, **kwargs): bc._WARMUP.cancelled.set(); return process
        with patch.object(bc, '_warmup_allowed', return_value=True), patch.object(bc.subprocess, 'Popen', side_effect=spawn), patch.object(bc, '_attach_to_job'):
            task = self.schedule(); task.thread.join(2)
            self.assertFalse(task.thread.is_alive()); self.assertIsNone(task.process)
            self.assertEqual(process.kill_calls, 2); self.assertTrue(process.killed)
            self.assertTrue(bc.LOCK.acquire(False)); bc.LOCK.release()

    def test_deadline_and_activity_kill_and_reap_a_running_converter(self):
        for activity in (True, False):
            bc._WARMUP = None; calls = []
            class Timed(FakeProcess):
                def __init__(self, *a, **kw): super().__init__(*a, **kw); self.returncode = None
                def communicate(self, timeout=None):
                    calls.append(timeout)
                    if len(calls) == 1: raise subprocess.TimeoutExpired(self.args, timeout)
                    return (b'', None)
            process = Timed(['converter'])
            with patch.object(bc, '_warmup_allowed', side_effect=[True, False] if activity else [True]), patch.object(bc.subprocess, 'Popen', return_value=process), patch.object(bc, '_attach_to_job'), patch.object(bc.time, 'monotonic', side_effect=[0, 0 if activity else 6]):
                task = self.schedule(); task.thread.join(2)
                self.assertFalse(task.thread.is_alive()); self.assertTrue(process.killed)
                self.assertEqual(calls, [0.2, 1])
                self.assertTrue(bc.LOCK.acquire(False)); bc.LOCK.release()

    def test_power_and_last_input_gate_fail_closed_and_allow_tick_rollover(self):
        import ctypes
        from types import SimpleNamespace
        for ac, idle, ok, expected in ((1, 6000, True, True), (0, 6000, True, False), (255, 6000, True, False), (1, 100, True, False), (1, 6000, False, False)):
            def power(pointer): pointer._obj.ac = ac; return ok
            def last(pointer): pointer._obj.tick = (10 - idle) & 0xffffffff; return ok
            kernel = SimpleNamespace(GetSystemPowerStatus=power, GetTickCount=unittest.mock.Mock(return_value=10))
            user = SimpleNamespace(GetLastInputInfo=last)
            with patch.object(ctypes, 'WinDLL', side_effect=[kernel, user]):
                self.assertEqual(bc._warmup_allowed(), expected)

    @staticmethod
    def convert(data):
        target = Path(data['folder']) / 'save.dwg'; target.write_bytes(b'AC1032test')
        return {'path': str(target), 'after': 1}

    def test_real_save_cancels_warmup_before_conversion_and_keeps_readback(self):
        import exchange
        from test_save_timings import drawing
        raw, _ = exchange.export_dxf(drawing())
        task = self.schedule(60)
        # Real engine, not a mock; the save itself must cancel optional preparation.
        with patch.object(task, 'cancel', wraps=task.cancel) as cancel:
            result, info = bc.dxf_to_dwg(raw)
            cancel.assert_called_once()
        task.thread.join(1)
        self.assertTrue(result.startswith(b'AC1032')); self.assertEqual(info['entities'], 3)
        self.assertIn('dxf_verify_read', info['timings_ms'])
        self.assertTrue(task.cancelled.is_set())


class FakeTimer:
    def __init__(self, delay, callback): self.delay = delay; self.callback = callback; self.daemon = False; self.started = False
    def start(self): self.started = True
    def cancel(self): pass
    def fire(self): self.callback()


class WarmupServerTest(unittest.TestCase):
    def test_server_starts_only_a_delayed_timer_and_loads_converter_in_callback(self):
        import server
        from types import SimpleNamespace
        task = SimpleNamespace(cancel=unittest.mock.Mock())
        httpd = SimpleNamespace()
        with patch.object(server.threading, 'Timer', FakeTimer), patch.object(bc, 'schedule_warmup', return_value=task) as schedule:
            timer = server.start_converter_warmup(httpd)
            self.assertEqual(timer.delay, 30); self.assertTrue(timer.daemon); self.assertTrue(timer.started)
            schedule.assert_not_called(); timer.fire(); schedule.assert_called_once_with(delay=0)
            self.assertIs(httpd.converter_warmup, task)

    def test_first_http_save_before_timer_cancels_future_warmup(self):
        import server
        from test_critic_e import LiveServer
        from test_save_timings import drawing
        with patch.object(server.threading, 'Timer', FakeTimer), patch.object(bc, 'schedule_warmup') as schedule, LiveServer() as live:
            timer = server.start_converter_warmup(live.httpd)
            status, _, result = live.post('export', {'document': drawing(), 'format': 'bcad'})
            self.assertEqual(status, 200, result); self.assertTrue(live.httpd.converter_warmup_cancelled.is_set())
            timer.fire(); schedule.assert_not_called()

    def test_http_save_during_schedule_cancels_task_before_it_can_hold_conversion_lock(self):
        import server
        from types import SimpleNamespace
        from test_critic_e import LiveServer
        from test_save_timings import drawing
        task = SimpleNamespace(cancel=unittest.mock.Mock())
        with patch.object(server.threading, 'Timer', FakeTimer), LiveServer() as live:
            def schedule(**kwargs):
                status, _, result = live.post('export', {'document': drawing(), 'format': 'bcad'})
                self.assertEqual(status, 200, result)
                return task
            with patch.object(bc, 'schedule_warmup', side_effect=schedule):
                server.start_converter_warmup(live.httpd).fire()
            task.cancel.assert_called_once()

    def test_disabled_server_creates_no_timer(self):
        import server
        from types import SimpleNamespace
        with patch.dict(os.environ, {'BARUN_DWG_WARMUP': '0'}), patch.object(server.threading, 'Timer') as timer:
            self.assertIsNone(server.start_converter_warmup(SimpleNamespace()))
            timer.assert_not_called()


@unittest.skipUnless(os.name == 'nt', 'Windows PE and loader measurements')
class StartupMeasurementTest(unittest.TestCase):
    def test_ready_to_run_checks_actual_pe_headers_and_native_exe(self):
        from tools.measure_converter_startup import ready_to_run
        self.assertTrue(ready_to_run(bc.RUNTIME / 'BarunConverter.dll')['ready_to_run'])
        self.assertTrue(ready_to_run(bc.RUNTIME / 'ACadSharp.dll')['ready_to_run'])
        self.assertFalse(ready_to_run(bc.RUNTIME / bc.CONVERTER)['ready_to_run'])

    def test_external_measurement_keeps_readback_counts_and_timing_boundaries(self):
        from tools.measure_converter_startup import measure
        from test_save_timings import drawing
        import exchange
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder); source = folder / 'input.dxf'
            source.write_bytes(exchange.export_dxf(drawing(1000))[0])
            row = measure(bc.RUNTIME, source, folder / 'output.dwg')
        self.assertEqual(row['report']['before'], 1000); self.assertEqual(row['report']['after'], 1000)
        self.assertGreaterEqual(row['first_output_ms'], row['spawn_return_ms'])
        self.assertGreaterEqual(row['wall_ms'], row['first_output_ms'])
        self.assertGreaterEqual(row['exit_after_output_ms'], 0)
        self.assertGreaterEqual(row['outside_engine_ms'], 0)
        self.assertIn('coreclr.dll', row['module_first_seen_ms'])
        self.assertIn('acadsharp.dll', row['module_first_seen_ms'])
