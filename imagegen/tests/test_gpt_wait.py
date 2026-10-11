from imagegen import run


def test_gpt_wait_only_when_flag_and_cap(monkeypatch):
    monkeypatch.setenv("OPENAI_WAIT_FOR_CAP", "1")
    w = run.gpt_wait("daily cap reached or provider benched")
    assert w is not None and w["qa"]["quota"].startswith("gpt") and "retryAfterSeconds" in str(w)
    assert run.gpt_wait("") is None
    assert run.gpt_wait("not configured") is None
    assert run.gpt_wait("already had its paid call") is None


def test_gpt_wait_off_by_default(monkeypatch):
    monkeypatch.delenv("OPENAI_WAIT_FOR_CAP", raising=False)
    assert run.gpt_wait("daily cap reached or provider benched") is None
