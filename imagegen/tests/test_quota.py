"""Offline tests (no network): per-host quota keys, claim gating, quota_wait payloads, plate reuse.

Run from imagegen/:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from imagegen import plates, providers, run  # noqa: E402
from imagegen.bloo_api import Job  # noqa: E402
from imagegen.util import now_ts  # noqa: E402

ZGPU_MSG = ("ZeroGPU quota exceeded: You have exceeded your ZeroGPU quota (90s requested vs. 0s left). "
            "Try again in 0:00:00. Authenticate with a Hugging Face token for more quota")
BASE_ENV = {"CRON_SECRET": "x", "SUPABASE_URL": "http://sb.invalid", "SUPABASE_SERVICE_KEY": "k",
            "HF_TOKEN": "", "TOGETHER_API_KEY": "", "CF_ACCOUNT_ID": "", "CF_API_TOKEN": "",
            "POLLINATIONS_TOKEN": "", "GEMINI_API_KEY": "", "HF_SPACE_DISABLED": "", "GITHUB_ACTIONS": "",
            "IMAGEGEN_ALLOW_COMPOSITE": "1"}  # these tests cover the (opt-in) plate pool


class FakeStorage:
    """In-memory Supabase Storage shared across 'hosts' (like the real bucket)."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def __call__(self, *_a: Any, **_k: Any) -> "FakeStorage":  # stands in for the Storage class
        return self

    def public_url(self, path: str) -> str:
        return f"https://sb.invalid/{path}"

    def upload(self, path: str, data: bytes, content_type: str, cache_control: str = "3600") -> str:
        self.files[path] = data
        return path

    def download(self, path: str) -> bytes | None:
        return self.files.get(path)

    def list(self, prefix: str, limit: int = 1000) -> list[str]:
        prefix = prefix.rstrip("/") + "/"
        return sorted(p for p in self.files if p.startswith(prefix))

    def read_json(self, path: str, default: Any) -> Any:
        raw = self.files.get(path)
        return json.loads(raw) if raw else default

    def write_json(self, path: str, obj: Any) -> None:
        self.files[path] = json.dumps(obj).encode()


class FakeApi:
    def __init__(self, jobs: list[Job]) -> None:
        self.queue = list(jobs)
        self.claims = 0
        self.reports: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, *_a: Any, **_k: Any) -> "FakeApi":
        return self

    def pending_count(self) -> int:
        return len(self.queue)

    def claim(self, limit: int) -> list[Job]:
        self.claims += 1
        out, self.queue = self.queue[:limit], self.queue[limit:]
        return out

    def report(self, image_id: str, payload: dict[str, Any]) -> None:
        self.reports.append((image_id, payload))


def job(i: int, variant: str = "hero") -> Job:
    return Job(image_id=f"img{i}", model_id=f"m{i}", nombre="n", color="c", variant=variant,
               source_url="https://img.nihaojewelry.com/x.jpg")


def jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (220, 210, 190)).save(buf, "JPEG")
    return buf.getvalue()


