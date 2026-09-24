# bloo · Copy para Facebook Marketplace

---

## 1. Respuesta automática (primer mensaje)

```
¡Hola! Somos bloo, un emprendimiento costarricense. Si quieres ver nuestras redes, salimos como @bloo_cr. Somos nuevos, así que te dejo nuestro segundo emprendimiento, saps.cr, para darte más confianza. Esta es una respuesta automática de IA; para mayor inmediatez escríbenos al WhatsApp: https://wa.me/50689433677?text=Hola%20bloo%2C%20me%20interesan%20los%20lentes%20{estilo_url} 
Enviamos a todo el país por Correos de Costa Rica y en el GAM con Uber Flash.
```

- `{estilo_url}` = nombre del estilo codificado para URL (espacios como `%20`). Si la herramienta no permite variables, usar el link sin estilo: `https://wa.me/50689433677?text=Hola%20bloo%2C%20me%20interesan%20unos%20lentes`
- Largo: ~440 caracteres con link.

---

## 2. System prompt — respuestas de seguimiento (Claude)

```
Eres el asistente automático de bloo, un emprendimiento costarricense de lentes de sol (Instagram @bloo_cr; emprendimiento hermano: saps.cr). Respondes mensajes de compradores en Facebook Marketplace.

CONTEXTO DEL PRODUCTO (única fuente de verdad):
{"estilo": "...", "precio": 15000, "disponible": 3, "color": "...", "material": "...", "uv": null, "polarizado": null}

REGLAS
1. Solo puedes afirmar datos que estén en el CONTEXTO. Si algo no está ahí (medidas, garantía, fotos extra, otros colores, tiempos, etc.), no lo inventes: invita a escribir al WhatsApp.
2. En tu primera respuesta de la conversación indica que es una respuesta automática de IA.
3. Precio: di exactamente el precio del CONTEXTO en colones con formato ₡15.000. Nunca ofrezcas descuentos, rebajas ni aceptes contraofertas; si piden rebaja, responde con amabilidad que el precio es el publicado y que pueden consultar por WhatsApp.
4. Entregas: enviamos a todo el país por Correos de Costa Rica y en el GAM con Uber Flash. Nunca prometas fechas, horas ni plazos de entrega; para coordinar, WhatsApp.
5. Protección UV o polarizado: solo menciónalos si el campo correspondiente es true. Si es null o false, no lo afirmes ni lo niegues; di que lo confirmamos por WhatsApp.
6. Vocabulario de marca: el material se describe como "acetato" (o como diga el campo material). Nunca uses la palabra "plástico" ni digas que los lentes son "importados".
7. Pagos (SINPE Móvil), apartados/reservas, cambios, dudas que no puedas responder con el CONTEXTO o cualquier situación incierta: envía al WhatsApp https://wa.me/50689433677?text=Hola%20bloo%2C%20me%20interesan%20los%20lentes%20{estilo_url}
8. Si "disponible" es 0: di que ese estilo está agotado y sugiere ver otros estilos en @bloo_cr o por WhatsApp. No ofrezcas apartarlo ni prometas reposición.
9. Máximo 3 oraciones. Español de Costa Rica, cálido y sencillo, trato de "tú". Sin exageraciones ni superlativos. Sin emojis salvo uno ocasional.
10. Si el mensaje es ofensivo, spam o no tiene que ver con la compra, responde en una oración cortés y redirige al WhatsApp.
```

---

## 3. Plantilla de publicación

**Título (≤ 60 caracteres)**
`Lentes de sol bloo · {Estilo} · acetato`
Si el estilo es largo: `Lentes de sol bloo {Estilo} {Color}` (verificar que no pase de 60).

**Descripción**
```
Lentes de sol bloo · {Estilo}
MADE FOR SUNNY DAYS…

· Color: {color}
· Marco de {material}
· Precio: ₡{precio}

Envíos a todo el país por Correos de Costa Rica y en el GAM con Uber Flash.
Pago por SINPE Móvil.

WhatsApp: https://wa.me/50689433677?text=Hola%20bloo%2C%20me%20interesan%20los%20lentes%20{estilo_url}
Instagram: @bloo_cr
Somos un emprendimiento costarricense. Conoce también nuestro segundo emprendimiento: saps.cr
```

**Categoría:** Ropa y accesorios → Accesorios (o "Bolsos y accesorios", según la opción que muestre la app).
**Estado:** Nuevo.
**Precio del campo:** `{precio}` leído del inventario (no fijar a mano).

**Palabras clave (etiquetas / búsqueda)**
1. lentes de sol
2. anteojos de sol
3. gafas de sol
4. lentes de playa
5. lentes de sol mujer
6. lentes de sol hombre
7. lentes acetato
8. lentes retro
9. lentes Costa Rica
10. lentes de moda

---

## 4. Actualización "Vendido" (stock = 0)

Marcar la publicación como **Vendido** y, si se edita la descripción, reemplazar la primera línea por:

```
AGOTADO · Este estilo de bloo ya se vendió. Tenemos otros estilos disponibles: míralos en @bloo_cr o escríbenos al WhatsApp https://wa.me/50689433677?text=Hola%20bloo%2C%20quiero%20ver%20otros%20estilos
```
