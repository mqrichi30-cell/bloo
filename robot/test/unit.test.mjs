import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { detectCheckpoint } from "../src/checkpoint.mjs";
import { assertAllowedImageUrl, downloadImages } from "../src/images.mjs";
import { createApi, ApiNotDeployedError } from "../src/api.mjs";
import { normalizeItemUrl } from "../src/facebook.mjs";

const ok = "https://www.facebook.com/marketplace/create/item";

test("checkpoint: páginas normales pasan", () => {
  assert.equal(detectCheckpoint({ url: ok, text: "Crear publicación Título Precio Categoría Estado" }), null);
  assert.equal(detectCheckpoint({ url: "https://www.facebook.com/marketplace/you/selling", text: "Tus publicaciones" }), null);
});

test("checkpoint: detecta cada caso", () => {
  const cases = [
    [{ url: "https://www.facebook.com/checkpoint/1501092823525282/" }, /checkpoint/],
    [{ url: "https://www.facebook.com/login/?next=x" }, /login/],
    [{ url: "https://www.facebook.com/login.php" }, /login/],
    [{ url: ok, hasPasswordField: true }, /login/],
    [{ url: ok, hasCaptchaFrame: true }, /captcha/i],
    [{ url: ok, text: "Confirma tu identidad para continuar" }, /identidad/],
    [{ url: ok, text: "Tu cuenta está restringida en este momento" }, /restringida/],
    [{ url: ok, text: "Ingresa el código de inicio de sesión" }, /2FA/],
    [{ url: ok, text: "Autenticación en dos pasos" }, /2FA/],
    [{ url: ok, text: "Resuelve este captcha" }, /captcha/i],
    [{ url: ok, text: "No puedes usar Marketplace" }, /Marketplace/],
    [{ url: ok, text: "Marketplace no está disponible para ti" }, /Marketplace/],
    [{ url: "https://www.facebook.com/two_step_verification/two_factor/" }, /2FA/],
    [{ url: "https://evil.example.com/marketplace" }, /fuera de Facebook/],
  ];
  for (const [input, re] of cases) {
    const r = detectCheckpoint(input);
    assert.ok(r && re.test(r), `${JSON.stringify(input)} → ${r}`);
  }
});

test("imágenes: solo https + host permitido", () => {
  assert.ok(assertAllowedImageUrl("https://xwiiwqrvxffafgvzypyd.supabase.co/storage/v1/object/public/a.jpg"));
  assert.throws(() => assertAllowedImageUrl("http://xwiiwqrvxffafgvzypyd.supabase.co/a.jpg"), /no-https/);
  assert.throws(() => assertAllowedImageUrl("https://evil.supabase.co/a.jpg"), /no permitido/);
  assert.throws(() => assertAllowedImageUrl("https://xwiiwqrvxffafgvzypyd.supabase.co.evil.com/a.jpg"), /no permitido/);
});

test("imágenes: descarga y rechaza tipos raros", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const fakeFetch = async (u) =>
    new Response(u.pathname.endsWith(".png") ? png : "<html>", {
      headers: { "content-type": u.pathname.endsWith(".png") ? "image/png" : "text/html" },
    });
  const good = await downloadImages(["https://xwiiwqrvxffafgvzypyd.supabase.co/x.png"], { fetchImpl: fakeFetch });
  assert.equal(good.files.length, 1);
  await good.cleanup();
  await assert.rejects(downloadImages(["https://xwiiwqrvxffafgvzypyd.supabase.co/x.html"], { fetchImpl: fakeFetch }), /no soportado/);
});

test("url de publicación: normaliza y rechaza hosts ajenos", () => {
  assert.equal(normalizeItemUrl("/marketplace/item/123/?ref=x"), "https://www.facebook.com/marketplace/item/123/");
  assert.equal(normalizeItemUrl("https://web.facebook.com/marketplace/item/9/"), "https://www.facebook.com/marketplace/item/9/");
  assert.equal(normalizeItemUrl("https://evil.com/marketplace/item/9/"), null);
  assert.equal(normalizeItemUrl("https://www.facebook.com/profile.php"), null);
});

