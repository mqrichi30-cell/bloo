// Inbox de Marketplace contra un stub local del Messenger acoplado (NO toca Facebook).
process.env.ROBOT_PAUSE_SCALE ??= "0.15";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../src/browser.mjs";
import { CheckpointError } from "../src/checkpoint.mjs";
import { REPLY_TEXT, countReplies, decideThread, maskName, parseMessages, parseRow, runInbox } from "../src/inbox.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCK = readFileSync(path.join(HERE, "fixtures", "messenger-dock.html"), "utf8");
const L = (from, text) => `Presionar Enter, Mensaje enviado miércoles 19:52 por ${from}: ${text}`;

// ---------- funciones puras ----------
test("inbox: parseRow separa nombre/título y detecta vista previa del vendedor", () => {
  const r = parseRow(
    "Chat en grupo: Sharon · Lentes de sol bloo · Corobicí · Leopardo · Seco",
    "Sharon · Lentes de sol bloo · Corobicí · Leopardo · SecoTú: 89433677 · 19 h"
  );
  assert.equal(r.name, "Sharon");
  assert.equal(r.title, "Lentes de sol bloo · Corobicí · Leopardo · Seco");
  assert.ok(r.isBloo && r.sellerLast && !r.unread);
  const manual = parseRow("Chat en grupo: Brenda · Lentes de sol Bloo", "Brenda · Lentes de sol BlooMensaje no leído:Hola · 2 d");
  assert.ok(!manual.isBloo, "los manuales 'Lentes de sol Bloo' no son del robot");
  assert.ok(manual.unread && !manual.sellerLast);
  assert.ok(!parseRow("Chat en grupo: Juan · Disfraz de Hugh Hefner", "…").isBloo);
  assert.equal(maskName("Sharon"), "S***");
});

test("inbox: parseMessages ignora marcador de inicio y filas de estado", () => {
  const m = parseMessages([
    L("Sharon", "Sharon inició este chat."),
    L("Sharon", "Hola. ¿Sigue estando disponible?"),
    "Presionar Enter, Mensaje enviado: miércoles 19:52 por: Sharon",
    L("Tú", "89433677"),
  ]);
  assert.deepEqual(m.map((x) => [x.from, x.seller]), [["Sharon", false], ["Tú", true]]);
});

test("inbox: decideThread (stateless)", () => {
  const buyer = [L("Ana", "Ana inició este chat."), L("Ana", "Hola")];
  assert.equal(decideThread({ labels: buyer, started: true }).action, "responder");
  assert.equal(decideThread({ labels: [...buyer, L("Tú", "sí")], started: true }).action, "saltar");
  assert.equal(decideThread({ labels: [L("Tú", "hola"), L("Ana", "¿y?")], started: false }).action, "saltar", "vendedor gana aunque falte historial");
  assert.match(decideThread({ labels: [L("Ana", "Hola")], started: false }).reason, /incompleto/);
  assert.match(decideThread({ labels: [L("Ana", "Ana inició este chat.")], started: true }).reason, /sin mensajes del comprador/);
  assert.equal(countReplies([L("Tú", REPLY_TEXT.replace("😊", "😊\uFE0F")), L("Tú", "otra cosa")]), 1);
});

// ---------- flujo contra el stub ----------
let server, base, browser, context, state, opened, sends, unreadMarks, checkpoint;
const resetState = () => {
  const t = (id, name, title, msgs, extra = {}) => ({ id, name, title, msgs, started: true, unread: false, ...extra });
  state = {
    doubleSend: false,
    threads: [
      t("1", "Sharon", "Lentes de sol bloo · Corobicí · Leopardo · Seco", [{ from: "Sharon", text: "Hola. ¿Sigue estando disponible?" }, { from: "Tú", text: "89433677" }]),
      t("2", "Brenda", "Lentes de sol Bloo", [{ from: "Brenda", text: "Hola" }], { unread: true }),
      t("3", "Juan", "Disfraz de Hugh Hefner (el dueño de la playboy) Talla S/M", [{ from: "Juan", text: "¿Sigue disponible?" }]),
      t("4", "Ana", "Lentes de sol bloo · Jacó · Gris Transparente", [{ from: "Ana", text: "Hola, ¿precio?" }], { unread: true }),
      t("5", "Luis", "Lentes de sol bloo · Limón · Negro · Gris Gradiente", [{ from: "Luis", text: "Hola" }, { from: "Tú", text: "Sí, disponible" }, { from: "Luis", text: "¿Y el envío?" }], { unread: true }),
      t("6", "Eva", "Lentes de sol bloo · Tamarindo · Carey · Café", [{ from: "Eva", text: "Hola" }], { started: false }),
      t("7", "Ivan", "Lentes de sol bloo · Corobicí · Leopardo · Seco", [{ from: "Ivan", text: "Me interesa" }]),
    ],
  };
  opened = [];
  sends = [];
  unreadMarks = [];
  checkpoint = false;
};
const th = (id) => state.threads.find((t) => t.id === id);

