// Fuerza el cierre de sesión de UN usuario en TODOS sus dispositivos,
// incrementando User.sessionVersion (ver lib/require-session.ts): la próxima
// vez que ese dispositivo llame a cualquier ruta protegida, la cookie deja
// de validar y se le pide loguearse de nuevo.
//
// No hay UI admin para esto todavía (no existe gestión de usuarios en la
// app) — hasta que exista, este script es la única forma. Úsalo también
// después de resetear a mano la contraseña de alguien desde Prisma Studio.
//
//   node --env-file=.env scripts/2026-09-27-forzar-cierre-sesion.mjs <username>            (dry-run)
//   node --env-file=.env scripts/2026-09-27-forzar-cierre-sesion.mjs <username> --apply     (escribe)
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const username = process.argv[2];

if (!username || username === "--apply") {
  console.error("Uso: node scripts/2026-09-27-forzar-cierre-sesion.mjs <username> [--apply]");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No existe el usuario "${username}".`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `"${username}": sessionVersion actual = ${user.sessionVersion}. ` +
      `${APPLY ? "Subiendo a" : "[dry-run] subiría a"} ${user.sessionVersion + 1}.`
  );

  if (!APPLY) {
    console.log("Corré con --apply para escribir.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
  });
  console.log(`Listo. Todas las sesiones abiertas de "${username}" quedaron invalidadas.`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