test("api: 404 → ApiNotDeployedError; manda el header", async () => {
  let seen = "";
  const srv = http.createServer((req, res) => {
    seen = req.headers["x-cron-secret"];
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const api = createApi({ baseUrl: `http://127.0.0.1:${srv.address().port}`, secret: "s3" });
  await assert.rejects(api.next(), ApiNotDeployedError);
  assert.equal(seen, "s3");
  srv.close();
  assert.throws(() => createApi({ baseUrl: "http://bloo.example.com", secret: "x" }), /https/);
});

import { parseAmount, findMoney, readBoostTotal, readMinimum, detectPaymentSetup, isAlreadyPromoted, parseBoostConfig } from "../src/boost.mjs";
import { photoCount } from "../src/facebook.mjs";

test("pauta: montos es-CR / en-US", () => {
  assert.equal(parseAmount("500"), 500);
  assert.equal(parseAmount("500,00"), 500);
  assert.equal(parseAmount("1.000"), 1000);
  assert.equal(parseAmount("1,000.50"), 1000.5);
  assert.equal(parseAmount("1.000,00"), 1000);
  assert.equal(parseAmount("2.500.000"), 2500000);
  assert.equal(parseAmount("abc"), null);
  assert.deepEqual(
    findMoney("₡500 durante 1 día · US$1.25 · 3.000 CRC").map((m) => [m.amount, m.currency]),
    [[500, "CRC"], [1.25, "USD"], [3000, "CRC"]]
  );
});

test("pauta: lee el total y el mínimo", () => {
  assert.deepEqual(readBoostTotal("Duración: 1 día\nTotal: ₡500").amount, 500);
  assert.equal(readBoostTotal("Total\n₡14.000").amount, 14000);
  assert.equal(readBoostTotal("Presupuesto total\n₡500,00 CRC").currency, "CRC");
  assert.equal(readBoostTotal("Total a pagar US$5.00").currency, "USD");
  assert.equal(readBoostTotal("Presupuesto diario ₡2.000"), null);
  assert.equal(readMinimum("El presupuesto mínimo es ₡1.000").amount, 1000);
  assert.equal(readMinimum("Duración mínima: 1 día"), null);
});

test("pauta: detecta pedir tarjeta / método de pago nuevo", () => {
  assert.match(detectPaymentSetup({ text: "Agregar método de pago" }), /método de pago/);
  assert.match(detectPaymentSetup({ text: "Add payment method" }), /método de pago/);
  assert.match(detectPaymentSetup({ text: "Número de tarjeta" }), /tarjeta/);
  assert.match(detectPaymentSetup({ text: "Visa •••• 4242", hasCardInput: true }), /tarjeta/);
  // método ya guardado con enlace opcional "Agregar método de pago": NO bloquea
  assert.equal(detectPaymentSetup({ text: "Método de pago\nVisa •••• 4242\nAgregar método de pago" }), null);
  assert.equal(detectPaymentSetup({ text: "Total: ₡500\nPromocionar ahora" }), null);
});

test("pauta: ya promocionada / config del payload", () => {
  assert.ok(isAlreadyPromoted("Promoción en revisión"));
  assert.ok(isAlreadyPromoted("Your boost is active"));
  assert.ok(!isAlreadyPromoted("Promocionar publicación\nMarcar como agotado"));
  assert.equal(parseBoostConfig(null), null);
  assert.deepEqual(parseBoostConfig({ mode: "dry", amountCrc: 500 }), { ok: true, cfg: { mode: "dry", amountCrc: 500 } });
  assert.equal(parseBoostConfig({ mode: "on", amountCrc: 5000 }).ok, false);
  assert.equal(parseBoostConfig({ mode: "yes", amountCrc: 500 }).ok, false);
  assert.equal(parseBoostConfig({ mode: "on", amountCrc: 499.5 }).ok, false);
});

test("fotos: contador N/10", () => {
  assert.equal(photoCount("Fotos · 2/10 · Puedes agregar hasta 10 fotos."), 2);
  assert.equal(photoCount("2 / 10 - Agregar fotos"), 2);
  assert.equal(photoCount("Precio ₡15.000"), null);
});

test("imágenes: más de 10 → error (no se recorta en silencio)", async () => {
  const urls = Array.from({ length: 11 }, (_, i) => `https://xwiiwqrvxffafgvzypyd.supabase.co/${i}.png`);
  await assert.rejects(downloadImages(urls, { fetchImpl: async () => new Response("") }), /admite 10/);
});
