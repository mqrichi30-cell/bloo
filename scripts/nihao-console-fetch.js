// ═══════════════════════════════════════════════════════════════════
// SNIPPET — pegar en la consola del browser mientras estás logueado
// en https://www.nihaojewelry.com (cualquier pestaña del sitio).
//
// Cómo usarlo:
//  1. Abrí https://www.nihaojewelry.com y asegurate de estar logueado.
//  2. Abrí DevTools → Consola (F12 → Console).
//  3. Pegá TODO este código y presioná Enter.
//  4. Cambiá ORDER_NUMBER por el número de tu último pedido de lentes.
//  5. El resultado aparece en la consola y se COPIA al portapapeles.
//  6. Guardalo como "nihao-variants.json" en C:\bloo\.
//  7. Corrí: node --env-file=.env scripts/2026-09-21-nihao-variants.mjs --apply --seed nihao-variants.json
// ═══════════════════════════════════════════════════════════════════

(async () => {
  // ── CONFIGURAR AQUÍ ──────────────────────────────────────────────
  const ORDER_NUMBER = "NHCR609092339756"; // ← cambiá al número de tu pedido
  // Palabras clave para filtrar solo los lentes (no estuches, joyas, etc.)
  const LENTES_KEYWORDS = ["sunglass", "sunglasses", "gafas", "lentes", "glasses"];
  const EXCLUIR_KEYWORDS = ["case", "pouch", "bag", "holder", "tray", "cloth", "cleaning", "jewelry", "ring", "necklace", "bracelet", "earring", "pendant", "crystal"];
  // ────────────────────────────────────────────────────────────────

  console.log(`Fetching order ${ORDER_NUMBER}…`);

  const resp = await fetch("/st-order/query/detail", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNumber: ORDER_NUMBER }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);

  const data = await resp.json();
  const items = data?.data?.orderItems ?? data?.orderItems ?? data?.data?.items ?? [];

  if (!items.length) {
    console.error("No se encontraron orderItems. Respuesta completa:");
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`Total ítems en la orden: ${items.length}`);

  // Filtrar solo lentes de sol
  const lentes = items.filter((item) => {
    const name = (item.productName ?? item.name ?? "").toLowerCase();
    const isLente = LENTES_KEYWORDS.some((k) => name.includes(k));
    const isExcluido = EXCLUIR_KEYWORDS.some((k) => name.includes(k));
    return isLente && !isExcluido;
  });

  console.log(`Ítems que parecen lentes de sol: ${lentes.length}`);
  if (lentes.length === 0) {
    console.warn("Sin lentes detectados. Listando todos los ítems para revisar manualmente:");
    items.forEach((i) => console.log(`  SKU: ${i.sku ?? "-"} | ${i.productName ?? i.name} | color: ${i.color ?? "-"}`));
    return;
  }

  // Extraer variantes con imagen del color exacto
  const variants = lentes.map((item) => {
    // La imagen puede estar en múltiples ubicaciones según la versión de la API
    const imageUrl =
      item.colorImageUrl ??
      item.imageUrl ??
      item.image ??
      item.productImage ??
      item.img ??
      item.variantImage ??
      // Si hay array de imágenes, primer elemento
      (Array.isArray(item.images) ? item.images[0] : null) ??
      (Array.isArray(item.productImages) ? item.productImages[0] : null) ??
      "";

    return {
      sku: item.sku ?? item.productSku ?? "",
      color: item.color ?? item.colorName ?? item.variantName ?? "Sin color",
      productName: item.productName ?? item.name ?? "",
      imageUrl,
      qty: item.qtyOrdered ?? item.quantity ?? item.qty ?? 1,
    };
  });

  // Mostrar raw para verificar que las imágenes son del color correcto
  console.log("\n═══ VARIANTES EXTRAÍDAS ═══");
  variants.forEach((v) => {
    console.log(`  ${v.sku} | ${v.color} | qty: ${v.qty}`);
    console.log(`    imagen: ${v.imageUrl || "⚠ SIN IMAGEN"}`);
  });

  const output = {
    orderRef: ORDER_NUMBER,
    extractedAt: new Date().toISOString(),
    variants,
  };

  const json = JSON.stringify(output, null, 2);
  console.log("\n═══ JSON FINAL (copiado al portapapeles) ═══");
  console.log(json);

  try {
    await navigator.clipboard.writeText(json);
    console.log("\n✓ Copiado al portapapeles. Guardalo como nihao-variants.json en C:\\bloo\\");
  } catch {
    console.log("\n⚠ No se pudo copiar al portapapeles. Copiá el JSON manualmente de arriba.");
  }

  // También guarda en window para acceso fácil
  window._nihaoVariants = output;
  console.log("(También disponible en window._nihaoVariants)");
})();
