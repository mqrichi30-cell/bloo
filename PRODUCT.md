# Product

## Register

product

## Users

Dos roles internos de una marca costarricense de lentes de sol (dueño: Cristhofer): **vendedor**
(registra ventas en el punto de venta, en el teléfono, varias veces al día) y **admin**
(dueño/gerencia: todo lo del vendedor + inventario/compras + dashboard financiero). Uso
solo móvil, sin versión de escritorio. Contexto de uso: mostrador/tienda, una mano libre,
necesita velocidad (registrar una venta en pocos taps) por encima de cualquier otra cosa.

## Product Purpose

Reemplazar el registro manual/informal de ventas y compras de inventario de lentes de sol
por una app que: registra ventas con snapshot de costo (costeo CPPM), deriva IVA 13%
automáticamente, nunca deja stock negativo, y le da al admin un dashboard financiero con
utilidad real (sobre base sin IVA) sin exponer costos/márgenes al vendedor. Éxito = el
vendedor puede cerrar una venta en el mostrador en segundos, y el admin confía en las cifras
del dashboard para decisiones de negocio y su contador.

## Brand Personality

Costero-sereno, claro-directo, cálido-cercano, premium-discreto. "Una ola, no una tormenta":
el guiño de marca (mar, olas, "bloo") vive en saludos, confirmaciones y estados vacíos, una
vez por pantalla, nunca en cascada. Fuera de esos momentos la app es una herramienta de
trabajo restrained que se prioriza por velocidad y confianza en los números.

## Anti-references

No es una app de consumo/lifestyle de playa (nada de exceso decorativo, sin glassmorphism,
sin gradientes, sin iconografía tropical genérica). No es un dashboard SaaS genérico de
métricas infladas. El vendedor nunca debe ver una cifra de costo/utilidad/margen, ni en
pantalla ni en la respuesta de red — eso no es una preferencia estética, es una regla de
seguridad/negocio (ver Design Principles).

## Design Principles

- **El dinero nunca miente por redondeo:** todo monto vive como entero en céntimos; la
  utilidad siempre se calcula sobre la base sin IVA; el costo promedio se deriva al vuelo,
  nunca se guarda ya redondeado.
- **El rol determina lo que existe, no lo que se oculta con CSS:** costo/utilidad/margen se
  excluyen server-side con `select` allowlist por rol; el vendedor jamás los recibe en el
  payload, aunque la UI nunca los muestre.
- **Append-only como memoria:** ventas y compras no se editan, se corrigen con
  devolución/ajuste + registro de auditoría, para que el número de hoy siga siendo el número
  de mañana.
- **Velocidad de mostrador:** el flujo de venta se diseña para el caso simple en 3 taps;
  todo lo demás (multi-ítem, descuentos, proveedor) es progresivo, no obligatorio.
- **Un guiño de marca por pantalla:** costero en el lugar justo (saludo, éxito, vacío),
  nunca decorando el trabajo denso (formularios, tablas, dashboard).

## Accessibility & Inclusion

Objetivo táctil ≥48×48dp (uso a una mano en mostrador). Contraste texto ≥4.5:1 (placeholder
al mismo nivel que el texto secundario, no un gris más claro). Estado nunca solo por color
(badges con ícono+texto, deltas con flecha+signo). Tipografía en `rem`, respeta el tamaño de
fuente del sistema operativo. `prefers-reduced-motion` respetado en toda animación.
