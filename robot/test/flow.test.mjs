// Prueba los flujos contra un stub local (NO toca Facebook).
process.env.ROBOT_PAUSE_SCALE ??= "0.15"; // pausas humanas más cortas solo en tests
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../src/browser.mjs";
import { publicar, quitar, reemplazar } from "../src/facebook.mjs";
import { promocionar } from "../src/boost.mjs";
import { runTask } from "../src/runner.mjs";
import { CheckpointError, NeedsHumanError } from "../src/checkpoint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CREATE = readFileSync(path.join(HERE, "fixtures", "create-item.html"), "utf8");
const BOOST = readFileSync(path.join(HERE, "fixtures", "boost-dialog.html"), "utf8");
// Título publicado, recortado al tope de 60 caracteres (como en producción).
const TITLE = "Lentes de sol bloo · Coro… · Verde Transparente · Gris Claro";
const TITLE_Q = "Lentes de sol bloo · Corobicí · Leopardo · Seco";
const MANUAL = "Lentes de sol Bloo"; // listados manuales del dueño: el robot NUNCA los toca
const OLD_R = "Lentes de sol bloo · Tamarindo · Carey · Café"; // versión vieja a reemplazar
const NEW_R = "Lentes de sol bloo · Tamarindo · Carey · Café Degradado";
const DESC =
  Array.from({ length: 12 }, (_, i) => `Línea ${i + 1}: acetato pulido, protección UV400, estuche incluido. ₡`).join("\n") +
  "\n\nEnvíos a todo CR.";

// Publicaciones del stub: id → título. 555 = versión vieja (vendida) con el mismo título que TITLE.
let listings;
const resetListings = () => {
  listings = new Map([
    ["111", MANUAL],
    ["112", MANUAL],
    ["113", MANUAL + " Marina"], // parecido pero no igual
    ["555", TITLE],
    ["700", TITLE_Q],
    ["701", TITLE_Q + " XL"], // contiene TITLE_Q como subcadena
    ["800", OLD_R],
  ]);
};

// Dos formatos de tarjeta: título dentro del <a>, o al lado (imagen enlazada + <span> hermano).
const card = (id, title, i) =>
  i % 2
    ? `<div class="card"><a href="/marketplace/item/${id}/?ref=selling"><span>${title}</span><span>₡15.000</span></a></div>`
    : `<div class="card"><a href="/marketplace/item/${id}/?ref=selling" aria-label="foto"><img alt=""></a><div><span>${title}</span></div><span>₡15.000</span></div>`;
const sellingHtml = () =>
  `<!doctype html><html lang="es"><body><h1>Tus publicaciones</h1><div class="grid">${[...listings]
    .map(([id, t], i) => card(id, t, i))
    .join("")}</div></body></html>`;
const itemHtml = (id) => `<!doctype html><html lang="es"><body><h1><span>${listings.get(id) || "?"}</span></h1>
<button id="m">${sold.includes(id) ? "Marcar como disponible" : "Marcar como agotado"}</button>
<div role="dialog" id="d" hidden><p>¿Marcar como agotado?</p><button id="c">Confirmar</button></div>
<script>
m.onclick=()=>{d.hidden=false};
c.onclick=()=>{d.remove(); m.textContent='Marcar como disponible'; fetch('/__sold/${id}',{method:'POST'})};
window.ITEM_ID=${JSON.stringify(id)}; window.BOOST_SCENARIO=${JSON.stringify(boostScenario)};
</script>
${promoted.has(id) ? "<p>Promoción en revisión</p>" : ""}
${BOOST}
</body></html>`;
const CHECKPOINT = `<!doctype html><html lang="es"><body><h1>Confirma tu identidad</h1></body></html>`;

let server, base, submits, sold, browser, context, tmp, files;
let boostScenario = "ok";
let singleInput = false; // input de fotos SIN "multiple" (sube de a una)
const boosts = []; // POST /__boost: cada uno sería un cobro real
const promoted = new Set();

