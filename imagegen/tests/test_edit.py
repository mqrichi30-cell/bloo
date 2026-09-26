"""Offline tests for the FLUX.2 edit path: fidelity gate, alignment, restore, neuron ledger, requeue.

Run from imagegen/:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from imagegen import edit, providers, requeue, run  # noqa: E402
from imagegen.providers import QuotaExhausted  # noqa: E402


def glasses(w: int = 600, h: int = 240, color: tuple[int, int, int] = (110, 30, 40),
            lens: tuple[int, int, int] = (70, 50, 30), bridge: bool = True) -> Image.Image:
    """Synthetic RGBA 'sunglasses': two rings with lenses, a bridge and a temple arm."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for x0 in (20, w // 2 + 10):
        d.ellipse((x0, 40, x0 + w // 2 - 40, h - 20), fill=color + (255,))
        d.ellipse((x0 + 18, 58, x0 + w // 2 - 58, h - 38), fill=lens + (255,))
    if bridge:
        d.rectangle((w // 2 - 30, 90, w // 2 + 30, 110), fill=color + (255,))
    d.polygon([(w - 40, 60), (w - 5, 10), (w - 2, 22), (w - 30, 80)], fill=color + (255,))
    return im


def scene_with(ref: edit.Reference, scale: float, angle: float, shift: tuple[int, int],
               size: tuple[int, int] = (512, 640), recolor: tuple[int, int, int] | None = None,
               cut_override: Image.Image | None = None) -> tuple[Image.Image, np.ndarray]:
    """Fake edit output: beige linen with the reference product warped by a similarity."""
    W, H = size
    bg = np.zeros((H, W, 3), np.float32) + np.array([214, 200, 176], np.float32)
    bg += np.random.default_rng(0).normal(0, 3, (H, W, 1))
    src = ref.image.convert("RGB")
    alpha = ref.alpha
    if cut_override is not None:
        r2 = edit.build_reference(cut_override)
        src, alpha = r2.image.convert("RGB"), r2.alpha
    cx, cy, _ = edit._moments(alpha)
    fit = edit.Fit(scale, angle, W / 2 + shift[0], H / 2 + shift[1], cx, cy)
    a = np.asarray(edit.warp_to(alpha, fit, size), np.float32) / 255
    rgb = np.asarray(edit.warp_to(src, fit, size), np.float32)
    if recolor is not None:
        rgb = np.zeros_like(rgb) + np.array(recolor, np.float32)
    out = bg * (1 - a[..., None]) + rgb * a[..., None]
    return Image.fromarray(np.uint8(np.clip(out, 0, 255))), a


class GateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ref = edit.build_reference(glasses())

    def test_reference_is_under_512(self) -> None:
        self.assertEqual(self.ref.image.size, (edit.REF_SIDE, edit.REF_SIDE))
        self.assertLess(edit.REF_SIDE, 512)
        self.assertGreater(self.ref.alpha.sum(), 1000)

    def test_same_product_moved_scaled_rotated_passes(self) -> None:
        out, a = scene_with(self.ref, 1.3, 4.0, (20, 60))
        rep = edit.fidelity_gate(self.ref, out, a)
        self.assertTrue(rep.ok, (rep.reason, rep.stats))
        self.assertAlmostEqual(rep.fit.scale, 1.3, delta=0.05)
        self.assertAlmostEqual(rep.fit.angle, 4.0, delta=1.5)

    def test_redesigned_frame_is_rejected(self) -> None:
        other = glasses(w=600, h=150, bridge=False)  # flatter lenses, no bridge
        out, a = scene_with(self.ref, 1.2, 0.0, (0, 40), cut_override=other)
        rep = edit.fidelity_gate(self.ref, out, a)
        self.assertFalse(rep.ok)
        self.assertIn("silhouette", rep.reason)

    def test_recoloured_frame_is_rejected(self) -> None:
        out, a = scene_with(self.ref, 1.2, 0.0, (0, 40), recolor=(30, 120, 40))
        rep = edit.fidelity_gate(self.ref, out, a)
        self.assertFalse(rep.ok)
        self.assertTrue("colour" in rep.reason or "tone" in rep.reason, rep.reason)

    def test_restore_puts_real_pixels_back(self) -> None:
        out, a = scene_with(self.ref, 1.2, 0.0, (0, 40), recolor=(200, 200, 200))
        rep = edit.fidelity_gate(self.ref, out, a)  # colour fails, but the fit is still valid
        restored = np.asarray(edit.restore_product(out, self.ref, rep.fit, a), np.float32)
        core = np.asarray(Image.fromarray(np.uint8(a > 0.9) * 255).filter(ImageFilter.MinFilter(7))) > 0
        # real frame is dark red/brown: restored core must be far darker than the grey rendition...
        self.assertLess(restored[core].mean(), 170)
        # ...and the linen outside the product is untouched
        far = ~(np.asarray(Image.fromarray(np.uint8(a > 0.05) * 255).filter(ImageFilter.MaxFilter(9))) > 0)
        self.assertLess(np.abs(restored[far] - np.asarray(out, np.float32)[far]).max(), 1.0)

    def test_second_pair_is_dropped_from_reference(self) -> None:
        g = glasses()
        two = Image.new("RGBA", (g.width, g.height * 2 + 80), (0, 0, 0, 0))
        two.paste(g, (0, 0))
        small = g.resize((g.width * 3 // 4, g.height * 3 // 4))
        two.paste(small, (0, g.height + 80))
        ref = edit.build_reference(two)
        ys = np.nonzero((ref.alpha > 0.5).any(axis=1))[0]
        xs = np.nonzero((ref.alpha > 0.5).any(axis=0))[0]
        self.assertLess((ys.max() - ys.min()) / (xs.max() - xs.min()), 0.6)  # one pair: wide, not tall

    def test_outputs_have_catalog_sizes(self) -> None:
        out, a = scene_with(self.ref, 1.2, 0.0, (0, 40), size=(1024, 1280))
        outs = edit.to_outputs(out, a, run.OUTPUT_SIZES)
        self.assertEqual(outs["1x1"].size, (1080, 1080))
        self.assertEqual(outs["4x5"].size, (1080, 1350))
        self.assertTrue(edit.product_fits_square(a, 1080 / 1350))


class NeuronTests(unittest.TestCase):
    def test_costs(self) -> None:
        self.assertAlmostEqual(providers.cf_neurons("flux-2-klein-4b", 1024, 1280, [(511, 511)]), 161.67, 2)
        self.assertAlmostEqual(providers.cf_neurons("flux-1-schnell", 1024, 1024), 57.6, 2)
        self.assertGreater(providers.cf_neurons("flux-2-klein-9b", 1024, 1280, [(511, 511)]), 1400)
        self.assertGreater(providers.cf_neurons("flux-2-dev", 1024, 1280, [(511, 511)], steps=25), 4000)

    def test_ledger_blocks_at_budget_and_resets_daily(self) -> None:
        state: dict[str, Any] = {}
        with mock.patch.object(providers, "CF_NEURON_BUDGET", 400.0):
            providers.cf_reserve(state, 161.7)
            providers.cf_reserve(state, 161.7)
            with self.assertRaises(QuotaExhausted):
                providers.cf_reserve(state, 161.7)
            state["cf_neurons"]["day"] = "2000-01-01"
            providers.cf_reserve(state, 161.7)  # new UTC day: fresh budget
            self.assertAlmostEqual(state["cf_neurons"]["used"], 161.7, 1)

    def test_edit_provider_unavailable_without_budget_or_keys(self) -> None:
        env = {"CF_ACCOUNT_ID": "a", "CF_API_TOKEN": "t", "CF_EDIT_DISABLED": ""}
        with mock.patch.dict("os.environ", env):
            state: dict[str, Any] = {}
            p = providers.CloudflareEdit(state)
            self.assertTrue(p.available())
            state["cf_neurons"]["used"] = providers.CF_NEURON_BUDGET - 10
            self.assertFalse(p.available())
        with mock.patch.dict("os.environ", {"CF_ACCOUNT_ID": "", "CF_API_TOKEN": ""}):
            self.assertFalse(providers.CloudflareEdit({}).available())


class FakeEditor:
    def __init__(self, results: list[Any]) -> None:
        self.results = results
        self.calls = 0
        self.exhausted: float | None = None

    def available(self) -> bool:
        return True

    def edit(self, prompt: str, ref: Image.Image, size: tuple[int, int], seed: int) -> tuple[Image.Image, str]:
        self.calls += 1
        r = self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return r, "flux-2-klein-4b"

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        self.exhausted = reset_at


class EditSceneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cut = glasses()
        ref = edit.build_reference(self.cut)
        self.good, self.good_a = scene_with(ref, 2.0, 0.0, (0, 80), size=(1024, 1280))
        self.bad, self.bad_a = scene_with(ref, 2.0, 0.0, (0, 80), size=(1024, 1280),
                                          cut_override=glasses(h=150, bridge=False))

    def test_retry_once_then_accept(self) -> None:
        masks = [self.bad_a, self.good_a]
        ed = FakeEditor([self.bad, self.good])
        with mock.patch.object(run, "segment_alpha", side_effect=lambda img: masks.pop(0)):
            outs, meta = run.edit_scene(self.cut, "hero", ed)  # type: ignore[arg-type]
        self.assertIsNotNone(outs)
        self.assertEqual(ed.calls, 2)
        self.assertFalse(meta["attempts"][0]["ok"])
        self.assertTrue(meta["attempts"][1]["ok"])

    def test_two_rejections_return_none(self) -> None:
        ed = FakeEditor([self.bad, self.bad])
        with mock.patch.object(run, "segment_alpha", return_value=self.bad_a):
            outs, meta = run.edit_scene(self.cut, "hero", ed)  # type: ignore[arg-type]
        self.assertIsNone(outs)
        self.assertEqual(len(meta["attempts"]), 2)

    def test_quota_returns_none_and_marks_exhausted(self) -> None:
        ed = FakeEditor([QuotaExhausted(123.0, "neurons")])
        outs, meta = run.edit_scene(self.cut, "hero", ed)  # type: ignore[arg-type]
        self.assertIsNone(outs)
        self.assertEqual(ed.exhausted, 123.0)
        self.assertIn("quota", meta["skipped"])
        self.assertEqual(meta["quota_reset"], 123.0)


class ProcessJobEditOnlyTests(unittest.TestCase):
    """Default (IMAGEGEN_ALLOW_COMPOSITE unset): never composite, never 'lista' without a gated edit."""

    def setUp(self) -> None:
        env = mock.patch.dict("os.environ", {"IMAGEGEN_ALLOW_COMPOSITE": ""})
        env.start()
        self.addCleanup(env.stop)
        self.job = mock.Mock(image_id="i1", model_id="m1", variant="hero", source_url="https://x/y.jpg")
        img = Image.new("RGB", (64, 64))
        hand = mock.Mock(has_hand=False, as_dict=lambda: {})
        self.storage = mock.Mock(public_url=lambda p: f"https://sb.invalid/{p}")
        self.pool = mock.Mock()
        for name, kw in (("load_source", {"return_value": img}),
                         ("cut_out", {"return_value": (img.convert("RGBA"), hand)}),
                         ("to_jpeg", {"return_value": b"jpg"})):
            p = mock.patch.object(run, name, **kw)
            p.start()
            self.addCleanup(p.stop)
        self.composite = mock.patch.object(run, "composite", side_effect=AssertionError("composite called"))
        self.composite.start()
        self.addCleanup(self.composite.stop)
        self.outs = {"1x1": img, "4x5": img}

    def process(self, scene: tuple[Any, dict[str, Any]], qa_failed: list[str] | None = None) -> dict[str, Any]:
        with mock.patch.object(run, "edit_scene", return_value=scene),                 mock.patch.object(run, "run_qa", return_value={"failed": qa_failed or []}):
            return run.process_job(self.job, self.pool, self.storage, mock.Mock())

    def test_gate_failed_after_retry_is_error_not_lista(self) -> None:
        meta = {"path": "edit", "attempts": [{"ok": False}, {"ok": False}]}
        out = self.process((None, meta))
        self.assertEqual(out["estado"], "error")
        self.assertEqual(out["error"], "edit_gate_failed")
        self.assertEqual(out["retryAfterSeconds"], 3600)
        self.assertEqual(len(out["qa"]["edit"]["attempts"]), 2)
        self.pool.acquire.assert_not_called()
        self.storage.upload.assert_not_called()

    def test_vision_qa_failure_is_edit_gate_failed(self) -> None:
        out = self.process((self.outs, {"model": "flux-2-klein-4b", "attempts": []}), ["product_differs"])
        self.assertEqual((out["estado"], out["error"]), ("error", "edit_gate_failed"))
        self.storage.upload.assert_not_called()

    def test_gated_edit_is_lista_with_cfedit_prefix(self) -> None:
        out = self.process((self.outs, {"model": "flux-2-klein-4b", "attempts": []}))
        self.assertEqual(out["estado"], "lista")
        self.assertEqual(out["provider"], "cfedit:flux-2-klein-4b")

    def test_quota_is_quota_wait(self) -> None:
        out = self.process((None, {"skipped": "quota: x", "quota_reset": run.now_ts() + 7200}))
        self.assertEqual(out["error"], run.QUOTA_WAIT)
        self.assertGreater(out["retryAfterSeconds"], 7000)

    def test_provider_error_is_retried_later(self) -> None:
        out = self.process((None, {"skipped": "provider error: HTTPError"}))
        self.assertEqual((out["estado"], out["error"]), ("error", "edit_provider_error"))
        self.assertIn("retryAfterSeconds", out)

    def test_composite_only_when_opted_in(self) -> None:
        self.composite.stop()
        self.pool.acquire.return_value = (Image.new("RGB", (64, 64)), "plates/hero/1-cf-x.jpg")
        with mock.patch.dict("os.environ", {"IMAGEGEN_ALLOW_COMPOSITE": "1"}),                 mock.patch.object(run, "composite", return_value=Image.new("RGB", (64, 64))):
            out = self.process((None, {"attempts": [{"ok": False}]}))
        self.composite.start()
        self.assertEqual(out["estado"], "lista")
        self.assertFalse(out["provider"].startswith("cfedit:"))


class FakeCursor:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows, self.executed, self.rowcount = rows, [], 0

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    def fetchall(self) -> list[tuple]:
        return self.rows

    def fetchone(self) -> tuple:
        return (len(self.rows),)


class FakeConn:
    def __init__(self, rows: list[tuple]) -> None:
        self.cur = FakeCursor(rows)

    def transaction(self) -> Any:
        return mock.MagicMock()

    def cursor(self) -> FakeCursor:
        return self.cur


class RequeueTests(unittest.TestCase):
    ROWS = [("old1", "m1", "hero", "https://img.nihaojewelry.com/a.jpg"),
            ("old2", "m2", "hero", "https://img.nihaojewelry.com/b.jpg")]

    def test_dry_run_writes_nothing(self) -> None:
        conn = FakeConn(self.ROWS)
        rows = requeue.requeue(conn, apply=False)
        self.assertEqual(len(rows), 2)
        self.assertFalse(any("INSERT" in s for s, _ in conn.cur.executed))

    def test_apply_inserts_one_pending_row_per_lista(self) -> None:
        conn = FakeConn(self.ROWS)
        requeue.requeue(conn, apply=True)
        ins = [p for s, p in conn.cur.executed if "INSERT" in s]
        self.assertEqual(len(ins), 2)
        self.assertEqual(ins[0][:4], ("m1", "hero", "https://img.nihaojewelry.com/a.jpg", "old1"))
        # never touches the old rows: they stay 'lista' until the new ones are ready
        self.assertFalse(any("UPDATE" in s for s, _ in conn.cur.executed))

    def test_candidate_query_is_idempotent_and_skips_paused(self) -> None:
        q = requeue.CANDIDATES
        self.assertIn("NOT EXISTS", q)
        self.assertIn("'pendiente', 'generando', 'error', 'lista'", q)
        self.assertIn("'pausado', 'vendido'", q)


if __name__ == "__main__":
    unittest.main()
