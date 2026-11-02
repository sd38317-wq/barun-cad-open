"""pytest 공통: 작도 기준(SERVER_KNOWLEDGE)은 실행 중에는 서버에서만 받는다(vault_gate, 2026-10-25).
시험은 서버 없이 돌아야 하므로 시험마다 소스의 rules/knowledge 파일을 '서버에서 받은 것'으로 채워 둔다.
서버 받기 자체를 시험하는 test_vault_gate 는 setUp 에서 _server 를 직접 비운다."""
import pytest
import vault_gate


@pytest.fixture(autouse=True)
def server_knowledge_from_source():
    saved = vault_gate._server
    vault_gate._server = {name: (vault_gate.KNOWLEDGE_DIR / name).read_bytes() for name in vault_gate.SERVER_KNOWLEDGE
                         if (vault_gate.KNOWLEDGE_DIR / name).is_file()}  # 공개판엔 작도 기준 파일이 없다
    yield
    vault_gate._server = saved
