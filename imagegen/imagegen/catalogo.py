"""Catalog of the GPT batch (owner request 2026-10-14): publication schedule, one folder per color in
Storage `catalogo/<folder>/` (hero.jpg, hero-4x5.jpg, manifest.json; Marketplace photo only,
stories are generated on demand by story-ads) mirrored to
C:\\bloo\\catalogo\\<folder>\\ (gitignored) and ONE PDF C:\\bloo\\catalogo\\catalogo-bloo-2026-10.pdf.

    python -m imagegen.catalogo                 read DB + Storage, write folders + PDF
    python -m imagegen.catalogo --dry-run       OFFLINE: 3 mock colors -> imagegen/out/catalogo-dry.pdf
    python -m imagegen.catalogo --estilo completo --nombre catalogo-bloo-parte-2.pdf --solo-models <id> <id>
                                                only those colors in the PDF (e.g. the redone ones)

Schedule (the robot's queue order): colors NOT yet published get one dated slot per day (CR time)
starting --start (default 2026-10-15), in the order of their pending 'publicar' tasks, then the
ones with stock still without a task; no stock = no date. Already-published colors are replaced as
soon as their new photos are 'lista' (fast lane): they say "reemplazo inmediato", not a date.
Price = Marketplace price (MARKETPLACE_PRICE_CRC, default 17500; NOT Model.precioVentaCent = POS).
Only Pillow (already a worker dependency) is used for the PDF. Re-runnable: everything is overwritten.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageDraw, ImageFont

from .util import env, log, setup_logging

ROOT = Path(__file__).resolve().parents[2]          # C:\bloo
LOCAL = ROOT / "catalogo"
PDF_NAME = "catalogo-bloo-2026-10.pdf"  # override con --nombre
OUT_DRY = Path(__file__).resolve().parents[1] / "out"
BUCKET = "bloo-marketing"
NAVY, CREAM, DUSTY = (11, 14, 48), (229, 225, 208), (128, 167, 182)
PAGE = (1240, 1754)  # A4 at 150 dpi
DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
FONT_DIR = Path("C:/Windows/Fonts")
LOGO = Path(__file__).with_name("assets") / "bloo-logo-mask.png"
SOLO: set[str] = set()  # --solo-models

SQL = """
SELECT l."id", m."id", m."nombre", COALESCE(m."color", ''), l."status", m."stockQty" - m."stockReservado",
       l."createdAt",
       (SELECT json_build_object('id', g."id", 'url', g."publicUrl", 'url45', g."portraitUrl", 'provider', g."provider",
                                 'batch', g."qa"->>'batch')
          FROM "bloo"."GeneratedImage" g WHERE g."modelId" = m."id" AND g."variant" = 'hero' AND g."estado" = 'lista'
         ORDER BY g."createdAt" DESC LIMIT 1),
       (SELECT json_build_object('id', g."id", 'url', g."publicUrl", 'provider', g."provider", 'batch', g."qa"->>'batch')
          FROM "bloo"."GeneratedImage" g WHERE g."modelId" = m."id" AND g."variant" = 'story' AND g."estado" = 'lista'
         ORDER BY g."createdAt" DESC LIMIT 1),
       (SELECT json_build_object('action', q."action", 'createdAt', q."createdAt")
          FROM "bloo"."MarketplaceTask" q WHERE q."listingId" = l."id" AND q."status" IN ('pendiente', 'en_proceso')
         LIMIT 1)
  FROM "bloo"."ChannelListing" l JOIN "bloo"."Model" m ON m."id" = l."modelId"
 WHERE l."canal" = 'marketplace' AND m."tipo" = 'lente' AND m."activo"
   AND l."status" IN ('publicado', 'listo_para_publicar', 'esperando_imagenes')
