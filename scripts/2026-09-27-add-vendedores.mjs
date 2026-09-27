// Alta de 2 usuarios vendedor en prod: susan y ashley. Idempotente por
// username (upsert-sin-pisar: si ya existe, se reporta y no se toca nada —
// nunca reescribe el passwordHash de una cuenta que ya vive, para no botar
// a alguien que ya inició sesión).
//
// Contraseña ALEATORIA fuerte (32 bytes), generada acá y NUNCA impresa ni
// guardada en archivo: entran por "olvidé mi contraseña" (/api/auth/forgot).
// Mismo hash que lib/auth.ts (bcrypt cost 12) y mismo patrón de conexión que
// el resto de scripts/ (PrismaClient con DATABASE_URL/.env).
//
//   node --env-file=.env scripts/2026-09-27-add-vendedores.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-27-add-vendedores.mjs --apply   (escribe)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const BCRYPT_COST = 12; // igual que lib/auth.ts

const prisma = new PrismaClient();

const NUEVOS = [
  { username: "susan", nombre: "Susan", email: "susanherrerafonseca@gmail.com" },
  { username: "ashley", nombre: "Ashley", email: "matarritayonis41@gmail.com" },
];

function randomStrongPassword() {
  // 32 bytes al azar en base64url: entropía muy por encima de lo que un
  // humano tecleraría, y de todas formas nunca se usa a mano — la cuenta
  // arranca en "olvidé mi contraseña".
  return randomBytes(32).toString("base64url");
}

async function main() {
  console.log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (nada se escribe)");

  for (const { username, nombre, email } of NUEVOS) {
    const existente = await prisma.user.findUnique({ where: { username } });
    if (existente) {
      console.log(
        `[skip] "${username}" ya existe (role=${existente.role}, activo=${existente.activo}) — no se toca.`
      );
      continue;
    }

    if (!APPLY) {
      console.log(`[dry-run] crearía "${username}" (${nombre}, ${email}), role=vendedor, activo=true.`);
      continue;
    }

    const passwordHash = await bcrypt.hash(randomStrongPassword(), BCRYPT_COST);
    const user = await prisma.user.create({
      data: { username, passwordHash, nombre, role: "vendedor", activo: true, email },
    });
    console.log(`[creado] "${user.username}" (id=${user.id}). Entra por /login → "Olvidé mi contraseña".`);
  }

  if (!APPLY) console.log("\nCorré con --apply para escribir.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
