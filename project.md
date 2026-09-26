# Paz y Tato conquistan América

Sitio personal para planear y mostrar nuestro viaje a NYC. Salida: 23 de diciembre de 2026. Prioridades: mapa útil, lugares seleccionados y una identidad gráfica inspirada en el subte de Nueva York. Cine, diseño, comida asiática y moda orientan la selección; no llenar por llenar.

## Estado y estructura

- HTML, CSS y JavaScript vanilla en `dist/`. No usamos Next.js todavía; la migración queda para más adelante. GSAP o Three.js no la requieren.
- `server.mjs`: servidor Node, API y SQLite. `images.mjs`: originales y variantes de imagen con Sharp.
- `data/places.sqlite`: datos vivos (lugares, fotos y visitados). `data/photos/`: fotos locales. Ambos están fuera de Git; compartir el repo no sincroniza estos datos.
- `db/curated-places.json`: selección de referencia; no se importa automáticamente al iniciar. `db/research-neighborhoods.md`: selección por barrios y fuentes.
- `npm run dev`: servidor local en puerto 4173, escuchando en `0.0.0.0`. En el mismo wifi se usa la IP local del equipo. No hay despliegue público.

## Lo que ya funciona

Hero con contador, mapa y listado por categorías: comida, museos/cultura, paseos y shop. Fotografías al hover en la lista, reemplazo por archivo o arrastre, y marcar visitado desde la card large.

Mapa Leaflet con base vectorial MapLibre/OpenFreeMap y respaldo raster de OpenStreetMap. Tres niveles: general, calles (14.5), manzana (18). Minimapa de ubicación en calles y manzana. Click en categoría la aísla; repetir muestra todas. Ver todo encuadra los puntos visibles y permite acercarse si están juntos. Los puntos no se conectan con recorridos.

Barrios de Manhattan y subtes son overlays independientes que responden al zoom. Barrios se oculta en manzana. Cards para lugares, estaciones y barrios; las de barrio listan los lugares guardados dentro de su polígono.

## Reglas de UI

- Fondo blanco, negro y acentos del subte por categoría. Helvetica/Helvetica Neue bold; conservar pocos tokens compartidos.
- Grilla de 12 columnas, gutter y padding horizontal de 16 px. Sidebar 3 columnas; mapa 9, altura 80svh. Adaptación apilada en móvil.
- Cuatro roles de texto: título, subtítulo, párrafo y detalle. Primera letra capitalizada, salvo la lista editorial inferior en minúsculas.
- `createMapCard` es el componente común: `small` dentro del mapa, `large` en sidebar; variantes place, subway y neighborhood. Badge alineado con la primera línea del título.
- Acciones al borde de la card, padding horizontal compartido de 16 px y altura mínima de 48 px. Separación actual antes del pie: 4 rem. Ver lugar es negro; Marcar visitado es secundario blanco y solo aparece en la sidebar. Hover con el acento de la categoría.
- Iconos tipográficos (+, −, ↗, ↔); no incorporar un set de SVG. Flecha externa compartida en `.ui-arrow`.
- Agregar lugar y créditos van al pie de la sidebar. Mantener atribuciones de los proveedores del mapa.
- Evitar copy y features no pedidos. Reutilizar componentes y variantes antes de duplicar estilos.

## Imágenes y datos

Conservar originales; renderizar variantes cuadradas WebP mediante `srcset` y `/photos/archivo?w=...`. Upload máximo 50 MB. No reemplazar fotos elegidas por los usuarios durante enriquecimientos. Preferir imágenes identificables del lugar; evitar logos genéricos y fotos de otra sucursal. Registrar fuente al incorporar imágenes en `db/photo-sources.json`.

Pasada del 26/09/2026: 40 lugares, 34 con foto local; se agregaron 13 imágenes sin reemplazar las anteriores. Pendientes: Procell, Kinokuniya, Yoseka, Roxy Cinema, Film at Lincoln Center y Oculus. La procedencia queda registrada en el archivo; la API todavía no devuelve ese registro al mostrar fotos ya cacheadas.

## Cómo trabajar

El usuario maneja el preview y la revisión visual. No abrir navegador, levantar/reiniciar servidores ni publicar sin pedido. Se permiten chequeos de sintaxis (`npm run check`). El hero lo está trabajando Paz en otra branch: coordinar antes de tocarlo. Preservar cambios existentes y no confundir los archivos de referencia del proyecto ChatGPT con el código del sitio.

## Pendientes detectados

- Si se cambia la computadora que actúa como servidor, trasladar la base y las fotos juntas; el repo no incluye esos datos.
- La API permite agregar lugares y marcar visitados, pero no editar/eliminar lugares desde la UI.
- La búsqueda automática de fotos puede confundir nombres o elegir logos; requiere curación y conservar la procedencia.
- Confirmar horarios festivos, funciones y puestos callejeros cerca del viaje. No guardar horarios supuestos como hechos.

## Base compartida y backups

Esta computadora es el servidor de datos para ambos: entrar por su URL del wifi, incluso si el código se desarrolla en branches diferentes. Levantar otro servidor en otra computadora crea otra base; no hay sincronización entre servidores.

`backups.mjs` guarda al iniciar, tras cambios exitosos (con 2 segundos de espera) y cada 10 minutos. `backups/latest.sqlite` es la copia actual; `backups/AAAA-MM-DD.sqlite` conserva la primera copia de cada día. `backups/photos/` conserva los originales, sin variantes regenerables, y `status.json` indica la última copia exitosa. La carpeta está fuera de Git. Ya se creó un backup inicial.

Para restaurar: detener el servidor, conservar una copia del estado actual, reemplazar `data/places.sqlite` por el snapshot elegido y copiar `backups/photos/` dentro de `data/photos/`. Reiniciar después. Los backups están en el mismo disco: protegen ante cambios accidentales, no ante pérdida de la computadora.

Las imágenes de la lista usan un contenedor sticky, a 16 px del borde inferior del viewport, limitado por su categoría. La altura real de foto y caption se mide para mantener ese margen al cambiar de tamaño.
