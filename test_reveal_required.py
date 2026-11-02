"""그리는 연출 필수 — 도면 창이 숨겨져 연출을 보여 줄 수 없으면 그리기 도구를 거절한다(사용자 2026-10-25)."""
import unittest
import bridge


class RevealRequiredTest(unittest.TestCase):
    def setUp(self):
        self.saved = dict(bridge.clients)
        bridge.clients.clear()

    def tearDown(self):
        bridge.clients.clear()
        bridge.clients.update(self.saved)

    def target(self, visible):
        session = '11111111-1111-4111-8111-111111111111'
        bridge.clients[session] = {'visible': visible}
        return {'editor_session': session}

    def run_dispatch(self, name, target, reveal):
        """reveal: 탭이 앞으로 나왔는지(cad_reveal 답). 그리기 요청까지 가면 'drawn'."""
        sent = []
        def send(client, action, args, revision):
            sent.append(action)
            return {'visible': reveal} if action == 'cad_reveal' else 'drawn'
        original = (bridge._bound_state_locked, bridge._send_locked)
        bridge._bound_state_locked = lambda *a, **k: None
        bridge._send_locked = send
        try:
            return bridge.dispatch(name, {'target': {**target, 'revision': 1}}), sent
        finally:
            bridge._bound_state_locked, bridge._send_locked = original

    def test_hidden_window_refuses_drawing_tools(self):
        for name in ('cad_generate_drawing', 'cad_generate_drawing_bound', 'cad_generate_details'):
            target = self.target(False)
            with self.assertRaises(bridge.CADToolError) as caught:
                self.run_dispatch(name, target, reveal=False)   # 앞으로 꺼내 봐도 안 보이면(최소화·화면 잠금) 거절
            self.assertEqual(caught.exception.code, 'reveal_unavailable')

    def test_tab_behind_another_tab_is_brought_forward_then_drawn(self):
        # 2026-10-29: 미리가 PDF 를 다른 탭에 열어 제 탭이 뒤로 가자 '창이 숨겨져 있어' 로 그리기를 거절했다.
        result, sent = self.run_dispatch('cad_generate_drawing', self.target(False), reveal=True)
        self.assertEqual((result, sent), ('drawn', ['cad_reveal', 'cad_generate_drawing']))

    def test_required_tools_listed(self):
        self.assertIn('cad_generate_drawing', bridge.REVEAL_REQUIRED_TOOLS)
        self.assertIn('cad_generate_details', bridge.REVEAL_REQUIRED_TOOLS)


if __name__ == '__main__':
    unittest.main()