"""


@dataclass
class Item:
    listing_id: str
    model_id: str
    nombre: str
    color: str
    status: str
    available: int
    created: str
    hero: dict[str, Any] | None
    story: dict[str, Any] | None
    task: dict[str, Any] | None
    plan: str = ""             # 'YYYY-MM-DD' | 'reemplazo inmediato' | 'sin stock'
    folder: str = ""
    files: dict[str, bytes] = field(default_factory=dict, repr=False)

    @property
    def title(self) -> str:
        return f"Lentes de sol bloo · {self.nombre}" + (f" · {self.color}" if self.color else "")

    @property
    def publicado(self) -> bool:
        return self.status == "publicado"


def price_crc() -> int:
    raw = env("MARKETPLACE_PRICE_CRC", "17500") or "17500"
    return int(raw) if raw.isdigit() and 1000 <= int(raw) <= 1_000_000 else 17500


def fmt_crc(n: int) -> str:
    return "₡" + f"{n:,}".replace(",", ".")


def fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{DIAS[d.weekday()]} {d.day} {MESES[d.month - 1]} {d.year}"


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def schedule(items: list[Item], start: date) -> list[Item]:
    """Robot queue order: unpublished first (pending 'publicar' by task date, then the rest with
    stock), one per day; published = immediate replacement; no stock = no date."""
    unpub = [i for i in items if not i.publicado]
    queued = sorted([i for i in unpub if i.task and i.task.get("action") == "publicar"],
                    key=lambda i: (str(i.task["createdAt"]), i.nombre, i.color))
    rest = sorted([i for i in unpub if i not in queued and i.available > 0], key=lambda i: (i.created, i.nombre, i.color))
    nostock = sorted([i for i in unpub if i not in queued and i.available <= 0], key=lambda i: (i.nombre, i.color))
    pub = sorted([i for i in items if i.publicado],
                 key=lambda i: (str((i.task or {}).get("createdAt") or "9999"), i.nombre, i.color))
    for k, i in enumerate(queued + rest):
        i.plan = (start + timedelta(days=k)).isoformat()
        i.folder = f"{i.plan}-{slug(i.nombre)}-{slug(i.color)}"
    for k, i in enumerate(pub, 1):
        i.plan = "reemplazo inmediato"
        i.folder = f"reemplazo-{k:02d}-{slug(i.nombre)}-{slug(i.color)}"
    for i in nostock:
        i.plan = "sin stock"
        i.folder = f"sin-stock-{slug(i.nombre)}-{slug(i.color)}"
    return queued + rest + pub + nostock


def manifest(i: Item, price: int) -> dict[str, Any]:
    return {"listingId": i.listing_id, "modelId": i.model_id, "title": i.title, "nombre": i.nombre,
            "color": i.color, "priceCrc": price, "plannedDate": i.plan if i.plan[:2] == "20" else None,
            "plan": i.plan, "estado": "publicado" if i.publicado else "por publicar",
            "images": {"hero": (i.hero or {}).get("id")},
            "provider": (i.hero or {}).get("provider"),
            "newPhoto": (i.hero or {}).get("batch") is not None}


# ------------------------------------------------------------------ PDF (Pillow only)
def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in (("arialbd.ttf",) if bold else ("arial.ttf",)) + ("DejaVuSans.ttf",):
        p = FONT_DIR / name
        try:
            return ImageFont.truetype(str(p) if p.is_file() else name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def fit(img: Image.Image, box: tuple[int, int]) -> Image.Image:
    im = img.convert("RGB")
    k = min(box[0] / im.width, box[1] / im.height)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def logo(width: int, rgb: tuple[int, int, int]) -> Image.Image | None:
    if not LOGO.is_file():
        return None
    m = Image.open(LOGO).convert("L")
    m = m.resize((width, round(m.height * width / m.width)), Image.LANCZOS)
    out = Image.new("RGBA", m.size, rgb + (0,))
    out.putalpha(m)
    return out


def centered(d: ImageDraw.ImageDraw, y: int, text: str, f: Any, fill: tuple[int, int, int]) -> None:
    w = d.textlength(text, font=f)
    d.text(((PAGE[0] - w) / 2, y), text, font=f, fill=fill)


def cover(items: list[Item], price: int) -> Image.Image:
    """Portada: mar azul navy HD (catalogo/assets/portada-mar.png) con el logo pequeño al centro."""
    sea = LOCAL / "assets" / "portada-mar.png"
    if sea.exists():
        bg = Image.open(sea).convert("RGB")
        r = max(PAGE[0] / bg.width, PAGE[1] / bg.height)
        bg = bg.resize((round(bg.width * r), round(bg.height * r)), Image.LANCZOS)
        x, y = (bg.width - PAGE[0]) // 2, (bg.height - PAGE[1]) // 2
        pg = bg.crop((x, y, x + PAGE[0], y + PAGE[1]))
    else:
        pg = Image.new("RGB", PAGE, NAVY)
    lg = logo(420, CREAM)
    if lg is not None:
        pg.paste(lg, ((PAGE[0] - lg.width) // 2, (PAGE[1] - lg.height) // 2), lg)
    else:
        d = ImageDraw.Draw(pg)
        f = font(150, True)
        w = d.textlength("bloo", font=f)
        d.text(((PAGE[0] - w) / 2, PAGE[1] / 2 - 90), "bloo", font=f, fill=CREAM)
    return pg


def color_page(i: Item, price: int, n: int, total: int) -> Image.Image:
    pg = Image.new("RGB", PAGE, CREAM)
    d = ImageDraw.Draw(pg)
    d.rectangle((0, 0, PAGE[0], 110), fill=NAVY)
    lg = logo(150, CREAM)
    if lg is not None:
        pg.paste(lg, (70, (110 - lg.height) // 2), lg)
    f_small = font(28)
    t = f"{n} / {total}"
    d.text((PAGE[0] - 70 - d.textlength(t, font=f_small), 40), t, font=f_small, fill=CREAM)
    hero_box = (900, 1125)
    y0 = 170
    if "hero-4x5.jpg" in i.files or "hero.jpg" in i.files:
        h = fit(Image.open(io.BytesIO(i.files.get("hero-4x5.jpg") or i.files["hero.jpg"])), hero_box)
        pg.paste(h, ((PAGE[0] - h.width) // 2, y0))
    else:
        x0 = (PAGE[0] - hero_box[0]) // 2
        d.rectangle((x0, y0, x0 + hero_box[0], y0 + hero_box[1]), outline=NAVY, width=3)
        centered(d, y0 + 540, "sin foto nueva", font(40), NAVY)
    y = y0 + hero_box[1] + 30
    f_title = font(46, True)
    words, line, lines = i.title.split(" "), "", []
    for w in words:  # wrap the title to the page width
        cand = (line + " " + w).strip()
        if d.textlength(cand, font=f_title) > PAGE[0] - 140 and line:
            lines.append(line)
            line = w
        else:
            line = cand
    lines.append(line)
    for ln in lines:
        d.text((70, y), ln, font=f_title, fill=NAVY)
        y += 62
    d.text((70, y + 4), fmt_crc(price), font=font(52, True), fill=NAVY)
    y += 80
    return pg


FULL = False  # --estilo completo: una foto por hoja, sin marco, precio mínimo en una esquina


def full_page(i: Item, price: int) -> Image.Image:
    """Hoja = la foto completa (4:5) a sangre, precio pequeño y discreto abajo a la derecha."""
    raw = i.files.get("hero-4x5.jpg") or i.files.get("hero.jpg")
    pg = Image.open(io.BytesIO(raw)).convert("RGB")
    W = 1600
    pg = pg.resize((W, round(pg.height * W / pg.width)), Image.LANCZOS)
    d = ImageDraw.Draw(pg, "RGBA")
    f = font(30)
    t = fmt_crc(price)
    w = d.textlength(t, font=f)
    d.text((pg.width - w - 44, pg.height - 70), t, font=f, fill=(245, 242, 232, 150))
    return pg


def full_cover(size: tuple[int, int]) -> Image.Image:
    global PAGE
    old, PAGE = PAGE, size
    try:
        return cover([], 0)
    finally:
        PAGE = old


def has_photo(i: Item) -> bool:
    return bool(i.files.get("hero-4x5.jpg") or i.files.get("hero.jpg"))


def write_pdf(items: list[Item], price: int, path: Path) -> Path:
    # Solo colores con la foto realmente descargada: nunca una página vacía ("sin foto nueva"),
    # ni mientras se rehace una foto ni si la descarga de Storage falló.
    items = [i for i in items if has_photo(i)]
    if FULL:
        body = [full_page(i, price) for i in items]
        pages = [full_cover(body[0].size if body else PAGE)] + body
    else:
        pages = [cover(items, price)] + [color_page(i, price, k, len(items)) for k, i in enumerate(items, 1)]
    path.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(path, "PDF", save_all=True, append_images=pages[1:], resolution=150.0, quality=88)
    return path


# ------------------------------------------------------------------ run
def fetch(url: str | None) -> bytes | None:
    if not url:
        return None
    r = requests.get(url, timeout=60)
    return r.content if r.ok else None


def run_live(start: date) -> int:
    from .batch_gpt import connect, load_env_local
    from .storage import Storage
    load_env_local()
    price = price_crc()
    with connect() as c:
        cur = c.cursor()
        cur.execute(SQL)
        items = [Item(lid, mid, nom, col, st, int(av), cr.isoformat(), h, s, tk)
                 for lid, mid, nom, col, st, av, cr, h, s, tk in cur.fetchall()]
    items = schedule(items, start)
    storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
    for i in items:
        for name, url in (("hero.jpg", (i.hero or {}).get("url")), ("hero-4x5.jpg", (i.hero or {}).get("url45"))):
            data = fetch(url)
            if data:
                i.files[name] = data
        man = json.dumps(manifest(i, price), indent=1, ensure_ascii=False).encode()
        d = LOCAL / i.folder
        d.mkdir(parents=True, exist_ok=True)
        for name, data in [*i.files.items(), ("manifest.json", man)]:
            (d / name).write_bytes(data)
            storage.upload(f"catalogo/{i.folder}/{name}", data,
                           "application/json" if name.endswith(".json") else "image/jpeg")
        log.info("%-14s %s", i.plan, i.folder)
    index = [{"folder": i.folder, **manifest(i, price)} for i in items]
    (LOCAL / "schedule.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    storage.upload("catalogo/schedule.json", json.dumps(index, indent=1, ensure_ascii=False).encode(), "application/json")
    # --solo-models: the PDF only (folders and schedule.json always cover every color)
    pdf_items = [i for i in items if not SOLO or i.model_id in SOLO]
    pdf = write_pdf(pdf_items, price, LOCAL / PDF_NAME)
    missing = [f"{i.nombre} · {i.color}" for i in pdf_items if not has_photo(i)]
    if missing:
        log.warning("left out of the PDF (no photo downloaded): %s", "; ".join(missing))
    log.info("PDF: %s (%d colors)", pdf, sum(has_photo(i) for i in pdf_items))
    print(pdf)
    return 0


def run_dry() -> int:
    """No network: 3 mock colors with procedural images -> out/catalogo-dry.pdf."""
    def mock(size: tuple[int, int], tone: tuple[int, int, int]) -> bytes:
        im = Image.new("RGB", size, tone)
        ImageDraw.Draw(im).ellipse((size[0] * .2, size[1] * .4, size[0] * .8, size[1] * .6), fill=NAVY)
        b = io.BytesIO()
        im.save(b, "JPEG")
        return b.getvalue()
    items = [Item("l1", "m1", "Celaje", "Verde · Verde", "listo_para_publicar", 1, "2026-09-01", None, None,
                  {"action": "publicar", "createdAt": "2026-10-01"}),
             Item("l2", "m2", "Osa", "Leopardo · Azul", "publicado", 1, "2026-09-01", None, None,
                  {"action": "reemplazar", "createdAt": "2026-10-10"}),
             Item("l3", "m3", "Ballena", "Carey · Azul", "listo_para_publicar", 0, "2026-09-01", None, None, None)]
    items = schedule(items, date(2026, 10, 15))
    for i in items[:2]:
        i.files = {"hero-4x5.jpg": mock((1080, 1350), (220, 210, 190))}
    for i in items:
        log.info("%-20s %s %s", i.plan, i.folder, json.dumps(manifest(i, price_crc()), ensure_ascii=False)[:120])
    pdf = write_pdf(items, price_crc(), OUT_DRY / "catalogo-dry.pdf")
    print(pdf)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.catalogo", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="offline mock PDF into imagegen/out/")
    ap.add_argument("--start", default="2026-10-15", help="first daily slot (CR date)")
    ap.add_argument("--nombre", default=None, help="nombre del PDF (ej. catalogo-bloo-parte-1.pdf)")
    ap.add_argument("--estilo", choices=["fichas", "completo"], default="fichas",
                    help="completo = una foto por hoja sin marco, precio mínimo en una esquina")
    ap.add_argument("--solo-models", nargs="+", default=[], metavar="MODEL_ID",
                    help="el PDF solo con estos colores (Model.id, separados por espacio o coma), ej. una parte 2")
    a = ap.parse_args(argv)
    setup_logging()
    global PDF_NAME, FULL, SOLO
    SOLO = {x.strip() for v in a.solo_models for x in v.split(",") if x.strip()}
    FULL = a.estilo == "completo"
    if a.nombre:
        PDF_NAME = a.nombre
    return run_dry() if a.dry_run else run_live(date.fromisoformat(a.start))


if __name__ == "__main__":
    sys.exit(main())