before(async () => {
  submits = [];
  sold = [];
  resetListings();
  server = http.createServer((req, res) => {
    const send = (html) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    if (req.method === "POST") {
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => {
        if (req.url === "/__submit") {
          const s = JSON.parse(b);
          submits.push(s);
          listings.set("999", s.titulo); // la nueva publicación aparece en Tus publicaciones
        }
        if (req.url.startsWith("/__sold/")) sold.push(req.url.split("/").pop());
        if (req.url.startsWith("/__boost/")) {
          const u = new URL(req.url, "http://x");
          const id = u.pathname.split("/").pop();
          boosts.push({ id, total: Number(u.searchParams.get("total")) });
          promoted.add(id);
        }
        res.end("ok");
      });
      return;
    }
    if (req.url.startsWith("/marketplace/create/item")) return send(singleInput ? CREATE.replace(' multiple accept=', " accept=") : CREATE);
    const m = req.url.match(/^\/marketplace\/item\/(\d+)/);
    if (m) return send(itemHtml(m[1]));
    if (req.url.startsWith("/marketplace/you/selling")) return send(sellingHtml());
    if (req.url.startsWith("/bloqueado/")) return res.writeHead(302, { location: "/checkpoint/abc/" }).end();
    if (req.url.startsWith("/checkpoint/")) return send(CHECKPOINT);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  ({ browser, context } = await launch({ headless: true }));
  tmp = mkdtempSync(path.join(tmpdir(), "robot-test-"));
  // Orden del contrato: [foto IA del lente, foto fija del estuche].
  files = ["foto-01-lente", "foto-02-estuche"].map((n) => {
    const f = path.join(tmp, `${n}.png`);
    writeFileSync(f, Buffer.from("89504e470d0a1a0a", "hex"));
    return f;
  });
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const task = {
  id: "t1",
  action: "publicar",
  kit: { title: TITLE, description: DESC, priceColones: 15000.4, category: "Accesorios", condition: "Nuevo", location: "San José" },
  images: [],
};
const quitarTask = (kit, externalUrl) => ({ id: "tq", action: "quitar", kit, externalUrl, images: [] });

test("publicar --dry-run llena todo y NO publica", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  const r = await publicar(page, task, files, { base, dryRun: true });
  assert.equal(r.submitted, false);
  assert.equal(r.category, "Joyería y accesorios");
  assert.equal(submits.length, 0);
  assert.ok(await page.getByRole("button", { name: "Publicar" }).isVisible());
  await page.close();
});

test("publicar: valores correctos y URL NUEVA aunque exista una vieja con el mismo título", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  const r = await publicar(page, task, files, { base });
  assert.equal(r.submitted, true);
  assert.equal(r.externalUrl, `${base}/marketplace/item/999/`); // no la 555 (vieja)
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0], {
    titulo: TITLE,
    precio: "15000",
    descripcion: DESC,
    marca: "bloo",
    fotos: ["foto-01-lente.png", "foto-02-estuche.png"], // las 2, en orden
    promo: false,
    categoria: "Joyería y accesorios",
    estado: "Nuevo",
  });
  await page.close();
});

test("quitar sin URL: título EXACTO, ignora el que lo contiene como subcadena", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  const r = await quitar(page, quitarTask({ title: TITLE_Q }), { base });
  assert.equal(r.method, "vendido");
  assert.deepEqual(sold, ["700"]);
  await page.close();
});

test("quitar NUNCA toca los listados manuales: 2 coincidencias exactas → error", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  await assert.rejects(quitar(page, quitarTask({ title: MANUAL }), { base }), /2 publicaciones con el título exacto/);
  assert.deepEqual(sold, []);
  await page.close();
});

test("quitar: mayúsculas distintas no coinciden (bloo ≠ Bloo) → no encontrada", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  await assert.rejects(quitar(page, quitarTask({ title: "Lentes de sol bloo" }), { base }), /No encontré ninguna publicación/);
  assert.deepEqual(sold, []);
  await page.close();
});

test("quitar con URL cuyo título no coincide → error, no toca", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  await assert.rejects(
    quitar(page, quitarTask({ title: TITLE_Q }, `${base}/marketplace/item/111/`), { base }),
    /no muestra el título exacto/
  );
  assert.deepEqual(sold, []);
  await page.close();
});

test("checkpoint → CheckpointError (necesita_humano)", { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await assert.rejects(publicar(page, task, files, { base: `${base}/bloqueado` }), CheckpointError);
  await page.close();
});

test("publicar: input de fotos sin 'multiple' → sube las 2 de a una, en orden", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  singleInput = true;
  try {
    const r = await publicar(page, { ...task, kit: { ...task.kit, title: TITLE_Q + " Single" } }, files, { base });
    assert.equal(r.submitted, true);
    assert.deepEqual(submits.at(-1).fotos, ["foto-01-lente.png", "foto-02-estuche.png"]);
  } finally {
    singleInput = false;
    await page.close();
  }
});

const reemplazarTask = (boost = null) => ({
  id: "tr",
  action: "reemplazar",
  oldTitle: OLD_R,
  externalUrl: null,
  kit: { ...task.kit, title: NEW_R },
  images: ["https://x/1.jpg", "https://x/2.jpg"],
  boost,
});

