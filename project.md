# Paz y Tato conquistan América

Sitio personal para planear y mostrar nuestro viaje a NYC. Salida: 23 de diciembre de 2026. Prioridades: mapa útil, lugares seleccionados y una identidad gráfica inspirada en el subte de Nueva York. Cine, diseño, comida asiática y moda orientan la selección; no llenar por llenar.

## Estado y estructura

- HTML, CSS y JavaScript vanilla en `dist/`. No usamos Next.js todavía; la migración queda para más adelante. GSAP o Three.js no la requieren.
- `server.mjs`: servidor Node, API y SQLite. `images.mjs`: originales y variantes de imagen con Sharp.
- `data/places.sqlite`: datos vivos (lugares, fotos y visitados). `data/photos/`: originales ahora incluidos en Git; las variantes regenerables quedan fuera. La base viva sigue fuera de Git, pero `db/places.snapshot.sqlite` contiene la copia de traslado.
- `db/curated-places.json`: selección de referencia. `db/places.snapshot.sqlite` se importa automáticamente al iniciar si la base local está vacía o no existe; nunca reemplaza una base con lugares. `db/research-neighborhoods.md`: selección por barrios y fuentes.
- `npm run dev`: servidor local en puerto 4173, escuchando en `0.0.0.0`. En el mismo wifi se usa la IP local del equipo. No hay despliegue público.

## Lo que ya funciona

Hero con contador, mapa y listado por categorías: comida, museos/cultura, paseos y shop. Fotografías al hover en la lista, reemplazo por archivo o arrastre, marcar visitado y notas por lugar desde la card large.

Las notas son públicas para quien consulta el mapa. Agregar lugares, cambiar fotos, marcar visitados y editar notas requiere iniciar una sesión admin. La contraseña vive únicamente en `.env` como `ADMIN_PASSWORD`; el servidor entrega una cookie de sesión `HttpOnly`, sin persistencia, y vuelve a pedir acceso al cerrar el navegador o reiniciar el servidor.

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

Ajuste mobile: categorías en dos columnas; orden título → categorías → mapa → card large → agregar/créditos. Lista con 4 columnas para foto y 8 para nombres, selección por toque y controles de al menos 44 px. Popup con altura acotada y scroll interno para no salir del mapa. Pendiente revisión visual por el usuario.

Mobile compacto: Cambiar foto oculto; controles del mapa de 40 px. La altura del mapa descuenta título, categorías, agregar y créditos medidos del viewport. La card large seleccionada queda después del bloque principal; formularios abiertos y pantallas muy bajas pueden requerir scroll.

La vista mobile del mapa ahora ocupa 100svh con scroll-snap proximity (sin animación forzada), filtros y capas desplegables y cards small compactas. Los créditos permanecen visibles. Cambiar foto se oculta en mobile. Volver aparece al abrir un punto y cierra la selección para encuadrar los lugares de las categorías visibles; también funciona en desktop. La card large queda debajo del mapa en mobile.

Revisión mobile: navegación fija Inicio / Mapa / Lista (48 px); mapa ocupa el viewport restante. Categorías C/M/P/S y overlays B (barrios) / T (subtes) siempre visibles arriba, controles uniformes de 40 px. Zoom y Volver abajo; Agregar lugar con texto en una fila completa. Encuadre reserva el espacio de controles. Lista inferior sin altura mínima artificial entre links.

## Traslado a otra computadora · 27/09/2026

El repo incluye un snapshot consistente de los 40 lugares y los originales de las fotos. Después de `git pull`, ejecutar `npm install` y `npm run dev`. El servidor importa el snapshot si la base está vacía, incluyendo IDs, categorías, enlaces, fotos y visitados. Si ya hay lugares locales, los conserva y no importa encima. La otra computadora pasa a ser el servidor principal. No hace falta mantener la anterior encendida.

Esto es una copia de traslado, no sincronización continua: los cambios posteriores se guardan en la base viva y sus backups. No subir `.env`, backups ni variantes de imágenes.
