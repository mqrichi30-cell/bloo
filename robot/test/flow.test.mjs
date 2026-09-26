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
const TITLE = "Lentes de sol bloo Marina";

const ITEM = `<!doctype html><html lang="es"><body><h1>${TITLE}</h1>
<button id="m">Marcar como agotado</button>
<div role="dialog" id="d" hidden><p>¿Marcar como agotado?</p><button id="c">Confirmar</button></div>
<script>
m.onclick=()=>{d.hidden=false};
c.onclick=()=>{d.remove(); m.textContent='Marcar como disponible'; fetch('/__sold',{method:'POST'})};
</script></body></html>`;
const SELLING = `<!doctype html><html lang="es"><body><h1>Tus publicaciones</h1>
<a href="/marketplace/item/123456/?ref=selling"><span>${TITLE}</span> ₡15.000</a></body></html>`;
const CHECKPOINT = `<!doctype html><html lang="es"><body><h1>Confirma tu identidad</h1></body></html>`;

let server, base, submits, sold, browser, context, tmp, files;

before(async () => {
  submits = [];
  sold = 0;
  server = http.createServer((req, res) => {
    const send = (html) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    if (req.method === "POST") {
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => {
        if (req.url === "/__submit") submits.push(JSON.parse(b));
        if (req.url === "/__sold") sold++;
        res.end("ok");
      });
      return;
    }
    if (req.url.startsWith("/marketplace/create/item")) return send(CREATE);
    if (req.url.startsWith("/marketplace/item/")) return send(ITEM);
    if (req.url.startsWith("/marketplace/you/selling")) return send(SELLING);
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
  kit: { title: TITLE, description: "Acetato.\nUV400.", priceColones: 15000.4, category: "Accesorios", condition: "Nuevo", location: "San José" },
  images: [],
};

test("publicar --dry-run llena todo y NO publica", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  const r = await publicar(page, task, files, { base, dryRun: true });
  assert.equal(r.submitted, false);
  assert.equal(r.category, "Joyería y accesorios");
  assert.equal(submits.length, 0);
  assert.ok(await page.getByRole("button", { name: "Publicar" }).isVisible());
  await page.close();
});

test("publicar real contra stub: valores correctos y URL", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  const r = await publicar(page, task, files, { base });
  assert.equal(r.submitted, true);
  assert.equal(r.externalUrl, `${base}/marketplace/item/123456/`);
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0], {
    titulo: TITLE,
    precio: "15000",
    descripcion: "Acetato.\nUV400.",
    fotos: 2,
    promo: false,
    categoria: "Joyería y accesorios",
    estado: "Nuevo",
  });
  await page.close();
});

test("quitar sin externalUrl: encuentra por título y marca agotado", { timeout: 120_000 }, async () => {
  const page = await context.newPage();
  const r = await quitar(page, { id: "t2", action: "quitar", kit: { title: TITLE } }, { base });
  assert.equal(r.method, "vendido");
  assert.equal(sold, 1);
  await page.close();
});

test("checkpoint → CheckpointError (necesita_humano)", { timeout: 60_000 }, async () => {
  const page = await context.newPage();
  await assert.rejects(publicar(page, task, files, { base: `${base}/bloqueado` }), CheckpointError);
  await page.close();
});
