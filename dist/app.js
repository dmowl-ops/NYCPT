'use strict';
const $ = (selector) => document.querySelector(selector);
const departure = new Date('2026-12-23T00:00:00-03:00').getTime();
function updateCountdown() {
  const left = Math.max(0, departure - Date.now());
  $('#days').textContent = String(Math.floor(left / 86400000)).padStart(2, '0');
  $('#hours').textContent = String(Math.floor(left / 3600000) % 24).padStart(2, '0');
  $('#minutes').textContent = String(Math.floor(left / 60000) % 60).padStart(2, '0');
  if (!left) $('#count-label').textContent = 'el viaje ya empezó.';
}
updateCountdown(); setInterval(updateCountdown, 1000);
const styles = getComputedStyle(document.documentElement);
const categories = {
  food: {label:'comer', letter:'c', color:styles.getPropertyValue('--orange').trim()},
  culture: {label:'mirar', letter:'m', color:styles.getPropertyValue('--pink').trim()},
  walk: {label:'perderse', letter:'p', color:styles.getPropertyValue('--blue').trim()}
};
// Illustrative locations; these are not a confirmed itinerary or transit routes.
const stations = [
  {id:1,category:'food',name:'chelsea market',area:'chelsea · manhattan',point:[40.7424,-74.0061]},
  {id:2,category:'food',name:'washington square',area:'greenwich village · una zona para explorar',point:[40.7308,-73.9973]},
  {id:3,category:'food',name:'chinatown',area:'lower manhattan · una zona para explorar',point:[40.7158,-73.9970]},
  {id:4,category:'culture',name:'the met',area:'upper east side · manhattan',point:[40.7794,-73.9632]},
  {id:5,category:'culture',name:'moma',area:'midtown · manhattan',point:[40.7614,-73.9776]},
  {id:6,category:'culture',name:'whitney museum',area:'meatpacking district · manhattan',point:[40.7396,-74.0089]},
  {id:7,category:'walk',name:'central park',area:'manhattan · punto de encuentro al sur del parque',point:[40.7681,-73.9819]},
  {id:8,category:'walk',name:'bryant park',area:'midtown · manhattan',point:[40.7536,-73.9832]},
  {id:9,category:'walk',name:'dumbo',area:'brooklyn · junto al east river',point:[40.7033,-73.9894]}
];
let map = null; const layers = {}; const markers = {};
function showStation(station, pan = false) {
  const category = categories[station.category];
  $('.station-panel').style.background = category.color;
  $('#station-category').textContent = `línea ${category.letter} / ${category.label}`;
  $('#station-number').textContent = String(station.id).padStart(2,'0');
  $('#station-title').textContent = station.name;
  $('#station-description').textContent = station.area;
  const link = $('#station-link'); link.hidden = false;
  link.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(station.name + ', New York');
  if(pan && map) {
    if (!map.hasLayer(layers[station.category])) {layers[station.category].addTo(map); document.querySelector(`[data-layer="${station.category}"]`).setAttribute('aria-pressed','true');}
    map.setView(station.point, 14, {animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});
  }
  if (matchMedia('(max-width:680px)').matches) $('.station-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
for (const station of stations) {
  const button = document.createElement('button'); button.className = 'station-list-item';
  const symbol = document.createElement('span'); symbol.className='line-symbol'; symbol.style.background=categories[station.category].color; symbol.style.color='var(--ink)'; symbol.textContent=station.id;
  const name = document.createElement('span'); name.textContent=station.name;
  button.append(symbol,name); button.addEventListener('click',()=>showStation(station,true)); $('#station-list').append(button);
}
if (window.L) {
  $('#map-fallback').remove();
  map = L.map('map',{zoomControl:false,scrollWheelZoom:false}).setView([40.744,-73.986],12);
  L.control.zoom({position:'topright'}).addTo(map);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  let errors = 0;
  tiles.on('tileerror',()=>{if(++errors===4) notify('el mapa está tardando. podés explorar las paradas en la lista.');});
  for (const [key,category] of Object.entries(categories)) {
    const group = L.layerGroup().addTo(map); layers[key]=group;
    const points = stations.filter(s=>s.category===key);
    L.polyline(points.map(s=>s.point),{color:category.color,weight:5,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(group);
    for(const station of points) {
      const marker = L.marker(station.point,{title:station.name,alt:station.name,icon:L.divIcon({className:'map-station',html:String(station.id),iconSize:[26,26],iconAnchor:[13,13]})}).addTo(group);
      marker.bindTooltip(station.name,{direction:'top'}); marker.on('click',()=>showStation(station)); markers[station.id]=marker;
    }
  }
  function resetMap() {map.fitBounds(stations.map(s=>s.point),{paddingTopLeft:matchMedia('(max-width:680px)').matches?[34,30]:[250,40],paddingBottomRight:matchMedia('(max-width:680px)').matches?[34,30]:[305,65]});}
  resetMap(); $('#reset-map').addEventListener('click',resetMap);
  for(const button of document.querySelectorAll('[data-layer]')) button.addEventListener('click',()=>{const group=layers[button.dataset.layer];const active=map.hasLayer(group);if(active)map.removeLayer(group);else group.addTo(map);button.setAttribute('aria-pressed',String(!active));});
} else {
  $('#map-fallback').textContent='no pudimos cargar el mapa. abajo están todas las paradas en una lista.';
  for(const button of document.querySelectorAll('[data-layer], #reset-map')) button.disabled=true;
  $('.station-index').open=true;
}
let toastTimer;
function notify(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
const storageKey='paz-tato-links-v1'; let links=[];
function validLink(link) {try{return typeof link.title==='string' && link.title.length<=100 && categories[link.category] && /^https?:$/.test(new URL(link.url).protocol);}catch{return false;}}
try {const stored=localStorage.getItem(storageKey);if(stored){const data=JSON.parse(stored);if(Array.isArray(data)){links=data.filter(validLink).slice(0,500).map((l,i)=>({...l,id:i+1}));$('#remember').checked=true;}}}catch{notify('no pudimos leer los links guardados en este navegador.');}
const emptyMarkup=$('#link-items').innerHTML;
function persist(){if($('#remember').checked){try{localStorage.setItem(storageKey,JSON.stringify(links));}catch{notify('no se pudieron guardar. exportá tus links para conservarlos.');}}}
function renderLinks(){
  $('#link-count').textContent=String(links.length).padStart(2,'0');$('#export-links').disabled=!links.length;
  $('#link-items').replaceChildren();if(!links.length){$('#link-items').innerHTML=emptyMarkup;return;}
  for(const link of links){
    const row=document.createElement('div');row.className='saved-link';const category=categories[link.category];
    const symbol=document.createElement('span');symbol.className='line-symbol';symbol.style.background=category.color;symbol.textContent=category.letter;
    const anchor=document.createElement('a');anchor.href=link.url;anchor.target='_blank';anchor.rel='noopener noreferrer';
    const title=document.createElement('strong');title.textContent=link.title+' ↗';const domain=document.createElement('small');domain.textContent=new URL(link.url).hostname+' / '+category.label;anchor.append(title,domain);
    const remove=document.createElement('button');remove.className='remove-link';remove.textContent='×';remove.setAttribute('aria-label','quitar '+link.title);remove.addEventListener('click',()=>{links=links.filter(l=>l.id!==link.id);persist();renderLinks();notify('link quitado de la bandeja.');});
    row.append(symbol,anchor,remove);$('#link-items').append(row);
  }
}
renderLinks();
$('#remember').addEventListener('change',()=>{if($('#remember').checked){persist();notify('los links se guardan en este navegador.');}else{try{localStorage.removeItem(storageKey);notify('guardado local desactivado. los links siguen en esta sesión.');}catch{notify('no pudimos borrar el guardado local. revisá los datos del sitio en tu navegador.');}}});
$('#add-link').addEventListener('click',()=>{$('#link-dialog').showModal();$('#url-input').focus();});
$('#close-dialog').addEventListener('click',()=>$('#link-dialog').close());
$('#link-form').addEventListener('submit',(event)=>{
  event.preventDefault();const form=new FormData(event.currentTarget);const link={id:Date.now()+Math.random(),url:String(form.get('url')).trim(),title:String(form.get('title')).trim(),category:String(form.get('category'))};
  if(!validLink(link)||!link.title){$('#form-error').textContent='poné un nombre y un link que empiece con https:// o http://.';return;}
  links.unshift(link);persist();renderLinks();event.currentTarget.reset();$('#form-error').textContent='';$('#link-dialog').close();notify('una idea más para el viaje.');
});
$('#export-links').addEventListener('click',()=>{
  const text=['paz y tato conquistan américa','links para nueva york','',...links.map(l=>`${l.title} / ${categories[l.category].label}\n${l.url}\n`) ].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='paz-y-tato-links.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('links exportados.');
});
