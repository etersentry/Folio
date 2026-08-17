# Folio

Aplicación web independiente para **anotar capturas y componer documentos** con la menor fricción posible:
pegas una captura, la app la acomoda, la marcas, la organizas en secciones y páginas, y exportas.

Funciona **completamente en el navegador** y **local-first**: no hay servidor, ni cuentas, ni red.
El proyecto editable vive en tu equipo (IndexedDB + archivo `.folio`).

---

## Cómo ejecutarla

No hay paso de compilación: es HTML + CSS + módulos ES nativos. Solo necesita servirse por HTTP
(los módulos ES no cargan con `file://`).

```bash
npm start          # http://localhost:8080  (usa npx http-server)
# o cualquier servidor estático:
python3 -m http.server 8080
```

Abre `http://localhost:8080` en un navegador moderno (Chrome/Edge 89+, Firefox, Safari 16.4+).

---

## Flujo principal

1. **Pega** una captura con `Ctrl/Cmd+V`, arrástrala a la ventana o usa **Imagen**.
2. Si insertas varias, se acomodan **de arriba hacia abajo** con márgenes y separación
   consistentes, dejando libre una **columna lateral para anotaciones**; cuando una página se
   llena, se crea la siguiente automáticamente.
3. **Marca** con recuadro, marcador, resaltador, flecha, línea, elipse o texto.
4. **Organiza** en secciones y páginas (arrastrar y soltar, duplicar, eliminar, contraer).
5. **Guarda** el proyecto editable o **exporta** el resultado final.

### Herramientas

| Tecla | Herramienta | Qué hace |
|---|---|---|
| `V` | Selección | Mover, redimensionar, seleccionar (marco de selección y `Shift` para múltiple) |
| `R` | Recuadro | Rectángulo transparente con borde configurable |
| `U` | Marcador | Banda horizontal semitransparente para subrayar líneas de texto |
| `H` | Resaltador | Rectángulo semitransparente libre |
| `A` | Flecha | Flecha configurable (`Shift` = 0°/45°/90°) |
| `L` | Línea | Línea libre (`Shift` = 0°/45°/90°) |
| `O` | Elipse | Elipse o círculo sin relleno (`Shift` = círculo) |
| `T` | Texto | Cuadro de texto editable y redimensionable, con borde opcional |
| `E` | Borrador | Borra anotaciones al arrastrar sobre ellas (nunca borra imágenes) |

### Atajos

`Ctrl/Cmd+V` pegar · `Ctrl/Cmd+Z` deshacer · `Ctrl/Cmd+Y` rehacer · `Ctrl/Cmd+D` duplicar ·
`Ctrl/Cmd+S` guardar (`Shift` = guardar como) · `Ctrl/Cmd+O` abrir · `Ctrl/Cmd+E` exportar ·
`Ctrl/Cmd+A` seleccionar todo · `Ctrl/Cmd+0` ajustar zoom · `Supr`/`Retroceso` eliminar ·
`Esc` quitar selección · flechas mover (con `Shift`, 10 px) · `Alt`+flechas cambiar de página ·
`Enter` editar el texto seleccionado.

El botón **?** de la barra superior muestra la lista completa.

---

## Guardar vs. exportar

Son dos cosas distintas y la interfaz las mantiene separadas:

| | Guardar proyecto | Exportar |
|---|---|---|
| Produce | Archivo **editable** `.folio` (JSON con las imágenes incrustadas) | PDF / PNG / JPG |
| Conserva | Secciones, páginas, objetos, imágenes, posición, tamaño, estilos y orden de capas | El resultado visual |
| Se abre con | **Abrir** (biblioteca local o archivo) | Cualquier visor |

* **Autoguardado**: cada cambio se guarda en IndexedDB tras un breve reposo. Al recargar,
  la sesión se recupera sola y se avisa en pantalla.
* **Guardar** escribe además el archivo `.folio` mediante la File System Access API
  (Chrome/Edge). En navegadores sin esa API se descarga el archivo.
* Los fallos de almacenamiento (por ejemplo, falta de espacio) **siempre se muestran**:
  aviso en la barra de estado y notificación persistente. Nunca fallan en silencio.

### Exportación

* **PDF** — todas las páginas **con contenido**, tamaño Carta (612×792 pt). Resolución
  seleccionable (120/200/300 ppp) y modo sin pérdida opcional (`FlateDecode`) cuando el
  navegador soporta `CompressionStream`; si no, se incrusta JPEG de alta calidad (`DCTDecode`).
  El PDF se genera sin bibliotecas externas.
* **PNG / JPG** — página actual, a la resolución elegida.

---

## Interfaz

* Panel izquierdo: herramientas + estructura del documento (secciones, páginas, miniaturas).
* Centro: lienzo Carta con zoom (`Ctrl`+rueda) y ajuste automático a la ventana.
* Panel derecho: propiedades contextuales — edita la selección o, si no hay selección,
  los valores por defecto de la herramienta activa.
* Barra superior: deshacer/rehacer, nuevo, abrir, guardar, exportar, imagen, zoom y apariencia.
* Barra de estado: estado de guardado, posición en el documento y pista de la herramienta.

**Apariencia**: tema claro/oscuro/sistema, color de acento (paleta o personalizado), cuatro fondos
de área de trabajo y un interruptor para desactivar la transparencia. Todo se recuerda entre sesiones.

**Accesibilidad**: `:focus-visible` en todos los controles, etiquetas y `aria-*` en botones e
iconos, navegación por teclado, respeto a `prefers-reduced-motion` y alternativa sólida cuando
`backdrop-filter` no está disponible o la transparencia se desactiva.

---

## Arquitectura

Sin dependencias ni bundler. Cada área es un módulo independiente y sustituible:

```
index.html
styles/      tokens.css · base.css · layout.css · components.css
src/
  core/        emitter · util · dom · constants · geometry     (sin estado de app)
  document/    model · store · history · assets                (estado del documento)
  canvas/      renderer · shapes · pageView · interactions · textEditor
  tools/       registry · toolState                            (herramientas y apariencia)
  import/      images                                          (pegado, archivos, auto-acomodo)
  export/      exporter · pdf                                  (PDF/PNG/JPG)
  storage/     db · serialize · projects · fileAccess          (IndexedDB, autoguardado, .folio)
  prefs/       preferences                                     (tema, acento, fondo)
  ui/          toolPanel · outline · properties · appearance · shortcuts ·
               thumbnails · exportDialog · dialogs · modal · toasts
  app.js       controlador: cablea servicios, comandos y UI
  main.js      arranque
```

Reglas que sostienen la separación:

* `document/store.js` es **el único** que muta el documento; todo lo demás reacciona a sus eventos
  (`change`, `structure`, `selection`, `history`, `page`).
* El historial guarda instantáneas del árbol de secciones/páginas; las imágenes viven aparte en
  `doc.assets` y nunca se duplican, así que deshacer sigue siendo barato con muchas capturas.
* Los arrastres usan una transacción "en vivo": una instantánea al empezar, repintados durante el
  gesto y **una sola** entrada de historial al soltar.
* El mismo renderizador (`canvas/renderer.js`) dibuja la pantalla, las miniaturas y las
  exportaciones, de modo que lo exportado es exactamente lo que se ve.

## Alcance

Aplicación genérica: no contiene nombres de empresas, clientes, catálogos, procesos internos ni
endpoints. Todo el contenido usado durante el desarrollo es ficticio.
