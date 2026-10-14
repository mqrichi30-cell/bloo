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


def test_hero_leaves_one_gpt_slot_for_story(monkeypatch):
    class G:
        def configured(self): return True
        def available(self): return True
        def already_paid(self, _): return False
        def spent_today(self): return 1
    monkeypatch.setenv("OPENAI_MAX_IMAGES_PER_DAY", "2")
    monkeypatch.setattr(run, "review_available", lambda *a: True)
    assert run.gpt_usable(G(), "hero", "x", object(), None) != ""
    assert run.gpt_usable(G(), run.STORY, "x", object(), None) == ""
