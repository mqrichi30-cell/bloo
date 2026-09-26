// Prueba los flujos contra un stub local (NO toca Facebook).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../src/browser.mjs";
import { publicar, quitar } from "../src/facebook.mjs";
import { CheckpointError } from "../src/checkpoint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CREATE = readFileSync(path.join(HERE, "fixtures", "create-item.html"), "utf8");
// Título publicado, recortado al tope de 60 caracteres (como en producción).
const TITLE = "Lentes de sol bloo · Coro… · Verde Transparente · Gris Claro";
const TITLE_Q = "Lentes de sol bloo · Corobicí · Leopardo · Seco";
const MANUAL = "Lentes de sol Bloo"; // listados manuales del dueño: el robot NUNCA los toca
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
<button id="m">Marcar como agotado</button>
<div role="dialog" id="d" hidden><p>¿Marcar como agotado?</p><button id="c">Confirmar</button></div>
<script>
m.onclick=()=>{d.hidden=false};
c.onclick=()=>{d.remove(); m.textContent='Marcar como disponible'; fetch('/__sold/${id}',{method:'POST'})};
</script></body></html>`;
const CHECKPOINT = `<!doctype html><html lang="es"><body><h1>Confirma tu identidad</h1></body></html>`;

let server, base, submits, sold, browser, context, tmp, files;

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
        res.end("ok");
      });
      return;
    }
    if (req.url.startsWith("/marketplace/create/item")) return send(CREATE);
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
  files = [1, 2].map((i) => {
    const f = path.join(tmp, `f${i}.png`);
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
    fotos: 2,
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
