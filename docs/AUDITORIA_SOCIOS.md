# Auditoría de seguridad — superficie pública `/socios`

Alcance: `app/api/socios/avance/route.ts`, `lib/socios-avance.ts`, `app/api/socios/route.ts`,
`middleware.ts`. Estado del código al momento de la auditoría (2026-08-16). Defensivo únicamente.

---

## ALTO

**1. La estrategia de cache del contador probablemente no funciona — `app/api/socios/avance/route.ts:16-19,56`**
`export const revalidate = 3600` se declara junto a `GET(request: Request)`, y el handler lee
`request.headers` (línea 19, para `getClientIp`). En Next.js 14 App Router, un Route Handler que
usa el objeto `Request` con el método GET **queda fuera del Full Route Cache** — `revalidate` no
tiene efecto sobre un route handler dinámico. Además, `next.config.mjs:45-49` fija
`Cache-Control: no-store` para todo path excepto `_next/static`, `_next/image` y `favicon.ico`,
lo que incluye a `/api/socios/avance` y compite con el `Cache-Control: public, ... s-maxage=3600`
que el propio route.ts intenta emitir (línea 56). Con `AvanceMeta1.tsx` haciendo `fetch` desde el
cliente en cada carga de página (no en build/SSR), el resultado probable es que **cada visita a
`/socios` dispare 3 consultas SQL crudas contra la misma base de producción que corre las
ventas**, exactamente el escenario que `docs/METAS_UMBRALES.md` §9.6 pedía evitar cacheando 1h.
**Arreglo:** (a) excluir `/api/socios/avance` de la regla global `no-store` en `next.config.mjs`
(o acotar esa regla a las rutas que de verdad la necesitan); (b) si se necesita el IP para el
rate limit, resolverlo sin forzar el handler a dinámico, o aceptar que es dinámico y no depender
de `revalidate` — solo del header de respuesta + lo que el hosting respete de `s-maxage`; (c)
verificar en un build/deploy real que el header que llega al cliente es el del route handler y
no `no-store`.

**2. El rate limit no es por IP — es un balde global compartido — `lib/auth.ts:106-110`, `app/api/socios/avance/route.ts:20`, `app/api/socios/route.ts:14`**
`getClientIp` devuelve el literal `"untrusted"` para todo caller salvo que `TRUST_PROXY_HEADERS=true`
esté seteado. `.env` no lo define (solo `.env.example` lo documenta en `"false"`). Por lo tanto
`checkRateLimit(\`socios-avance:${ip}\`, ...)` y `checkRateLimit(\`socios:${ip}\`, ...)` colapsan
en una sola clave compartida por absolutamente todo el tráfico de internet. Hoy esto
accidentalmente limita el volumen total (30 req/10min al contador, 5 req/10min al formulario) —
protege a Supabase, pero **cualquier ráfaga de visitantes legítimos (o un solo bot) agota la
cuota para todos los demás**, incluido el formulario de contacto, que es el propósito comercial
de la página. El comentario del código ("Rate limit por IP") describe una intención que la
config actual no entrega. Es crítico resolver esto junto con el hallazgo 1: si más adelante se
activa `TRUST_PROXY_HEADERS=true` para arreglar la experiencia de usuario, la protección contra
DoS a Supabase se debilita mucho (N IPs × 30 consultas en vez de un techo global de 30),
justo cuando el cacheo real (hallazgo 1) sigue sin confirmarse.
**Arreglo:** decidir y documentar el comportamiento esperado explícitamente. Si el despliegue es
Netlify (hay `.netlify` en `.gitignore`), su borde entrega `x-forwarded-for` confiable — activar
`TRUST_PROXY_HEADERS=true` ahí es razonable, pero solo *junto con* arreglar el hallazgo 1, nunca
por separado.

---

## MEDIO