def exhausted_state(key: str) -> dict[str, Any]:
    return {key: {"exhausted_until": now_ts() + 3600}}


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.env = mock.patch.dict(os.environ, BASE_ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_worker(self, storage: FakeStorage, api: FakeApi, runner: str, max_jobs: int = 5) -> int:
        img = Image.new("RGB", (64, 64))
        rep = plates.PlateReport(True, "")
        with mock.patch.dict(os.environ, {"RUNNER_KIND": runner}), \
                mock.patch.object(run, "Storage", storage), mock.patch.object(run, "BlooApi", api), \
                mock.patch.object(run, "load_source", return_value=img), \
                mock.patch.object(run, "cut_out", return_value=(img.convert("RGBA"), mock.Mock(has_hand=False, as_dict=dict))), \
                mock.patch.object(run, "composite", return_value=img), \
                mock.patch.object(run, "run_qa", return_value={"failed": []}), \
                mock.patch.object(run, "to_jpeg", return_value=b"jpg"), \
                mock.patch.object(plates, "validate_plate", return_value=rep):
            return run.run_worker(max_jobs, 30, once=True)


class HostScopeTests(Base):
    def test_hfspace_anonymous_is_per_host(self) -> None:
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local"}):
            self.assertEqual(providers.HFSpaceFlux({}).key, "hfspace@local")
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "github"}):
            self.assertEqual(providers.HFSpaceFlux({}).key, "hfspace@github")

    def test_github_actions_default_and_hostname_default(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "RUNNER_KIND"}
        with mock.patch.dict(os.environ, {**env, "GITHUB_ACTIONS": "true"}, clear=True):
            self.assertEqual(providers.host_id(), "github")
        with mock.patch.dict(os.environ, {**env, "GITHUB_ACTIONS": ""}, clear=True), \
                mock.patch.object(providers.socket, "gethostname", return_value="CRIS-PC"):
            self.assertEqual(providers.host_id(), "cris-pc")

    def test_token_scoped_providers_stay_global(self) -> None:
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local", "HF_TOKEN": "t"}):
            self.assertEqual(providers.HFSpaceFlux({}).key, "hfspace")
            self.assertEqual(providers.CloudflareFlux({}).key, "cloudflare")
            self.assertEqual(providers.TogetherFlux({}).key, "together")
            self.assertEqual(providers.PollinationsFlux({}).key, "pollinations")

    def test_local_exhaustion_does_not_block_github(self) -> None:
        state = exhausted_state("hfspace@local")
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local"}):
            self.assertFalse(providers.ProviderChain(state).any_available())
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "github"}):
            self.assertTrue(providers.ProviderChain(state).any_available())

    def test_suspicion_is_global(self) -> None:
        state: dict[str, Any] = {}
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local"}):
            providers.HFSpaceFlux(state).mark_suspicious("wm")
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "github"}):
            self.assertFalse(providers.HFSpaceFlux(state).available())


class ZeroGpuTests(Base):
    def test_requested_over_left_waits_at_least_30_min(self) -> None:
        wait = providers.HFSpaceFlux.quota_reset_from_text(ZGPU_MSG) - now_ts()
        self.assertGreaterEqual(wait, 30 * 60 - 2)

    def test_try_again_longer_than_floor_wins(self) -> None:
        msg = ZGPU_MSG.replace("0:00:00", "2:00:00")
        self.assertGreaterEqual(providers.HFSpaceFlux.quota_reset_from_text(msg) - now_ts(), 7200)

    def test_consecutive_hits_back_off_capped(self) -> None:
        w = [providers.HFSpaceFlux.quota_reset_from_text(ZGPU_MSG, h) - now_ts() for h in (0, 1, 9)]
        self.assertLess(w[0], w[1])
        self.assertLessEqual(w[2], 6 * 3600 + 2)

    def test_not_retried_within_same_run(self) -> None:
        state: dict[str, Any] = {}
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local"}):
            chain = providers.ProviderChain(state)
            hf = chain.by_name("hfspace")
            assert hf is not None
            with mock.patch.object(providers.HFSpaceFlux, "_generate",
                                   side_effect=providers.QuotaExhausted(
                                       hf.quota_reset_from_text(ZGPU_MSG), ZGPU_MSG)) as g, \
                    mock.patch.object(providers.time, "sleep"):
                for _ in range(3):
                    with self.assertRaises(providers.QuotaExhausted):
                        chain.generate("p")
            self.assertEqual(g.call_count, 1)
            self.assertIn("hfspace@local", state)
            self.assertEqual(state["hfspace@local"]["zgpu_hits"], 1)


class PoolTests(Base):
    def test_least_used_plate_first_and_15_uses(self) -> None:
        st = FakeStorage()
        for n in ("a", "b", "c"):
            st.files[f"plates/hero/{n}.jpg"] = jpeg()
        st.files[plates.PLATE_STATE] = json.dumps({"plates/hero/a.jpg": 9, "plates/hero/b.jpg": 2,
                                                   "plates/hero/c.jpg": 14}).encode()
        with mock.patch.dict(os.environ, {"RUNNER_KIND": "local", "HF_SPACE_DISABLED": "1"}), \
                mock.patch.object(plates, "validate_plate", return_value=plates.PlateReport(True, "")):
            pool = plates.PlatePool(st, providers.ProviderChain({}))  # type: ignore[arg-type]
            self.assertEqual(plates.MAX_USES, 15)
            _, path = pool.acquire("hero")
            self.assertEqual(path, "plates/hero/b.jpg")
            self.assertTrue(pool.can_serve("hero"))
            self.assertFalse(pool.can_serve("flatlay"))