test("reemplazar: quita la vieja (título exacto), publica la nueva con 2 fotos y pauta dry → simulado", { timeout: 240_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  boostScenario = "ok";
  const nSubmits = submits.length;
  const nBoosts = boosts.length;
  const ev = [];
  const r = await runTask(page, reemplazarTask({ mode: "dry", amountCrc: 500 }), {
    base,
    files,
    deadline: Date.now() + 600_000,
    onEvidence: async (p, note) => ev.push(note),
  });
  assert.deepEqual(sold, ["800"]); // solo la vieja
  assert.equal(submits.length, nSubmits + 1);
  assert.equal(submits.at(-1).titulo, NEW_R);
  assert.deepEqual(submits.at(-1).fotos, ["foto-01-lente.png", "foto-02-estuche.png"]);
  assert.equal(submits.at(-1).promo, false); // ensureNoPromote sigue en el formulario
  assert.equal(r.status, "hecha");
  assert.equal(r.externalUrl, `${base}/marketplace/item/999/`);
  assert.equal(r.boost.status, "simulado", JSON.stringify(r.boost));
  assert.equal(r.boost.amountCrc, 500);
  assert.match(r.boost.detail, /₡500 CRC/);
  assert.equal(boosts.length, nBoosts); // dry: NO se pulsó pagar
  assert.ok(ev.some((n) => /pauta dry-run: total verificado ₡500 CRC/.test(n)), "captura del dry");
  await page.close();
});

test("reemplazar: vieja NO encontrada → NeedsHumanError y NO publica", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  const nSubmits = submits.length;
  await assert.rejects(
    reemplazar(page, { ...reemplazarTask(), oldTitle: "Lentes de sol bloo · No existe" }, files, { base }),
    (e) => e instanceof NeedsHumanError && /no publico la nueva/.test(e.message)
  );
  assert.equal(submits.length, nSubmits);
  assert.deepEqual(sold, []);
  await page.close();
});

test("reemplazar: vieja ambigua (2 exactas) → NeedsHumanError y NO publica", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  sold.length = 0;
  const nSubmits = submits.length;
  await assert.rejects(reemplazar(page, { ...reemplazarTask(), oldTitle: MANUAL }, files, { base }), NeedsHumanError);
  assert.equal(submits.length, nSubmits);
  assert.deepEqual(sold, []);
  await page.close();
});

const ITEM = () => `${base}/marketplace/item/555/`;

test("pauta: Meta exige mínimo ₡1.000 → fallido con el mínimo visto, sin pagar", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  boostScenario = "min";
  const n = boosts.length;
  const ev = [];
  const r = await promocionar(page, ITEM(), { mode: "on", amountCrc: 500 }, { onEvidence: async (p, note) => ev.push(note) });
  assert.equal(r.status, "fallido");
  assert.match(r.detail, /mínimo de ₡1000 CRC/);
  assert.equal(boosts.length, n);
  assert.equal(ev.length, 1); // captura del fallo
  await page.close();
});

test("pauta: cuenta en dólares → fallido, sin pagar", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  boostScenario = "usd";
  const n = boosts.length;
  const r = await promocionar(page, ITEM(), { mode: "on", amountCrc: 500 });
  assert.equal(r.status, "fallido");
  assert.match(r.detail, /USD/);
  assert.equal(boosts.length, n);
  await page.close();
});

test("pauta: pantalla de agregar tarjeta → fallido, no se ingresa nada", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  boostScenario = "card";
  const n = boosts.length;
  const r = await promocionar(page, ITEM(), { mode: "on", amountCrc: 500 });
  assert.equal(r.status, "fallido");
  assert.match(r.detail, /tarjeta|método de pago/);
  assert.equal(await page.locator("#cc").inputValue(), "");
  assert.equal(boosts.length, n);
  await page.close();
});

test("pauta on: paga UNA vez ₡500 y verifica; repetir no vuelve a pagar (idempotente)", { timeout: 180_000 }, async () => {
  const page = await context.newPage();
  boostScenario = "ok";
  const n = boosts.length;
  const r = await promocionar(page, ITEM(), { mode: "on", amountCrc: 500 });
  assert.equal(r.status, "pagado", JSON.stringify(r));
  assert.match(r.detail, /en revisión/);
  assert.equal(boosts.length, n + 1);
  assert.deepEqual(boosts.at(-1), { id: "555", total: 500 }); // presupuesto TOTAL = 500 (no diario × días)
  const again = await promocionar(page, ITEM(), { mode: "on", amountCrc: 500 });
  assert.equal(again.status, "pagado");
  assert.match(again.detail, /ya estaba promocionada/);
  assert.equal(boosts.length, n + 1);
  await page.close();
});

test("pauta: monto del payload por encima del tope (₡5.000) → fallido sin abrir nada", async () => {
  const r = await runTask(/** @type {any} */ (null), { id: "x", action: "noexiste" });
  assert.equal(r.status, "fallida");
  const page = await context.newPage();
  const n = boosts.length;
  const res = await promocionar(page, ITEM(), { mode: "on", amountCrc: 5000 });
  assert.equal(res.status, "fallido");
  assert.equal(boosts.length, n);
  await page.close();
});
