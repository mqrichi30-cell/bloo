// Prueba de lib/meta/signature.ts con un secreto falso. Importa el .ts real
// vía tsx (ya es devDependency). Correr:
//   node --import tsx scripts/test-meta-signature.mjs
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { verifyMetaSignature } from "../lib/meta/signature.ts";

const secret = "secreto-falso-solo-para-test";
const body = Buffer.from(
  '{"object":"page","entry":[{"id":"1","messaging":[{"sender":{"id":"2"},"timestamp":1,"message":{"mid":"m1","text":"hola ñandú ₡"}}]}]}',
  "utf8"
);
const firma = (s, b) => "sha256=" + createHmac("sha256", s).update(b).digest("hex");

const casos = [
  ["firma válida", verifyMetaSignature(body, firma(secret, body), secret), true],
  ["hex en mayúsculas", verifyMetaSignature(body, "sha256=" + firma(secret, body).slice(7).toUpperCase(), secret), true],
  ["secreto equivocado", verifyMetaSignature(body, firma("otro", body), secret), false],
  ["body alterado 1 byte", verifyMetaSignature(Buffer.concat([body, Buffer.from(" ")]), firma(secret, body), secret), false],
  ["JSON re-serializado", verifyMetaSignature(Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1)), firma(secret, body), secret), false],
  ["header ausente", verifyMetaSignature(body, null, secret), false],
  ["algoritmo sha1", verifyMetaSignature(body, firma(secret, body).replace("sha256=", "sha1="), secret), false],
  ["hex truncado", verifyMetaSignature(body, firma(secret, body).slice(0, -2), secret), false],
  ["hex no-hex", verifyMetaSignature(body, "sha256=" + "z".repeat(64), secret), false],
  ["secreto vacío", verifyMetaSignature(body, firma("", body), ""), false],
];

let fallos = 0;
for (const [nombre, obtenido, esperado] of casos) {
  try {
    assert.equal(obtenido, esperado);
    console.log("ok   ", nombre);
  } catch {
    fallos++;
    console.log("FALLA", nombre, "esperado", esperado, "obtenido", obtenido);
  }
}
if (fallos) {
  console.error(`${fallos} caso(s) fallaron`);
  process.exit(1);
}
console.log(`${casos.length} casos OK`);