**3. `$queryRawUnsafe` sin input externo hoy, pero es el patrón que cualquiera va a copiar — `lib/socios-avance.ts:20,70,111,129`**
Verificado: `FILTRO_LENTE_SQL` es una constante de compilación (`m."categoria" = 'Lentes de sol'`)
y ninguna de las tres funciones (`getUltimosTresMeses`, `getMesesCompletosCount`,
`getMesEnCurso`) recibe argumentos — hoy no hay ningún valor de la request que llegue a estas
consultas. No hay inyección SQL viva. El riesgo es de precedente: es el único archivo que habla
con la base para toda esta superficie pública, y su patrón establecido es "interpolar un string
dentro de `$queryRawUnsafe`" — sin escapado ni parametrización de ningún tipo. El próximo que
necesite un filtro (`?periodo=`, desglose por tienda, lo que sea) tiene la plantilla lista para
copiar y pegar un valor de request ahí mismo, sin que nada en el código lo marque como peligroso.
**Arreglo:** migrar a `prisma.$queryRaw` (template parametrizado). Para el único fragmento SQL
verdaderamente estático (`FILTRO_LENTE_SQL`), envolverlo explícitamente con
`Prisma.raw(FILTRO_LENTE_SQL)` dentro del template de `$queryRaw` — así la consulta queda
parametrizada por defecto, y cualquier fragmento crudo futuro es visualmente explícito y
buscable (`Prisma.raw(`) en vez de estar indistinguible dentro de un `Unsafe` genérico.

**4. `middleware.ts:16,31` — coincidencia por prefijo abre más de lo previsto**
`PUBLIC_API_PREFIXES = [..., "/api/socios"]` combinado con `pathname.startsWith(p)` hace público
cualquier path que *empiece* con el literal `/api/socios`, no solo `/api/socios/*`. Probado:
`/api/sociosadmin`, `/api/socios-internal`, `/api/socios%2Fadmin` matchean hoy. No existe
todavía ninguna ruta así, pero es una trampa activa: si mañana se agrega un endpoint admin para
listar `SocioLead` (ej. `app/api/sociosAdmin/route.ts` o `app/api/socios-export/route.ts` —
nombres naturales dada la convención ya existente), queda público sin auth, en silencio, sin
error de build ni de runtime que lo delate.
**Arreglo:** `pathname === "/api/socios" || pathname.startsWith("/api/socios/")`. Mismo patrón
aplica a `/api/auth/login` y `/api/auth/logout`, con menor riesgo hoy por no tener nombres
colisionables cercanos.

