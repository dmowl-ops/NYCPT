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
  food: {label:'Comida', letter:'c', color:styles.getPropertyValue('--food').trim(), ink:'var(--paper)'},
  culture: {label:'Museos', letter:'m', color:styles.getPropertyValue('--culture').trim(), ink:'var(--ink)'},
  walk: {label:'Paseos', letter:'p', color:styles.getPropertyValue('--walk').trim(), ink:'var(--paper)'},
  shop: {label:'Shop', letter:'s', color:styles.getPropertyValue('--subway-green').trim(), ink:'var(--paper)'}
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
  const category = categories[station.category];
  const badge = document.createElement('span');
  badge.className = 'map-station-badge';
  badge.style.background = category.color;
  badge.style.color = category.ink;
  badge.textContent = String(stationNumber(station));
  const size=[34,30,28][zoomLevel], hit=[48,44,40][zoomLevel];
  badge.style.width=badge.style.height=size+'px';
  return L.divIcon({className:'map-station' + (station.visited ? ' is-visited' : ''), html:badge, iconSize:[hit,hit], iconAnchor:[hit/2,hit/2]});
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
let map = null; let baseMap = null; let selectedStation = null; const layers = {};
let mapBaseReady=false, mapDataReady=false;
function revealMap() {
  if (!mapBaseReady || !mapDataReady) return;
  const reveal=()=>{ $('.map-viewport').classList.remove('is-loading');$('.map-viewport').setAttribute('aria-busy','false'); };
  if(map?._animatingZoom || map?._flyToFrame) {
    map.once('moveend',reveal);
    setTimeout(reveal,650);
  } else requestAnimationFrame(()=>requestAnimationFrame(reveal));
}
function mapPadding() {
  const controls = $('.map-bottom');
  const controlHeight = controls?.getBoundingClientRect().height || 50;
  const bottomInset = controls ? parseFloat(getComputedStyle(controls).bottom) || 16 : 16;
  const margin = 40;
  return {paddingTopLeft:[margin,matchMedia('(max-width: 680px)').matches ? 108 : margin], paddingBottomRight:[margin,controlHeight + bottomInset + margin], maxZoom:15};
}
let overviewZoom = 13;
let zoomLevel = 0;
const detailZooms = [14.5,18];
function moveMap(center, zoom, animate = true) {
  map.stop();
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    map.flyTo(center,zoom,{duration:.45,easeLinearity:.2});
  } else map.setView(center,zoom,{animate:false});
}
function updateZoomControls() {
  for(const station of stations) stationMarkers.get(station.id)?.setIcon(stationIcon(station));
  $('#zoom-in').disabled = zoomLevel === 2;
  $('#zoom-out').disabled = zoomLevel === 0;
  $('#map-zoom').setAttribute('aria-label','Zoom: '+['General','Calles','Manzana'][zoomLevel]);
}
function changeZoom(direction) {
  const next = Math.max(0,Math.min(2,zoomLevel+direction));
  if(next===zoomLevel) return;
  zoomLevel=next;updateZoomControls();
  moveMap(selectedStation?.point || map.getCenter(),next===0 ? overviewZoom : detailZooms[next-1]);
}
function fitOverview(bounds, maxZoom = 18) {
  const padding=mapPadding();
  const fittedZoom=Math.max(map.getMinZoom(),Math.min(maxZoom,map.getBoundsZoom(bounds,false,L.point(padding.paddingTopLeft).add(padding.paddingBottomRight))));
  overviewZoom=Math.min(13,fittedZoom);
  const projectedCenter=map.project(bounds.getSouthWest(),fittedZoom).add(map.project(bounds.getNorthEast(),fittedZoom)).divideBy(2);
  const center=projectedCenter.add(L.point(padding.paddingBottomRight).subtract(padding.paddingTopLeft).divideBy(2));
  zoomLevel=fittedZoom>=17 ? 2 : fittedZoom>=detailZooms[0] ? 1 : 0;
  updateZoomControls();
  moveMap(map.unproject(center,fittedZoom),fittedZoom);
}
function visibleStations() {
  return stations.filter(station=>layers[station.category] && map.hasLayer(layers[station.category]));
}
function fitPlaces() {
  if (!map) return;
  const visible=visibleStations();
  if (!visible.length) return;
  fitOverview(L.latLngBounds(visible.map(s=>s.point)));
}
function selectCategory(key) {
  for(const [category,group] of Object.entries(layers)) {
    const active=key===null || category===key;
    if(active)group.addTo(map);else map.removeLayer(group);
    document.querySelector(`[data-layer="${category}"]`).setAttribute('aria-pressed',String(active));
  }
}
const pendingVisits = new Set();
function updateVisitButton(button, station) {
  button.dataset.visitId = station.id;
  const symbol=element('span','ui-symbol',station.visited ? '−' : '+');
  symbol.setAttribute('aria-hidden','true');
  button.replaceChildren(element('span','',station.visited ? 'Visitado' : 'Marcar visitado'),symbol);
  button.setAttribute('aria-pressed', String(Boolean(station.visited)));
  button.setAttribute('aria-label', (station.visited ? 'Desmarcar visitado: ' : 'Marcar visitado: ') + station.name);
  button.disabled = pendingVisits.has(station.id);
}
function syncVisited(station) {
  for (const button of document.querySelectorAll('[data-visit-id]')) {
    if (button.dataset.visitId === station.id) updateVisitButton(button, station);
  }
  stationRows.get(station.id)?.classList.toggle('is-visited', Boolean(station.visited));
  stationMarkers.get(station.id)?.setIcon(stationIcon(station));
}
async function toggleVisited(station) {
  if (!station || pendingVisits.has(station.id)) return;
  pendingVisits.add(station.id); syncVisited(station);
  try {
    const response = await fetch(`/api/places/${encodeURIComponent(station.id)}/visited`, {
      method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({visited:!station.visited})
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error || 'No pudimos guardar el cambio.');
    station.visited = result.visited;
  } catch (error) {notify(error.message);}
  finally {pendingVisits.delete(station.id); syncVisited(station);}
}
function nearestStreet(station) {
  if (!baseMap?.isStyleLoaded()) return '';
  let features;
  try {features=baseMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation_name'});} catch {return '';}
  const [lat,lng]=station.point, scale=Math.cos(lat*Math.PI/180);
  let nearest='',best=60;
  for (const feature of features) {
    const name=feature.properties?.['name:en'] || feature.properties?.name;
    if (!name) continue;
    const lines=feature.geometry.type==='LineString' ? [feature.geometry.coordinates] : feature.geometry.type==='MultiLineString' ? feature.geometry.coordinates : [];
    for (const line of lines) for (let i=1;i<line.length;i++) {
      const a=[(line[i-1][0]-lng)*scale*111320,(line[i-1][1]-lat)*111320];
      const b=[(line[i][0]-lng)*scale*111320,(line[i][1]-lat)*111320];
      const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
      const t=length ? Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/length)) : 0;
      const distance=Math.hypot(a[0]+t*dx,a[1]+t*dy);
      if (distance<best) {best=distance;nearest=name;}
    }
  }
  return nearest;
}
function updateStationTooltip(station) {
  const marker=stationMarkers.get(station.id);
  if (!marker || selectedStation!==station) return;
  const address=marker.getPopup()?.getContent()?.querySelector('.place-card-address');
  if (!address) return;
  const area=(station.area || '').trim();
  const street=nearestStreet(station);
  const hasStreet=/\d|\b(?:avenue|ave|street|st|broadway)\b/i.test(area);
  address.textContent=sentenceCase(hasStreet ? area : street ? 'Cerca de '+street : area || 'Dirección no disponible');
  if($('.station-panel').dataset.stationId===station.id) {
    const sidebarAddress=$('.station-panel .place-card-address');
    if(sidebarAddress)sidebarAddress.textContent=address.textContent;
  }
}
function setOverlayBusy(button,busy) {
  button.disabled=busy;
  if(busy)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');
}
function setOverlayActive(button,active) {
  button.setAttribute('aria-pressed',String(active));
  button.querySelector('.ui-symbol').textContent=active ? '−' : '+';
}
function sentenceCase(value) {
  const text=String(value || '');return text ? text[0].toLocaleUpperCase('es')+text.slice(1) : text;
}
function bindMapTooltip(layer, text, variant = 'default', options = {}) {
  const label=document.createElement('span');label.textContent=sentenceCase(text);
  layer.bindTooltip(label,{direction:'top',opacity:1,className:'map-tooltip map-tooltip--'+variant,...options});
}
// One presentational card, with content and surface variants for all map entities.
function externalArrow() {
  const arrow=element('span','ui-symbol ui-arrow','↗');
  arrow.setAttribute('aria-hidden','true');return arrow;
}
function placeInsideNeighborhood(station,geometry) {
  const [lat,lng]=station.point;
  function insideRing(ring) {
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const [x,y]=ring[i],[px,py]=ring[j];
      if((y>lat)!==(py>lat) && lng<(px-x)*(lat-y)/(py-y)+x)inside=!inside;
    }
    return inside;
  }
  const polygons=geometry.type==='Polygon' ? [geometry.coordinates] : geometry.type==='MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(rings=>insideRing(rings[0]) && !rings.slice(1).some(insideRing));
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-map-place]');
  if(!button)return;
  const station=stations.find(item=>item.id===button.dataset.mapPlace);
  if(station){event.preventDefault();showStation(station,true);}
});
function createMapCard({name,variant='subway',badges=[],details=[],action,color='#e9e9e9',ink='var(--ink)'}) {
  const card=element('article','map-card map-card--small map-card--'+variant);
  card.style.setProperty('--category-color',color);
  card.style.setProperty('--category-ink',ink);
  const heading=element('header','map-card-heading');
  heading.append(element('h3','',sentenceCase(name)));card.append(heading);
  if(badges.length) {
    const row=element('div','map-card-badges');
    for(const {label,color='var(--ink)',ink='var(--paper)'} of badges) {
      const badge=element('span','route-bullet',label);
      badge.style.background=color;badge.style.color=ink;row.append(badge);
    }
    if(variant==='place')heading.prepend(row);else card.append(row);
  }
  for(const {text='',className=''} of details) card.append(element('p','text-detail '+className,sentenceCase(text)));
  if(action) {
    const actions=element('footer','map-card-actions');
    const link=element('a','button button--control button--solid card-action card-cta');
    link.append(element('span','',action.label),externalArrow());
    link.href=action.href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);card.append(actions);
  }
  return card;
}
function bindCardPopup(layer,card,{variant='subway',autoPan=true}={}) {
  layer.bindPopup(card,{className:'map-popup map-popup--'+variant,maxWidth:matchMedia('(max-width: 680px)').matches ? Math.min(240,map.getSize().x-48) : 300,minWidth:160,autoPan,closeButton:false,closeOnClick:true});
}
function showSidebarCard(card, {color='var(--paper)',ink='var(--ink)',station=null} = {}) {
  const panel=$('.station-panel');
  panel.style.background=color;panel.style.color=ink;
  const expandedCard=card.cloneNode(true);
  expandedCard.classList.replace('map-card--small','map-card--large');
  panel.replaceChildren(expandedCard);
  panel.hidden=false;
  panel.dataset.stationId=station?.id || '';
  if(station) {
    const visited=element('button','button button--control card-action card-action--secondary visit-toggle');
    visited.type='button';updateVisitButton(visited,station);
    visited.addEventListener('click',()=>toggleVisited(station));
    panel.querySelector('.map-card-actions').prepend(visited);
  }
}
function bindStationTooltip(station) {
  const marker=stationMarkers.get(station.id);
  if(marker)bindMapTooltip(marker,station.name,'place',{offset:[0,-20]});
}
function clearSelectedStation() {
  if (selectedStation) stationMarkers.get(selectedStation.id)?.closePopup();
  selectedStation=null;
}
function focusStation(station) {
  clearSelectedStation();
  selectedStation=station;
  const marker=stationMarkers.get(station.id);
  const category=categories[station.category];
  const card=createMapCard({
    name:station.name,variant:'place',color:category.color,ink:category.ink,badges:[{label:category.letter}],
    details:[{className:'place-card-address'}],
    action:{label:'Ver lugar',href:station.googleMapsUrl || 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(station.point.join(','))}
  });
  marker.unbindPopup();
  bindCardPopup(marker,card,{variant:'place',autoPan:false});
  zoomLevel=2;updateZoomControls();
  // Keep space above the badge for the card and below it for the controls.
  const target=map.project(station.point,18).subtract([0,80]);
  moveMap(map.unproject(target,18),18);
  marker.openPopup();marker.closeTooltip();
  const popup=marker.getPopup().getElement();
  popup.style.setProperty('--place-color',category.color);
  popup.style.setProperty('--place-ink',category.ink);
  updateStationTooltip(station);
  showSidebarCard(card,{color:category.color,ink:category.ink,station});
}
function showStation(station, pan = false) {
  if(pan && map) {
    if (!map.hasLayer(layers[station.category])) selectCategory(station.category);
    focusStation(station);
  }

}
const placeGroups = new Map();
const photoRequests = new Map();
const photoSizeObserver = new ResizeObserver(entries => {
  for(const {target} of entries) {
    const height=target.getBoundingClientRect().height;
    if(height)target.style.setProperty('--photo-height',height+'px');
  }
});
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
function setPhotoSource(image, url) {
  if (url.startsWith('/photos/')) {
    const widths = [160, 320, 480, 640, 960, 1280, 1920];
    image.sizes = '(max-width: 680px) calc(33.333vw - 22px), calc(25vw - 20px)';
    image.srcset = widths.map(width => `${url}?w=${width} ${width}w`).join(', ');
    image.src = `${url}?w=640`;
  } else image.src = url;
}
async function warmPhoto(station) {
  try {const photo=await loadPhoto(station);const url=safePhotoUrl(photo.photoUrl);if(url){const image=new Image();setPhotoSource(image,url);}}
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
  photoSizeObserver.observe(figure);
  const frame = element('div', 'place-photo-frame');
  const status = element('span', 'place-photo-status text-detail');
  status.setAttribute('role', 'status');
  const caption = element('figcaption', 'text-detail');
  const captionName = element('span');
  const source = element('a', '', 'fuente ');source.append(externalArrow());
  source.target = '_blank'; source.rel = 'noopener noreferrer'; source.hidden = true;
  const uploadButton=element('button','button button--text place-photo-upload','Cambiar foto');
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
  group.frame.prepend(image); setPhotoSource(image,url);
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
  button.addEventListener('pointerenter', event => {if(event.pointerType !== 'touch')activate();});
  button.addEventListener('focus', activate);
  button.addEventListener('click', activate);
  row.append(button); group.rows.append(row);
  stationRows.set(station.id, row);
  row.classList.toggle('is-visited', Boolean(station.visited));
  if (group.active === null) activate();
}
for (const station of stations) addStationToList(station);
function addStationToMap(station){
  if(!map||!layers[station.category])return;
  const marker=L.marker(station.point,{title:station.name,alt:station.name,icon:stationIcon(station)}).addTo(layers[station.category]);
  stationMarkers.set(station.id, marker);
  bindStationTooltip(station);marker.on('click',()=>showStation(station,true));
}
if (window.L) {
  $('#map-fallback').remove();
  map = L.map('map',{zoomControl:false,scrollWheelZoom:false,touchZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomSnap:0,minZoom:10,maxZoom:18}).setView([40.744,-73.986],13);
  $('#map-zoom').innerHTML='<div class="leaflet-control-zoom"><button id="zoom-in" class="button button--icon button--solid" aria-label="Acercar">+</button><button id="zoom-out" class="button button--icon button--solid" aria-label="Alejar">−</button></div>';
  $('#zoom-in').addEventListener('click',()=>changeZoom(1));
  $('#zoom-out').addEventListener('click',()=>changeZoom(-1));
  updateZoomControls();
  let wheelTotal=0,wheelTime=0,wheelLast=0;
  map.getContainer().addEventListener('wheel',event=>{
    event.preventDefault();
    const now=performance.now();
    if(now-wheelLast>180) wheelTotal=0;
    wheelLast=now;
    if(now-wheelTime<650) return;
    wheelTotal+=event.deltaY*(event.deltaMode===1 ? 16 : 1);
    if(Math.abs(wheelTotal)<35) return;
    changeZoom(wheelTotal<0 ? 1 : -1);wheelTotal=0;wheelTime=now;
  },{passive:false});
  map.on('dblclick',()=>changeZoom(1));
  let pinchStart=0,pinchEnd=0;
  const touchDistance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
  map.getContainer().addEventListener('touchstart',event=>{if(event.touches.length===2) pinchStart=pinchEnd=touchDistance(event.touches);},{passive:true});
  map.getContainer().addEventListener('touchmove',event=>{if(event.touches.length===2){event.preventDefault();pinchEnd=touchDistance(event.touches);}},{passive:false});
  map.getContainer().addEventListener('touchend',()=>{if(pinchStart && Math.abs(pinchEnd-pinchStart)>30)changeZoom(pinchEnd>pinchStart ? 1 : -1);pinchStart=0;},{passive:true});
  // A non-interactive locator: broad context plus the main map's visible bounds.
  const locator=element('div','map-minimap');
  locator.hidden=true;locator.setAttribute('aria-label','Ubicación de la vista actual');
  $('.map-viewport').append(locator);
  let miniMap=null,miniBounds=null;
  function updateMinimap() {
    locator.hidden=zoomLevel===0;
    if(locator.hidden)return;
    if(!miniMap) {
      miniMap=L.map(locator,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,touchZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomSnap:0});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{className:'map-fallback-tiles',maxZoom:18}).addTo(miniMap);
      miniBounds=L.rectangle(map.getBounds(),{color:'#000',weight:2,fillColor:'#000',fillOpacity:.12,interactive:false}).addTo(miniMap);
    }
    miniMap.invalidateSize({pan:false});
    miniMap.setView(map.getCenter(),Math.min(12,map.getZoom()-3),{animate:false});
    miniBounds.setBounds(map.getBounds());
  }
  map.on('moveend resize',updateMinimap);
  map.attributionControl.setPrefix(false);
  $('#map-credits').append(map.attributionControl.getContainer());
  let usingFallback=!(L.maplibreGL && window.maplibregl);
  const fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{className:'map-fallback-tiles',maxZoom:18,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  fallback.on('load',()=>{if(usingFallback){mapBaseReady=true;revealMap();}});
  if (L.maplibreGL && window.maplibregl) {
    let baseLayer,loadTimeout,errorCount=0,failed=false;
    const restoreFallback=()=>{
      if(failed)return;failed=true;usingFallback=true;clearTimeout(loadTimeout);
      baseMap=null;if(baseLayer && map.hasLayer(baseLayer))map.removeLayer(baseLayer);
      if(!map.hasLayer(fallback))fallback.addTo(map);
      if(!fallback.isLoading()){mapBaseReady=true;revealMap();}
    };
    try {
      baseLayer=L.maplibreGL({style:'/data/map-style.json',interactive:false,attributionControl:false}).addTo(map);
      baseMap=baseLayer.getMaplibreMap();
      loadTimeout=setTimeout(restoreFallback,12000);
      map.attributionControl.addAttribution('<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
      baseMap.on('idle',()=>{if(failed)return;clearTimeout(loadTimeout);errorCount=0;mapBaseReady=true;revealMap();if(map.hasLayer(fallback))map.removeLayer(fallback);if(selectedStation)updateStationTooltip(selectedStation);});
      baseMap.on('error',()=>{if(++errorCount>=3)restoreFallback();});
      baseMap.getCanvas().addEventListener('webglcontextlost',restoreFallback);
    } catch {restoreFallback();}
  }
  for (const [key,category] of Object.entries(categories)) {
    const group = L.layerGroup().addTo(map); layers[key]=group;
    const points = stations.filter(s=>s.category===key);
    for(const station of points) addStationToMap(station);
  }
  // Start closer; the center follows the full collection, including future northern points.

  // Every overlay registers its presentation for General, Calles and Manzana here.
  const overlayZoomRules = new Map();
  const updateOverlaysForZoom = () => {for(const update of overlayZoomRules.values())update(zoomLevel);};
  map.on('zoomstart zoomend',updateOverlaysForZoom);
  const subwayPane = map.createPane('subway');
  subwayPane.style.zIndex = '450';
  subwayPane.classList.add('map-overlay-pane');
  const subwayButton = $('#toggle-subway');
  let subway = null;
  function updateSubwayDetail() {
    if(!subway)return;
    subway.eachLayer(layer=>{
      if(layer.feature.geometry.type==='Point') {
        layer.setRadius([6,5,6][zoomLevel]);
        layer.setStyle({opacity:1,fillOpacity:1,weight:2});
        const tooltip=layer.getTooltip();
        if(tooltip) tooltip.options.permanent=zoomLevel===2;
        if(zoomLevel===2 && map.hasLayer(subway))layer.openTooltip();else layer.closeTooltip();
      } else layer.setStyle({weight:[4,4,5][zoomLevel],opacity:[.85,.9,.95][zoomLevel]});
    });
  }
  overlayZoomRules.set('subway',updateSubwayDetail);

  subwayButton.addEventListener('click', async () => {
    setOverlayBusy(subwayButton,true);
    try {
      if (!subway) {
        const response = await fetch('/data/subway.geojson');
        if (!response.ok) throw new Error('No pudimos cargar los subtes.');
        const data = await response.json();
        const serviceColors = new Map(data.features.filter(feature => feature.properties.color).map(feature => [feature.properties.service, feature.properties.color]));
        subway = L.geoJSON(data, {
          pane:'subway', interactive:false, smoothFactor:2,
          attribution:'Subtes: <a href="https://data.ny.gov/Transportation/MTA-Subway-Service-Lines/s692-irgq">MTA</a>',
          style:feature => ({color:feature.properties.color,weight:3,opacity:.85}),
          pointToLayer:(_feature, latlng) => L.circleMarker(latlng, {pane:'subway',interactive:true,radius:4,color:'#000',weight:1.5,fillColor:'#fff',fillOpacity:1}),
          onEachFeature(feature, layer) {
            if (feature.geometry.type !== 'Point') return;
            bindMapTooltip(layer,feature.properties.name+' · '+feature.properties.service,'subway');
            const [lng,lat] = feature.geometry.coordinates;
            const card=createMapCard({
              name:feature.properties.name,
              badges:feature.properties.service.split(/\s+/).filter(Boolean).map(service=>({
                label:service,color:serviceColors.get(service)||serviceColors.get(service[0])||'#808183',
                ink:/^[NQRWL]/.test(service) ? 'var(--ink)' : 'var(--paper)'
              })),
              details:[{className:'station-card-address'}],
              action:{label:'Ver ubicación',href:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lng)}
            });
            const street=card.querySelector('.station-card-address');
            bindCardPopup(layer,card);
            layer.on('click', () => {
              clearSelectedStation();
              zoomLevel=2;updateZoomControls();moveMap([lat,lng],18);
              const road = nearestStreet({point:[lat,lng]});
              street.textContent = road ? 'Cerca de '+road : '';
              street.hidden = !road;
              layer.closeTooltip();layer.openPopup();
              showSidebarCard(card);
            });

          }
        });
      }
      const active = !map.hasLayer(subway);
      if (active) subway.addTo(map); else {map.closePopup();map.removeLayer(subway);}
      updateSubwayDetail();
      setOverlayActive(subwayButton,active);
    } catch (error) {notify(error.message);}
    finally {setOverlayBusy(subwayButton,false);}
  });
  map.on('click',clearSelectedStation);
  const closeHint=element('span','map-tooltip close-map-hint','Cerrar');
  closeHint.hidden=true;closeHint.setAttribute('aria-hidden','true');
  $('.map-viewport').append(closeHint);
  let popupIsOpen=false;
  map.on('popupopen',()=>{popupIsOpen=true;});
  map.on('popupclose',()=>{popupIsOpen=false;closeHint.hidden=true;});
  map.getContainer().addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const overControl=event.target.closest('.leaflet-popup, .leaflet-interactive, .leaflet-marker-icon');
    closeHint.hidden=!popupIsOpen || Boolean(overControl);
    if(closeHint.hidden)return;
    const frame=$('.map-viewport').getBoundingClientRect();
    closeHint.style.left=Math.max(8,Math.min(event.clientX-frame.left+12,frame.width-closeHint.offsetWidth-8))+'px';
    closeHint.style.top=Math.max(8,Math.min(event.clientY-frame.top+12,frame.height-closeHint.offsetHeight-8))+'px';
  });
  map.getContainer().addEventListener('pointerleave',()=>{closeHint.hidden=true;});

  const neighborhoodButton = $('#toggle-neighborhoods');
  const neighborhoodPane = map.createPane('neighborhoods');
  neighborhoodPane.style.zIndex = '350';
  neighborhoodPane.classList.add('map-overlay-pane');
  let neighborhoods = null;
  let neighborhoodRequest = null;
  const neighborhoodStyle = () => ({
    color:'#555555',
    weight:zoomLevel===0 ? 3.5 : 4,
    opacity:1,
    fillOpacity:zoomLevel===0 ? .08 : .03
  });
  function updateNeighborhoodDetail() {
    neighborhoodPane.classList.toggle('is-zoom-hidden',zoomLevel===2);
    if(!neighborhoods)return;
    neighborhoods.eachLayer(layer=>{
      layer.setStyle(neighborhoodStyle());
      if(zoomLevel===2){layer.closeTooltip();layer.closePopup();}
    });
  }
  overlayZoomRules.set('neighborhoods',updateNeighborhoodDetail);

  async function loadNeighborhoods() {
    if (neighborhoods) return neighborhoods;
    if (!neighborhoodRequest) neighborhoodRequest = (async () => {
      const response = await fetch('/data/neighborhoods.geojson');
      if (!response.ok) throw new Error('No pudimos cargar los barrios.');
      const data = await response.json();
      const color = '#555555';
      neighborhoods = L.geoJSON(data, {
        pane:'neighborhoods', smoothFactor:2,
        attribution:'Barrios (NTA): <a href="https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs/9nt8-h7nd">NYC Open Data</a>',
        style:neighborhoodStyle,
        onEachFeature(feature, layer) {
          const shortName=feature.properties.label || feature.properties.name;
          bindMapTooltip(layer,shortName,'neighborhood',{sticky:true});
          layer.on('mouseover', () => {layer.setStyle({color:styles.getPropertyValue('--ink').trim(),fillColor:color,fillOpacity:.25,weight:4,opacity:1});layer.bringToFront();});
          layer.on('mouseout', () => neighborhoods.resetStyle(layer));
          layer.on('tooltipopen',()=>{if(layer.isPopupOpen())layer.closeTooltip();});
          layer.on('click', event => {
            const places=stations.filter(station=>placeInsideNeighborhood(station,feature.geometry));
            const card=createMapCard({
              name:shortName,variant:'neighborhood',
              details:[],
              action:{label:'Ver zona',href:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(shortName+', Manhattan, New York')}
            });
            const list=element('div','neighborhood-places');
            list.append(element('p','text-detail',places.length ? 'Lugares guardados ('+places.length+')' : 'Todavía no guardaron lugares acá.'));
            for(const station of places) {
              const button=element('button','button button--text neighborhood-place',station.name+' ');button.append(externalArrow());
              button.type='button';button.dataset.mapPlace=station.id;
              button.style.setProperty('--category-color',categories[station.category].color);
              button.style.setProperty('--category-ink',categories[station.category].ink);
              list.append(button);
            }
            card.insertBefore(list,card.querySelector('.map-card-actions'));
            layer.unbindPopup();bindCardPopup(layer,card,{variant:'neighborhood',autoPan:false});
            layer.closeTooltip();layer.openPopup(event.latlng);
            showSidebarCard(card,{color:'#e9e9e9'});
          });
        }
      });
      return neighborhoods;
    })().catch(error => {neighborhoodRequest=null;throw error;});
    return neighborhoodRequest;
  }
  neighborhoodButton.addEventListener('click',async()=>{
    setOverlayBusy(neighborhoodButton,true);
    try {
      await loadNeighborhoods();
      const active=!map.hasLayer(neighborhoods);
      if(active)neighborhoods.addTo(map);else map.removeLayer(neighborhoods);
      updateNeighborhoodDetail();
      setOverlayActive(neighborhoodButton,active);
    } catch(error){notify(error.message);}
    finally{setOverlayBusy(neighborhoodButton,false);}
  });
  const backButton=element('button','button button--control button--solid map-return');
  backButton.type='button';backButton.setAttribute('aria-label','Volver a los lugares visibles');
  const backArrow=element('span','ui-symbol','←');backArrow.setAttribute('aria-hidden','true');
  backButton.append(backArrow,element('span','','Volver'));
  backButton.hidden=true;
  $('.map-viewport').append(backButton);
  function returnToPlaces(){
    clearSelectedStation();map.closePopup();$('.station-panel').hidden=true;fitPlaces();
    backButton.hidden=true;
  }
  backButton.addEventListener('click',returnToPlaces);
  $('#reset-map').addEventListener('click',returnToPlaces);
  map.on('popupopen',()=>{backButton.hidden=false;});

  const observer = new ResizeObserver(() => map.invalidateSize({pan:false}));
  observer.observe($('#map'));
  const viewport=$('.map-viewport');
  const sidebar=$('.map-sidebar');
  const legend=$('.map-legend');
  const footer=$('.map-sidebar-footer');
  const heading=$('.map-heading');
  const credits=$('#map-credits');
  const overlayOptions=$('.map-overlays');
  const toolbar=element('div','map-filter-toolbar');
  viewport.append(toolbar);
  const bottom=$('.map-bottom');
  for(const [id,label,glyph] of [['toggle-neighborhoods','Barrios','B'],['toggle-subway','Subtes','T']]) {
    const button=$('#'+id);
    const state=button.querySelector('.ui-symbol');
    button.replaceChildren(element('span','overlay-label',label),element('span','overlay-glyph',glyph),state);
    button.setAttribute('aria-label',label);button.title=label;
  }
  for(const button of document.querySelectorAll('[data-layer]')) {
    button.setAttribute('aria-label',categories[button.dataset.layer].label);
    button.title=categories[button.dataset.layer].label;
  }
  const phone=matchMedia('(max-width: 680px)');
  function setMapLayout() {
    if(phone.matches) {
      viewport.append(heading,credits);
      toolbar.append(legend,overlayOptions);
      bottom.append(backButton,footer);
      credits.classList.add('map-note-mobile');
    } else {
      sidebar.prepend(heading,legend);
      sidebar.append(footer);footer.append(credits);
      bottom.append(overlayOptions);viewport.append(backButton);
      credits.classList.remove('map-note-mobile');
    }
    map.invalidateSize({pan:false});
  }
  phone.addEventListener('change',setMapLayout);setMapLayout();
  for(const button of document.querySelectorAll('[data-layer]')) button.addEventListener('click',()=>{
    const key=button.dataset.layer;
    const alreadySolo=map.hasLayer(layers[key]) && Object.values(layers).filter(group=>map.hasLayer(group)).length===1;
    clearSelectedStation();map.closePopup();$('.station-panel').hidden=true;
    selectCategory(alreadySolo ? null : key);
    fitPlaces();
  });
} else {
  $('#map-fallback').textContent='no pudimos cargar el mapa. abajo están todas las paradas en una lista.';
  for(const button of document.querySelectorAll('[data-layer], #reset-map, #toggle-neighborhoods, #toggle-subway')) button.disabled=true;
  $('.station-index').open=true;
  $('.map-loader').textContent='No pudimos cargar el mapa.';
}
let toastTimer;
function notify(message) {$('#toast').textContent=sentenceCase(message);$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
const emptyMarkup=$('#link-items').innerHTML;
function renderLinks(){
  $('#map-count').textContent=String(stations.length);
  $('#link-count').textContent=String(stations.length).padStart(2,'0');
  $('#link-items').replaceChildren();if(!stations.length){$('#link-items').innerHTML=emptyMarkup;return;}
  for(const station of stations){
    const row=document.createElement('div');row.className='saved-link';const category=categories[station.category];
    row.style.setProperty('--category-color',category.color);
    row.style.setProperty('--category-ink',category.ink);
    const symbol=document.createElement('span');symbol.className='line-symbol';symbol.style.background=category.color;symbol.style.color=category.ink;symbol.textContent=category.letter;
    const anchor=document.createElement('a');anchor.href=station.sourceUrl;anchor.target='_blank';anchor.rel='noopener noreferrer';
    const title=document.createElement('strong');title.textContent=sentenceCase(station.name)+' ';title.append(externalArrow());const detail=document.createElement('small');detail.textContent=category.label;anchor.append(title,detail);
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
    renderLinks();fitPlaces();mapDataReady=true;revealMap();setTimeout(()=>stations.forEach(warmPhoto),0);
  }catch(error){mapDataReady=true;revealMap();$('#form-error').textContent=error.message||'la base de datos no está disponible. reiniciá el proyecto con npm run dev.';}
}
$('#link-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);const url=String(form.get('url')).trim();const category=String(form.get('category'));
  const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='Agregando…';$('#form-error').textContent='';
  try{
    const response=await fetch('/api/places',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({url,category})});
    const result=await readApiResponse(response);if(!response.ok)throw new Error(result.error||'no pudimos agregar el lugar.');
    stations.push(result.place);orderCategory(result.place.category);addStationToList(result.place);addStationToMap(result.place);refreshCategory(result.place.category);renderLinks();showStation(result.place,true);warmPhoto(result.place);$('#link-form').reset();notify('lugar guardado.');
  }catch(error){$('#form-error').textContent=error.message;}
  finally{submit.disabled=false;submit.innerHTML='Agregar <span class="ui-symbol" aria-hidden="true">→</span>';}
});
loadPlaces();