class WorkerTests(Base):
    def test_no_claim_when_nothing_can_be_served(self) -> None:
        st = FakeStorage()
        st.files[run.PROVIDER_STATE] = json.dumps(exhausted_state("hfspace@local")).encode()
        api = FakeApi([job(1)])
        self.assertEqual(self.run_worker(st, api, "local"), 0)
        self.assertEqual(api.claims, 0)
        self.assertEqual(api.reports, [])

    def test_cloud_not_blocked_by_pc_exhaustion(self) -> None:
        st = FakeStorage()
        st.files[run.PROVIDER_STATE] = json.dumps(exhausted_state("hfspace@local")).encode()
        api = FakeApi([job(1)])
        with mock.patch.object(providers.HFSpaceFlux, "_generate", return_value=Image.new("RGB", (64, 64))), \
                mock.patch.object(providers.time, "sleep"):
            self.run_worker(st, api, "github")
        self.assertEqual(api.reports[0][1]["estado"], "lista")
        self.assertTrue(any(p.startswith("plates/hero/") for p in st.files))

    def test_cached_plate_serves_while_providers_exhausted(self) -> None:
        st = FakeStorage()
        st.files["plates/hero/p1.jpg"] = jpeg()
        st.files[run.PROVIDER_STATE] = json.dumps(exhausted_state("hfspace@local")).encode()
        api = FakeApi([job(1)])
        self.run_worker(st, api, "local")
        self.assertEqual(api.reports[0][1]["estado"], "lista")

    def test_unservable_variant_reports_quota_wait(self) -> None:
        st = FakeStorage()
        st.files["plates/hero/p1.jpg"] = jpeg()
        st.files[run.PROVIDER_STATE] = json.dumps(exhausted_state("hfspace@local")).encode()
        api = FakeApi([job(1, "flatlay"), job(2, "hero")])
        self.run_worker(st, api, "local")
        by_id = dict(api.reports)
        self.assertEqual(by_id["img1"]["error"], "quota_wait")
        self.assertEqual(by_id["img1"]["estado"], "error")
        self.assertGreaterEqual(by_id["img1"]["retryAfterSeconds"], 60)
        self.assertEqual(by_id["img2"]["estado"], "lista")

    def test_quota_hit_mid_job_reports_quota_wait(self) -> None:
        st = FakeStorage()
        api = FakeApi([job(1)])
        exc = providers.QuotaExhausted(providers.HFSpaceFlux.quota_reset_from_text(ZGPU_MSG), ZGPU_MSG)
        with mock.patch.object(providers.HFSpaceFlux, "_generate", side_effect=exc), \
                mock.patch.object(providers.time, "sleep"):
            self.run_worker(st, api, "local")
        (iid, payload), = api.reports
        self.assertEqual(payload["error"], "quota_wait")
        self.assertGreaterEqual(payload["retryAfterSeconds"], 30 * 60 - 5)
        state = json.loads(st.files[run.PROVIDER_STATE])
        self.assertIn("exhausted_until", state["hfspace@local"])
        self.assertNotIn("exhausted_until", state.get("hfspace", {}))

    def test_other_errors_unchanged(self) -> None:
        st = FakeStorage()
        st.files["plates/hero/p1.jpg"] = jpeg()
        api = FakeApi([job(1)])
        with mock.patch.dict(os.environ, {"HF_SPACE_DISABLED": "1"}), \
                mock.patch.object(run, "process_job", side_effect=ValueError("boom")):
            self.run_worker(st, api, "local")
        self.assertEqual(api.reports[0][1]["error"], "ValueError: boom")


class EditOnlyWorkerTests(Base):
    def test_no_claim_without_edit_provider_even_with_cached_plates(self) -> None:
        st = FakeStorage()
        st.files["plates/hero/p1.jpg"] = jpeg()
        api = FakeApi([job(1)])
        with mock.patch.dict(os.environ, {"IMAGEGEN_ALLOW_COMPOSITE": ""}):
            self.assertEqual(self.run_worker(st, api, "local"), 0)
        self.assertEqual(api.claims, 0)
        self.assertEqual(api.reports, [])


if __name__ == "__main__":
    unittest.main()
