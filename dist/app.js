'use strict';
const $ = (selector) => document.querySelector(selector);
const departure = new Date('2026-12-23T00:00:00-03:00').getTime();
function updateCountdown() {
  const left = Math.max(0, departure - Date.now());
  $('#days').textContent = String(Math.floor(left / 86400000)).padStart(2, '0');
  $('#hours').textContent = String(Math.floor(left / 3600000) % 24).padStart(2, '0');
  $('#minutes').textContent = String(Math.floor(left / 60000) % 60).padStart(2, '0');
}
updateCountdown(); setInterval(updateCountdown, 1000);
const styles = getComputedStyle(document.documentElement);
const categories = {
  food: {label:'comida', letter:'c', color:styles.getPropertyValue('--food').trim(), ink:'var(--paper)'},
  culture: {label:'museos', letter:'m', color:styles.getPropertyValue('--culture').trim(), ink:'var(--ink)'},
  walk: {label:'paseos', letter:'p', color:styles.getPropertyValue('--walk').trim(), ink:'var(--paper)'}
};
const stations = [];
const categoryOrders = new Map();
const stationRows = new Map();
const stationMarkers = new Map();
function distanceBetween(a, b) {
  const radians = Math.PI / 180;
  const x = (b.point[1] - a.point[1]) * Math.cos((a.point[0] + b.point[0]) * radians / 2);
  return Math.hypot(x, b.point[0] - a.point[0]);
}
function orderCategory(key) {
  const places = stations.filter(station => station.category === key)
    .sort((a, b) => a.point[0] - b.point[0] || a.point[1] - b.point[1] || String(a.id).localeCompare(String(b.id)));
  let best = places, bestDistance = Infinity;
  // Try each starting point, then walk to the nearest remaining place.
  for (const start of places) {
    const remaining = new Set(places);
    const ordered = [start];
    remaining.delete(start);
    let distance = 0;
    while (remaining.size) {
      const current = ordered[ordered.length - 1];
      let nearest, nearestDistance = Infinity;
      for (const candidate of remaining) {
        const gap = distanceBetween(current, candidate);
        if (gap < nearestDistance) { nearest = candidate; nearestDistance = gap; }
      }
      ordered.push(nearest); remaining.delete(nearest); distance += nearestDistance;
    }
    if (distance < bestDistance) { best = ordered; bestDistance = distance; }
  }
  categoryOrders.set(key, best);
}
function stationNumber(station) {
  return (categoryOrders.get(station.category) || []).indexOf(station) + 1;
}
function stationIcon(station) {
  return L.divIcon({className:'map-station', html:String(stationNumber(station)), iconSize:[26,26], iconAnchor:[13,13]});
}
function refreshCategory(key) {
  const ordered = categoryOrders.get(key) || [];
  const group = placeGroups.get(key);
  for (const station of ordered) {
    const row = stationRows.get(station.id);
    if (row) {
      row.querySelector('.place-row-number').textContent = String(stationNumber(station));
      group.rows.append(row);
    }
    stationMarkers.get(station.id)?.setIcon(stationIcon(station));
    if (group.active === station.id) group.captionName.textContent = '(' + stationNumber(station) + ')';
  }
  const count = document.querySelector(`[data-layer="${key}"] .layer-count`);
  if (count) count.textContent = String(ordered.length).padStart(2, '0');
  updateWalkingRoute(key);
}
// Category controls share one definition with the map and link form.
for (const [key, category] of Object.entries(categories)) {
  const button = document.createElement('button');
  button.className = 'button button--category layer';
  button.dataset.layer = key;
  button.style.setProperty('--category-color', category.color);
  button.style.setProperty('--category-ink', category.ink);
  button.setAttribute('aria-pressed', 'true');
  const symbol = document.createElement('span');
  symbol.className = 'line-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = category.letter;
  const label = document.createElement('span');
  label.className = 'layer-label';
  label.textContent = category.label;
  const count = document.createElement('span');
  count.className = 'layer-count';
  count.textContent = String(stations.filter(s => s.category === key).length).padStart(2, '0');
  button.append(symbol, label, count);
  $('#layer-buttons').append(button);
  const option = document.createElement('option');
  option.value = key;
  option.textContent = category.label;
  $('#category-input').append(option);
}
function updateMapControlsAccent() {
  const category = categories[$('#category-input').value];
  if (!category) return;
  $('#add-point').style.setProperty('--category-color', category.color);
  $('#add-point').style.setProperty('--category-ink', category.ink);
}
$('#category-input').addEventListener('change', updateMapControlsAccent);
$('#link-form').addEventListener('reset', () => queueMicrotask(updateMapControlsAccent));
updateMapControlsAccent();
let map = null; const layers = {}; const routes = {};
const routeCache = new Map();
const routeVersions = {};
const routeStates = {};
let routeQueue = Promise.resolve();
let lastRouteRequest = 0;
let routesStarted = false;
function routeStatus() {
  const states = Object.values(routeStates);
  $('#route-status').textContent = states.includes('loading') ? 'calculando recorridos a pie…'
    : states.includes('error') ? 'no se pudo calcular un recorrido. los puntos siguen disponibles.' : '';
}
async function walkingGeometry(points) {
  const coordinates = points.map(([lat,lng]) => lng + ',' + lat).join(';');
  if (routeCache.has(coordinates)) return routeCache.get(coordinates);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastRouteRequest))));
  lastRouteRequest = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // The routed-foot instance uses a walking graph, independently of the URL profile label.
    const response = await fetch('https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + coordinates +
      '?overview=full&geometries=geojson&steps=false&generate_hints=false', {signal:controller.signal});
    if (!response.ok) throw new Error('routing unavailable');
    const data = await response.json();
    const geometry = data.routes?.[0]?.geometry;
    if (data.code !== 'Ok' || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) throw new Error('no walking route');
    const pointsOnStreets = geometry.coordinates.map(([lng,lat]) => [lat,lng]);
    if (pointsOnStreets.length < 2 || !pointsOnStreets.every(p => p.every(Number.isFinite))) throw new Error('invalid route');
    routeCache.set(coordinates, pointsOnStreets);
    return pointsOnStreets;
  } finally { clearTimeout(timeout); }
}
function updateWalkingRoute(key) {
  if (!map || !routesStarted) return;
  const version = (routeVersions[key] || 0) + 1;
  routeVersions[key] = version;
  const points = (categoryOrders.get(key) || []).map(s => s.point);
  routes[key].setLatLngs([]);
  if (points.length < 2) {routeStates[key] = 'ready'; routeStatus(); return;}
  routeStates[key] = 'loading'; routeStatus();
  routeQueue = routeQueue.then(async () => {
    if (routeVersions[key] !== version) return;
    try {
      const segments = [];
      // Overlap chunks by one waypoint to preserve continuity with a bounded request size.
      for (let i = 0; i < points.length - 1; i += 24) {
        if (routeVersions[key] !== version) return;
        segments.push(await walkingGeometry(points.slice(i, i + 25)));
      }
      if (routeVersions[key] !== version) return;
      routes[key].setLatLngs(segments);
      routeStates[key] = 'ready';
    } catch {
      if (routeVersions[key] === version) routeStates[key] = 'error';
    } finally { routeStatus(); }
  });
}
function mapPadding() {
  const mobile = matchMedia('(max-width:680px)').matches;
  return {paddingTopLeft: mobile ? [20,20] : [205,20],
    paddingBottomRight: mobile ? [20,20] : [30,90], maxZoom:15};
}
function fitPlaces() {
  if (!map) return;
  if (!stations.length) {map.setView([40.744,-73.986],13.5);return;}
  map.fitBounds(stations.map(s => s.point), mapPadding());
}
function showStation(station, pan = false) {
  const category = categories[station.category];
  $('.station-panel').hidden = false;
  $('.station-panel').style.background = category.color;
  $('.station-panel').style.color = category.ink;
  $('#station-category').textContent = category.label;
  $('#station-number').textContent = String(stationNumber(station)).padStart(2,'0');
  $('#station-title').textContent = station.name;
  $('#station-description').textContent = station.area;
  const link = $('#station-link'); link.hidden = false;
  link.href = station.googleMapsUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(station.name + ', New York');
  if(pan && map) {
    if (!map.hasLayer(layers[station.category])) {layers[station.category].addTo(map); document.querySelector(`[data-layer="${station.category}"]`).setAttribute('aria-pressed','true');}
    map.setView(station.point, 15, {animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});
  }
  if (matchMedia('(max-width:680px)').matches) $('.station-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
const placeGroups = new Map();
const photoRequests = new Map();
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safePhotoUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.origin);
    return url.protocol === 'https:' || (url.origin === location.origin && url.protocol === 'http:') ? url.href : null;
  } catch { return null; }
}
function loadPhoto(station) {
  if (photoRequests.has(station.id)) return photoRequests.get(station.id);
  const request = fetch(`/api/places/${encodeURIComponent(station.id)}/photo`, {headers:{accept:'application/json'}})
    .then(async response => {const result=await readApiResponse(response);if(!response.ok)throw new Error(result.error||'foto no disponible');return result;})
    .catch(error => {photoRequests.delete(station.id);throw error;});
  photoRequests.set(station.id, request);
  return request;
}
function droppedImageUrl(dataTransfer) {
  const uri=(dataTransfer.getData('text/uri-list')||'').split(/\r?\n/).find(line=>line&&!line.startsWith('#'));
  if(uri)return safePhotoUrl(uri);
  const html=dataTransfer.getData('text/html');
  if(html){const image=new DOMParser().parseFromString(html,'text/html').querySelector('img');if(image?.src)return safePhotoUrl(image.src);}
  return safePhotoUrl(dataTransfer.getData('text/plain'));
}
async function uploadPhoto(group,file,url) {
  const station=group.activeStation;if(!station)return;
  group.status.hidden=false;group.status.textContent='guardando foto…';
  try{
    const options=file
      ? {method:'PUT',headers:{'content-type':file.type},body:file}
      : {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({url})};
    const response=await fetch(`/api/places/${encodeURIComponent(station.id)}/photo`,options);
    const result=await readApiResponse(response);if(!response.ok)throw new Error(result.error||'no pudimos guardar la foto.');
    station.photoUrl=result.photoUrl;photoRequests.set(station.id,Promise.resolve(result));
    await previewPlace(station,group.activeRow,group.activeButton,true);
  }catch(error){group.status.hidden=false;group.status.textContent=error.message;}
}
async function warmPhoto(station) {
  try {const photo=await loadPhoto(station);const url=safePhotoUrl(photo.photoUrl);if(url){const image=new Image();image.src=url;}}
  catch {}
}
for (const [key, category] of Object.entries(categories)) {
  const group = element('section', 'place-group');
  group.style.setProperty('--category-color', category.color);
  group.style.setProperty('--category-ink', category.ink);
  const side = element('div', 'place-group-side');
  const heading = element('h3', 'place-group-heading');
  heading.id = 'places-' + key;
  group.setAttribute('aria-labelledby', heading.id);
  const bullet = element('span', 'place-category-letter', category.letter.toUpperCase());
  bullet.setAttribute('aria-hidden', 'true');
  heading.append(bullet, element('span', 'place-category-label text-detail', category.label));
  const figure = element('figure', 'place-photo');
  figure.hidden = true;
  const frame = element('div', 'place-photo-frame');
  const status = element('span', 'place-photo-status text-detail');
  status.setAttribute('role', 'status');
  const caption = element('figcaption', 'text-detail');
  const captionName = element('span');
  const source = element('a', '', 'fuente ↗');
  source.target = '_blank'; source.rel = 'noopener noreferrer'; source.hidden = true;
  const uploadButton=element('button','button place-photo-upload','cambiar foto');
  uploadButton.type='button';
  const fileInput=element('input','place-photo-input');
  fileInput.type='file';fileInput.accept='image/jpeg,image/png,image/webp,image/gif';fileInput.hidden=true;
  caption.append(captionName, uploadButton, source, fileInput);
  frame.append(status); figure.append(frame, caption); side.append(heading, figure);
  const rows = element('ol', 'place-rows');
  const empty = element('li', 'place-group-empty text-detail', 'sin lugares todavía.');
  rows.append(empty); group.append(side, rows); $('#station-list').append(group);
  const groupState={rows,empty,figure,frame,status,captionName,source,uploadButton,fileInput,active:null,activeStation:null,activeRow:null,activeButton:null,image:null};
  placeGroups.set(key,groupState);
  uploadButton.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',()=>{const file=fileInput.files?.[0];if(file)uploadPhoto(groupState,file,null);fileInput.value='';});
  frame.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  frame.addEventListener('dragenter',event=>{event.preventDefault();frame.classList.add('is-drop-target');status.hidden=false;status.textContent='soltá para reemplazar';});
  frame.addEventListener('dragleave',event=>{if(event.relatedTarget&&frame.contains(event.relatedTarget))return;frame.classList.remove('is-drop-target');status.hidden=Boolean(groupState.image);});
  frame.addEventListener('drop',event=>{
    event.preventDefault();frame.classList.remove('is-drop-target');
    const file=[...(event.dataTransfer.files||[])].find(item=>item.type.startsWith('image/'));
    const url=file?null:droppedImageUrl(event.dataTransfer);
    if(file||url)uploadPhoto(groupState,file,url);else{status.hidden=false;status.textContent='no encontramos una imagen';}
  });
}
async function previewPlace(station, row, button, force = false) {
  const group = placeGroups.get(station.category);
  if (group.active === station.id && !force) return;
  group.active = station.id;
  group.activeStation=station;group.activeRow=row;group.activeButton=button;
  for (const item of group.rows.children) {
    item.classList.toggle('is-active', item === row);
    item.querySelector('button')?.setAttribute('aria-pressed', String(item === row));
  }
  group.image?.remove(); group.image = null;
  group.figure.hidden = false;
  group.captionName.textContent = '(' + String(stationNumber(station)) + ')';
  group.source.hidden = true;
  group.status.hidden = false;
  group.status.textContent = 'cargando foto…';
  let photo;
  try{
    photo=await loadPhoto(station);
  }catch(error){
    const fallback=safePhotoUrl(station.photoUrl);
    if(!fallback){group.status.textContent=error.message;return;}
    photo={photoUrl:fallback,sourceUrl:station.photoSourceUrl||station.sourceUrl,author:null};
  }
  if(group.active!==station.id)return;
  const url=safePhotoUrl(photo.photoUrl);if(!url){group.status.textContent='foto no disponible';return;}
  const image = new Image();
  group.image = image;
  image.alt = station.name; image.decoding = 'async'; image.hidden = true;
  image.onload = () => {
    if (group.image !== image) return;
    image.hidden = false; group.status.hidden = true;
  };
  image.onerror = () => {
    if (group.image !== image) return;
    image.remove(); group.status.textContent = 'foto no disponible';
  };
  group.frame.prepend(image); image.src = url;
}
function addStationToList(station) {
  const group = placeGroups.get(station.category);
  if (!group) return;
  group.empty.remove();
  const row = element('li', 'place-row');
  const button = element('button', 'button button--row place-row-button');
  button.type = 'button'; button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'ver foto de ' + station.name);
  button.append(element('span', 'place-row-name', station.name), element('span', 'place-row-number', String(stationNumber(station))));
  const activate = () => previewPlace(station, row, button);
  button.addEventListener('pointerenter', activate);
  button.addEventListener('focus', activate);
  button.addEventListener('click', activate);
  row.append(button); group.rows.append(row);
  stationRows.set(station.id, row);
  if (group.active === null) activate();
}
for (const station of stations) addStationToList(station);
function addStationToMap(station){
  if(!map||!layers[station.category])return;
  const marker=L.marker(station.point,{title:station.name,alt:station.name,icon:stationIcon(station)}).addTo(layers[station.category]);
  stationMarkers.set(station.id, marker);
  marker.bindTooltip(station.name,{direction:'top'});marker.on('click',()=>showStation(station));
}
if (window.L) {
  $('#map-fallback').remove();
  map = L.map('map',{zoomControl:false,scrollWheelZoom:true,touchZoom:true,zoomSnap:.25,zoomDelta:.5,wheelPxPerZoomLevel:100}).setView([40.744,-73.986],13.5);
  const zoomControl = L.control.zoom({zoomInTitle:'acercar',zoomOutTitle:'alejar',zoomInText:'+',zoomOutText:'−'}).addTo(map);
  $('#map-zoom').append(zoomControl.getContainer());
  for (const control of zoomControl.getContainer().querySelectorAll('a')) control.classList.add('button','button--icon');
  map.attributionControl.setPrefix(false);
  $('#map-credits').append(map.attributionControl.getContainer());
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://routing.openstreetmap.de/about.html">FOSSGIS routing</a> · <a href="https://www.openstreetmap.org/fixthemap">corregir mapa</a>'}).addTo(map);
  let errors = 0;
  tiles.on('tileerror',()=>{if(++errors===4) notify('el mapa está tardando. podés explorar las paradas en la lista.');});
  for (const [key,category] of Object.entries(categories)) {
    const group = L.layerGroup().addTo(map); layers[key]=group;
    const points = stations.filter(s=>s.category===key);
    routes[key]=L.polyline([],{color:category.color,weight:5,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(group);
    for(const station of points) addStationToMap(station);
  }
  // Start closer; the center follows the full collection, including future northern points.
  if (stations.length) map.setView(L.latLngBounds(stations.map(s => s.point)).getCenter(), 13.5);
  $('#reset-map').addEventListener('click',fitPlaces);
  const observer = new ResizeObserver(() => map.invalidateSize({pan:false}));
  observer.observe($('#map'));
  const routeObserver = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    routesStarted = true;
    for (const key of Object.keys(categories)) updateWalkingRoute(key);
    routeObserver.disconnect();
  });
  routeObserver.observe($('#map'));
  for(const button of document.querySelectorAll('[data-layer]')) button.addEventListener('click',()=>{const group=layers[button.dataset.layer];const active=map.hasLayer(group);if(active)map.removeLayer(group);else group.addTo(map);button.setAttribute('aria-pressed',String(!active));});
} else {
  $('#map-fallback').textContent='no pudimos cargar el mapa. abajo están todas las paradas en una lista.';
  for(const button of document.querySelectorAll('[data-layer], #reset-map')) button.disabled=true;
  $('.station-index').open=true;
}
let toastTimer;
function notify(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
const emptyMarkup=$('#link-items').innerHTML;
function renderLinks(){
  $('#link-count').textContent=String(stations.length).padStart(2,'0');
  $('#link-items').replaceChildren();if(!stations.length){$('#link-items').innerHTML=emptyMarkup;return;}
  for(const station of stations){
    const row=document.createElement('div');row.className='saved-link';const category=categories[station.category];
    row.style.setProperty('--category-color',category.color);
    row.style.setProperty('--category-ink',category.ink);
    const symbol=document.createElement('span');symbol.className='line-symbol';symbol.style.background=category.color;symbol.style.color=category.ink;symbol.textContent=category.letter;
    const anchor=document.createElement('a');anchor.href=station.sourceUrl;anchor.target='_blank';anchor.rel='noopener noreferrer';
    const title=document.createElement('strong');title.textContent=station.name+' ↗';const detail=document.createElement('small');detail.textContent=category.label;anchor.append(title,detail);
    row.append(symbol,anchor);$('#link-items').append(row);
  }
}
renderLinks();
async function readApiResponse(response){
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))throw new Error('el servidor actual no tiene activa la base de datos. reinicialo con npm run dev.');
  return response.json();
}
async function loadPlaces(){
  try{
    const response=await fetch('/api/places',{headers:{accept:'application/json'}});if(!response.ok)throw new Error();
    const data=await readApiResponse(response);stations.push(...data.places);
    for(const key of Object.keys(categories)) {
      orderCategory(key);
      for(const station of categoryOrders.get(key)){addStationToList(station);addStationToMap(station);}
      refreshCategory(key);
    }
    renderLinks();fitPlaces();setTimeout(()=>stations.forEach(warmPhoto),0);
  }catch(error){$('#form-error').textContent=error.message||'la base de datos no está disponible. reiniciá el proyecto con npm run dev.';}
}
$('#link-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);const url=String(form.get('url')).trim();const category=String(form.get('category'));
  const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='agregando…';$('#form-error').textContent='';
  try{
    const response=await fetch('/api/places',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({url,category})});
    const result=await readApiResponse(response);if(!response.ok)throw new Error(result.error||'no pudimos agregar el lugar.');
    stations.push(result.place);orderCategory(result.place.category);addStationToList(result.place);addStationToMap(result.place);refreshCategory(result.place.category);renderLinks();showStation(result.place,true);warmPhoto(result.place);$('#link-form').reset();notify('lugar guardado.');
  }catch(error){$('#form-error').textContent=error.message;}
  finally{submit.disabled=false;submit.textContent='agregar';}
});
loadPlaces();
