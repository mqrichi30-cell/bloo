# Formulario real de Marketplace (capturado 2026-09-26, es-CR, perfil personal)

URL: https://www.facebook.com/marketplace/create/item — título de pestaña "Crear publicación | Facebook".
Publica como el PERFIL PERSONAL (Cristhofer Marin Quiros), visibilidad "Público".

Campos (label visible → control):
- Fotos: `input[type=file][accept="image/*,image/heif,image/heic"]`, máx. 10. Texto "0/10", "Agregar fotos".
- Título → input text (label "Título").
- Precio → input text (label "Precio").
- Categoría → combobox (label "Categoría").
- Estado → combobox (label "Estado") → elegir "Nuevo".
- "Más detalles" → expande Descripción (y otros).
- Checkbox "Promocionar tras publicar" → dejar DESMARCADO (crearía un anuncio pagado).
- Checkbox "Ocultar a amigos" → dejar como esté.
- Botón "Siguiente" (luego pantalla de publicación con botón "Publicar"). También hay "Guardar borrador".

Notas: la UI es React; usar clicks/teclado reales (no set value). Ubicación suele autocompletarse; si pide, "San José".
