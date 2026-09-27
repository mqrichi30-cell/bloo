"""Offline tests: AI reviewer parsing, auto-correct loop, reflection removal, duplicate check.

Run from imagegen/:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from imagegen import edit, reflection, review, run  # noqa: E402
from imagegen.providers import ProviderError, QuotaExhausted  # noqa: E402
from test_edit import FakeEditor, FakeReviewer, glasses, scene_with  # noqa: E402

GOOD = {"glasses_count": 1, "reflection_or_duplicate": False, "floating": False, "matches_reference": True,
        "hands_or_people": False, "added_text_or_logo": False, "scene_ok": True,
        "warped_or_extra_parts": False, "defects": [], "pass": True, "fix_hint": ""}


def with_reflection(cut: Image.Image, strength: float = 0.7) -> Image.Image:
    """The glasses standing on a glossy floor: a dimmer upside-down copy touching them from below."""
    w, h = cut.size
    rows = np.nonzero(np.asarray(cut.getchannel("A")).max(1) > 0)[0]
    bottom = int(rows.max()) + 1  # the copy is mirrored about the glasses' bottom edge (contact)
    canvas = Image.new("RGBA", (w, 2 * bottom), (0, 0, 0, 0))
    mirror = cut.transpose(Image.FLIP_TOP_BOTTOM)
    arr = np.asarray(mirror).astype(np.float32)
    arr[..., :3] *= strength
    canvas.paste(Image.fromarray(np.uint8(arr), "RGBA"), (0, 2 * bottom - h))
    canvas.alpha_composite(cut, (0, 0))
    return canvas


class ParseTests(unittest.TestCase):
    def test_fenced_json_with_prose(self) -> None:
        raw = review.extract_json('Sure!\n```json\n{"a": {"b": "}"}, "pass": true}\n```\nbye')
        self.assertEqual(raw, {"a": {"b": "}"}, "pass": True})

    def test_unparseable_is_fail(self) -> None:
        v = review.normalize(review.extract_json("the image looks fine"))
        self.assertFalse(v["pass"])
        self.assertIn("review_unparseable", v["defects"])

    def test_good_passes(self) -> None:
        self.assertTrue(review.normalize(dict(GOOD))["pass"])

    def test_verdict_recomputed_from_answers(self) -> None:
        v = review.normalize({**GOOD, "glasses_count": 2, "reflection_or_duplicate": True})
        self.assertFalse(v["pass"])  # the model said pass=true, the answers say otherwise
        self.assertIn("reflection_or_duplicate", v["defects"])
        self.assertIn("glasses_count=2", v["defects"])

    def test_string_booleans_and_missing_fields(self) -> None:
        self.assertTrue(review.normalize({**GOOD, "floating": "false", "pass": "true"})["pass"])
        v = review.normalize({k: val for k, val in GOOD.items() if k != "scene_ok"})
        self.assertIn("scene_ok=missing", v["defects"])

    def test_model_fail_without_reason_still_fails(self) -> None:
        self.assertFalse(review.normalize({**GOOD, "pass": False})["pass"])


class FakeResp:
    def __init__(self, status: int, body: Any, text: str = "") -> None:
        self.status_code, self._body, self.text, self.headers = status, body, text or str(body), {}

    def json(self) -> Any:
        return self._body


class ReviewerCallTests(unittest.TestCase):
    ENV = {"CF_ACCOUNT_ID": "acc", "CF_API_TOKEN": "tok", "CF_REVIEW_MODELS": ""}

    def setUp(self) -> None:
        p = mock.patch.dict("os.environ", self.ENV)
        p.start()
        self.addCleanup(p.stop)
        self.img = Image.new("RGB", (64, 64), (200, 190, 170))

    def _resp(self, content: str, neurons: float = 11.3) -> FakeResp:
        return FakeResp(200, {"result": {"choices": [{"message": {"content": content}}],
                                         "usage": {"neurons": neurons}}})

    def test_ledger_booked_with_actual_usage(self) -> None:
        state: dict[str, Any] = {}
        import json
        with mock.patch.object(review.requests, "post", return_value=self._resp(json.dumps(GOOD))) as post:
            v = review.VisionReviewer(state).review(self.img, self.img)
        self.assertTrue(v["pass"])
        self.assertAlmostEqual(state["cf_neurons"]["used"], 11.3, places=1)
        body = post.call_args.kwargs["json"]
        self.assertFalse(body["chat_template_kwargs"]["enable_thinking"])
        self.assertIn("gemma-4", post.call_args.args[0])

    def test_reasks_once_then_fails_if_still_garbage(self) -> None:
        with mock.patch.object(review.requests, "post", return_value=self._resp("no json here")) as post:
            v = review.VisionReviewer({}).review(self.img, self.img)
        self.assertEqual(post.call_count, 2)
        self.assertFalse(v["pass"])

    def test_falls_back_to_second_model_on_error(self) -> None:
        import json
        with mock.patch.object(review.requests, "post",
                               side_effect=[FakeResp(500, {}, "oops"), self._resp(json.dumps(GOOD), 90)]) as post:
            v = review.VisionReviewer({}).review(self.img, self.img)
        self.assertTrue(v["pass"])
        self.assertIn("qwen", v["model"])
        self.assertEqual(post.call_count, 2)

    def test_all_models_down_is_provider_error(self) -> None:
        with mock.patch.object(review.requests, "post", return_value=FakeResp(503, {}, "down")):
            with self.assertRaises(ProviderError):
                review.VisionReviewer({}).review(self.img, self.img)

    def test_neuron_cap_is_quota(self) -> None:
        with mock.patch.object(review.requests, "post", return_value=FakeResp(429, {}, "daily neuron limit")):
            with self.assertRaises(QuotaExhausted):
                review.VisionReviewer({}).review(self.img, self.img)


def shades(**kw: Any) -> Image.Image:
    """Synthetic glasses whose lenses differ in brightness from the frame (as real ones do)."""
    return glasses(color=(160, 70, 60), lens=(40, 40, 48), **kw)


class ReflectionTests(unittest.TestCase):
    def test_single_pair_untouched(self) -> None:
        for cut in (shades(), shades(h=150, bridge=False), shades(w=400, h=260)):
            out, info = reflection.remove_reflection(cut)
            self.assertFalse(info["reflection"])
            self.assertEqual(out.size, cut.size)

    def test_mirror_reflection_is_cut_off(self) -> None:
        cut = shades()
        out, info = reflection.remove_reflection(with_reflection(cut))
        self.assertTrue(info["reflection"])
        self.assertLess(abs(out.height - cut.height), 0.15 * cut.height)  # back to ~one pair tall
        a = np.asarray(out.getchannel("A"), np.float32)
        ref = np.asarray(cut.getchannel("A"), np.float32)
        self.assertGreater(a.sum() / ref.sum(), 0.85)  # the real glasses survive

    def test_output_duplicate_check(self) -> None:
        ref = edit.build_reference(shades())
        img, a = scene_with(ref, 2.0, 0.0, (0, 0), size=(1024, 1280))
        self.assertTrue(reflection.duplicate_check(img, a)[0])
        ref2 = edit.build_reference(with_reflection(shades()), margin=0.05)
        img2, a2 = scene_with(ref2, 1.6, 0.0, (0, 0), size=(1024, 1280))
        ok, reason, _ = reflection.duplicate_check(img2, a2)
        self.assertFalse(ok)
        self.assertIn("reflection", reason)

    def test_two_separate_pairs_rejected(self) -> None:
        ref = edit.build_reference(shades())
        img, a = scene_with(ref, 1.0, 0.0, (0, -250), size=(1024, 1280))
        img2, a2 = scene_with(ref, 1.0, 0.0, (0, 250), size=(1024, 1280))
        both = np.maximum(a, a2)
        comp = Image.composite(img2, img, Image.fromarray(np.uint8(a2 * 255)))
        ok, reason, _ = reflection.duplicate_check(comp, both)
        self.assertFalse(ok)
        self.assertIn("second pair", reason)


class CorrectionPromptTests(unittest.TestCase):
    def test_defects_become_negatives(self) -> None:
        p = edit.correction_prompt("hero", ["reflection_or_duplicate", "scene_incomplete"], "Remove the mirror copy")
        self.assertTrue(p.startswith(edit.EDIT_PROMPTS["hero"]))
        self.assertIn("no reflection", p)
        self.assertIn("monstera", p)
        self.assertIn("Remove the mirror copy.", p)

    def test_no_defects_no_suffix(self) -> None:
        self.assertEqual(edit.correction_prompt("flatlay", []), edit.EDIT_PROMPTS["flatlay"])


class AutoCorrectLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cut = glasses()
        ref = edit.build_reference(self.cut)
        self.good, self.good_a = scene_with(ref, 2.0, 0.0, (0, 80), size=(1024, 1280))
        seg = mock.patch.object(run, "segment_alpha", return_value=self.good_a)
        seg.start()
        self.addCleanup(seg.stop)

    def test_ai_fail_then_pass_feeds_defects_back(self) -> None:
        prompts: list[str] = []
        ed = FakeEditor([self.good, self.good])
        orig = ed.edit

        def spy(prompt: str, *a: Any) -> Any:
            prompts.append(prompt)
            return orig(prompt, *a)

        ed.edit = spy  # type: ignore[method-assign]
        rv = FakeReviewer([{"pass": False, "defects": ["reflection_or_duplicate"], "fix_hint": "one pair only"}])
        outs, meta = run.edit_scene(self.cut, "hero", ed, rv)  # type: ignore[arg-type]
        self.assertIsNotNone(outs)
        self.assertEqual(rv.calls, 2)
        self.assertEqual(prompts[0], edit.EDIT_PROMPTS["hero"])
        self.assertIn("no mirror image", prompts[1])
        self.assertIn("one pair only", prompts[1])
        self.assertTrue(meta["aiReview"]["pass"])
        self.assertTrue(meta["attempts"][1]["corrected"])

    def test_three_ai_failures_report_ai_review_failed(self) -> None:
        bad = {"pass": False, "defects": ["reflection_or_duplicate"], "fix_hint": ""}
        ed = FakeEditor([self.good] * 3)
        rv = FakeReviewer([dict(bad), dict(bad), dict(bad)])
        outs, meta = run.edit_scene(self.cut, "hero", ed, rv)  # type: ignore[arg-type]
        self.assertIsNone(outs)
        self.assertEqual(ed.calls, 3)  # first try + 2 corrections
        payload = run._edit_failure(meta, {})
        self.assertEqual(payload["estado"], "error")
        self.assertTrue(payload["error"].startswith("ai_review_failed: reflection_or_duplicate"))
        self.assertEqual(payload["retryAfterSeconds"], 3600)
        self.assertFalse(payload["qa"]["aiReview"]["pass"])

    def test_reviewer_down_is_unavailable_not_lista(self) -> None:
        ed = FakeEditor([self.good])
        outs, meta = run.edit_scene(self.cut, "hero", ed, FakeReviewer([ProviderError("down")]))  # type: ignore[arg-type]
        self.assertIsNone(outs)
        payload = run._edit_failure(meta, {})
        self.assertEqual((payload["error"], payload["retryAfterSeconds"]), ("ai_review_unavailable", 900))

    def test_reviewer_quota_is_quota_wait(self) -> None:
        ed = FakeEditor([self.good])
        outs, meta = run.edit_scene(self.cut, "hero", ed,  # type: ignore[arg-type]
                                    FakeReviewer([QuotaExhausted(run.now_ts() + 5000, "neurons")]))
        self.assertEqual(run._edit_failure(meta, {})["error"], run.QUOTA_WAIT)

    def test_no_reviewer_never_lista(self) -> None:
        outs, meta = run.edit_scene(self.cut, "hero", FakeEditor([self.good]), None)  # type: ignore[arg-type]
        self.assertIsNone(outs)
        self.assertEqual(run._edit_failure(meta, {})["error"], "ai_review_unavailable")

    def test_lista_payload_carries_ai_review(self) -> None:
        job = mock.Mock(image_id="i1", model_id="m1", variant="hero", source_url="https://x/y.jpg")
        img = Image.new("RGB", (64, 64))
        hand = mock.Mock(has_hand=False, as_dict=lambda: {})
        storage = mock.Mock(public_url=lambda p: f"https://sb.invalid/{p}")
        verdict = {"pass": True, "defects": [], "model": "gemma"}
        with mock.patch.object(run, "load_source", return_value=img), \
                mock.patch.object(run, "cut_out", return_value=(glasses(), hand)), \
                mock.patch.object(run, "to_jpeg", return_value=b"j"), \
                mock.patch.object(run, "run_qa", return_value={"skipped": "no key"}), \
                mock.patch.object(run, "edit_scene",
                                  return_value=({"1x1": img, "4x5": img}, {"model": "k4b", "aiReview": verdict})):
            out = run.process_job(job, mock.Mock(), storage, mock.Mock(), mock.Mock())
        self.assertEqual(out["estado"], "lista")
        self.assertEqual(out["qa"]["aiReview"], verdict)
        self.assertFalse(out["qa"]["edit"]["source"]["reflection"])


if __name__ == "__main__":
    unittest.main()