**5. Aviso de tratamiento de datos (Ley 8968/PRODHAB) ausente en el formulario — `app/(public)/socios/_content.ts:231`, `app/api/socios/route.ts`**
El formulario recolecta nombre, negocio, cantón, WhatsApp y correo de terceros y los persiste
(`SocioLead`, `prisma/schema.prisma:337-356`). El único texto relacionado con uso de datos es
"Usamos sus datos solo para este contacto comercial" — no identifica al responsable del
tratamiento, no declara plazo de conservación ni cómo ejercer derechos ARCO, y no hay checkbox
de consentimiento. `docs/COPY_SOCIOS.md:572` ya tiene este ítem listado como pendiente de
revisión legal antes de publicar ("Formulario. Aviso de tratamiento de datos conforme a la Ley
8968"). Confirmado: sigue sin resolver en el código que se va a publicar.
**Arreglo:** agregar aviso de tratamiento conforme a Ley 8968 (finalidad, plazo, responsable,
cómo ejercer ARCO) visible en el punto de captura, antes de que el formulario reciba tráfico real.

**6. Sin límite de tamaño de cuerpo antes de parsear — `app/api/socios/route.ts:24`**
`await request.json()` no valida `Content-Length` antes de bufferear todo el body en memoria; los
límites de Zod (`lib/validation.ts:122-147`, ej. `mensaje` ≤1000) solo aplican después de parsear
el JSON completo. Severidad baja hoy porque el rate limit global compartido (hallazgo 2) ya cap
a 5 req/10min, pero esa protección es incidental, no diseñada para esto.
**Arreglo:** rechazar por `Content-Length` (ej. >10 KB) antes de llamar `request.json()`.

---

## Respuesta a los dos puntos priorizados por el coordinador

**`$queryRawUnsafe`, ¿input externo hoy?** No. Confirmado línea por línea: `FILTRO_LENTE_SQL` es
constante y las tres funciones que la usan no reciben parámetros. Ver hallazgo 3 arriba para el
riesgo de precedente y el arreglo recomendado (parametrizar con `$queryRaw` + `Prisma.raw` para
el fragmento estático).

**¿Se filtra el error de la consulta al cliente? ¿Se puede distinguir "sin datos" de "consulta
rota"?** No se filtra — verificado. `lib/socios-avance.ts:214-247` envuelve las tres consultas en
try/catch; cualquier excepción (incluida la actual en local, `relation "SaleItem" does not
exist`, por migraciones no aplicadas) se loguea solo server-side (`console.error`, línea 245) y
cae a `respuestaNoDisponible()`, la misma forma genérica del contrato público. El route handler
siempre responde HTTP 200 con el mismo shape de JSON, nunca con el mensaje de excepción, stack
trace, ni nombre de tabla/columna. La única señal que distingue "todavía no hay 3 meses"
(`datos_insuficientes`) de "la consulta reventó" (`no_disponible`) es el string de `estado`
pre-escrito — ningún código HTTP ni contenido adicional delata cuál de las dos ocurrió, y ninguna
de las dos revela nada del esquema. **Bien resuelto, sin acción pendiente.** Nota aparte, no
evaluable acá: `console.error(err)` sí deja el error crudo de Postgres en los logs del servidor
— si esos logs terminan en un agregador con control de acceso distinto al de la base de datos,
sería una exposición interna, no de cliente; depende de infraestructura de despliegue no
presente en este repo.

---

## Bien resuelto (sin acción)

- **Allowlist del contador — `app/api/socios/avance/route.ts:31-56`, `lib/socios-avance.ts:159-175`.**
  Construida campo por campo desde un tipo `AvancePublico`, nunca spread de una fila de Prisma.
  Coincide casi exactamente con la lista explícita de `docs/METAS_UMBRALES.md` §9.6, que prohíbe
  cualquier monto, `cogsCent`/`utilidadCent`/`costoUnitSnapshotCent`, conteo de tickets, desglose
  por tienda/usuario y cualquier UUID. `metas[].id` es un string de negocio fijo
  (`"peldano_1"|"peldano_2"`), no un identificador de base de datos. Combinar llamadas en el
  tiempo solo revela unidades mensuales/parciales — que es exactamente lo que la página promete
  publicar; no hay margen ni costo en ningún otro punto de la respuesta con qué cruzarlo.
- **Formulario de contacto — honeypot + Zod + `prisma.create` tipado (`app/api/socios/route.ts`).**
  Sin superficie de inyección; validación server-side real, no solo de cliente.
- **`SocioLead.id` es UUID (`prisma/schema.prisma:338`)** — no enumerable.
- **Secretos** — `.env` gitignorado correctamente; único `NEXT_PUBLIC_*` en todo el repo es
  `NEXT_PUBLIC_SITE_URL` (no es secreto). Ninguna env var sensible referenciada desde
  `/socios` o `/api/socios*`.
- **CSRF** — no aplica por diseño en estas dos rutas (no hay cookie de sesión que falsificar);
  el honeypot + rate limit son la defensa real, correctamente razonado en el comentario de
  `app/api/socios/route.ts:7-10`.

## No evaluable todavía

- **XSS almacenado vía `SocioLead` en un panel admin.** No existe ninguna vista admin que
  renderice `nombre`/`negocio`/`mensaje` de `SocioLead` (confirmado por búsqueda en todo `app/`).
  No hay `dangerouslySetInnerHTML` en el repo, lo cual es una buena señal para cuando esa vista
  se construya, pero no hay nada que auditar hoy. Revisar cuando exista esa pantalla.
- **Comportamiento real de cache/CDN en producción (hallazgo 1).** El build de verificación no
  terminó a tiempo para confirmar con evidencia de despliegue si `s-maxage=3600` efectivamente
  llega al cliente o si `no-store` de `next.config.mjs` lo pisa. El hallazgo se basa en el
  comportamiento documentado de Next.js 14 para Route Handlers que usan el objeto `Request`, no
  en una prueba empírica de este despliegue — verificar con un `curl -I` contra el ambiente real
  antes de cerrar el hallazgo 1.