before(async () => {
  resetState();
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const m = req.url.match(/^\/__(open|send|unread)\/(\d+)/);
      if (req.method === "POST" && m) {
        const t = th(m[2]);
        if (m[1] === "open") (opened.push(m[2]), (t.unread = false));
        if (m[1] === "send") (sends.push({ id: m[2], text: body }), t.msgs.push({ from: "Tú", text: body }));
        if (m[1] === "unread") (unreadMarks.push(m[2]), (t.unread = true));
        return res.writeHead(204).end();
      }
      if (req.url.startsWith("/marketplace/you/selling")) {
        const html = checkpoint
          ? `<!doctype html><html lang="es"><body><h1>Confirma tu identidad</h1></body></html>`
          : DOCK.replace("<body>", `<body><script>window.STATE=${JSON.stringify(state).replace(/</g, "\\u003c")}</script>`);
        return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  ({ browser, context } = await launch({ headless: true }));
});
after(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(() => resetState());

const run = async (opts) => {
  const page = await context.newPage();
  try {
    return await runInbox(page, { base, ...opts });
  } finally {
    await page.close();
  }
};
const byTitle = (r, who) => r.outcomes.find((o) => o.who === maskName(who));

test("inbox dry: lista solo hilos bloo sin respuesta del vendedor y no envía nada", async () => {
  const r = await run({ dryRun: true });
  assert.equal(sends.length, 0);
  assert.equal(r.rows, 7);
  assert.equal(r.bloo, 5, "Brenda (Bloo manual) y Juan (disfraz) quedan fuera");
  assert.equal(r.planned, 2);
  assert.equal(byTitle(r, "Ana").result, "RESPONDERÍA");
  assert.equal(byTitle(r, "Ivan").result, "RESPONDERÍA");
  assert.match(byTitle(r, "Sharon").reason, /vista previa/);
  assert.match(byTitle(r, "Luis").reason, /ya respondido/);
  assert.match(byTitle(r, "Eva").reason, /incompleto/);
  assert.ok(!opened.includes("1") && !opened.includes("2") && !opened.includes("3"), `abrió ${opened}`);
  assert.deepEqual(unreadMarks.sort(), ["4", "5"], "los no leídos que abrió vuelven a no leído");
});

test("inbox real: responde UNA vez, respeta el tope y es idempotente", async () => {
  const r1 = await run({ maxReplies: 1 });
  assert.equal(r1.sent, 1);
  assert.deepEqual(sends.map((s) => s.id), ["4"]);
  assert.equal(sends[0].text.trim(), REPLY_TEXT);
  assert.equal(byTitle(r1, "Ivan").result, "pendiente");

  const r2 = await run({});
  assert.deepEqual(sends.map((s) => s.id), ["4", "7"]);
  assert.match(byTitle(r2, "Ana").reason, /vista previa/, "Ana ya tiene respuesta: ni se abre");

  const r3 = await run({});
  assert.equal(r3.sent, 0);
  assert.equal(sends.length, 2, "tercera corrida no envía nada");
  assert.ok(sends.every((s) => !th("5").msgs.some((m) => m.text === s.text)), "Luis nunca recibe la respuesta");
});

test("inbox real: si el mensaje aparece duplicado se detiene sin seguir enviando", async () => {
  state.doubleSend = true;
  await assert.rejects(run({}), /verificación de envío falló/);
  assert.deepEqual([...new Set(sends.map((s) => s.id))], ["4"], "no pasa al siguiente hilo");
});

test("inbox: checkpoint → CheckpointError sin enviar", async () => {
  checkpoint = true;
  await assert.rejects(run({}), (e) => e instanceof CheckpointError);
  assert.equal(sends.length, 0);
});
