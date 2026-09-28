import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createBackups } from './backups.mjs';
import { readImageBody, validatePhoto, servePhotoVariant } from './images.mjs';

const root = dirname(fileURLToPath(import.meta.url));
try {process.loadEnvFile(join(root,'.env'));} catch(error) {if(error.code!=='ENOENT')throw error;}
const adminPassword=String(process.env.ADMIN_PASSWORD||'');
const adminCookie='nycpt_admin';
const adminSessions=new Set();
const publicRoot = join(root, 'dist');
const dataRoot = join(root, 'data');
mkdirSync(dataRoot, { recursive: true });
const photoRoot = join(dataRoot, 'photos');
mkdirSync(photoRoot, { recursive: true });
const database = new DatabaseSync(join(dataRoot, 'places.sqlite'));
const placesSchema = await readFile(join(root, 'db/0001_places.sql'), 'utf8');
database.exec(placesSchema);
if (!database.prepare('PRAGMA table_info(places)').all().some(column => column.name === 'visited')) {
  database.exec('ALTER TABLE places ADD COLUMN visited INTEGER NOT NULL DEFAULT 0 CHECK (visited IN (0, 1))');
}
if (!database.prepare('PRAGMA table_info(places)').all().some(column => column.name === 'notes')) {
  database.exec("ALTER TABLE places ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}

// SQLite CHECK constraints need a table migration when adding a category.
const currentPlacesSchema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'places'").get().sql;
if (!currentPlacesSchema.includes("'shop'")) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(currentPlacesSchema.replace(/CREATE TABLE\s+"?places"?/i, 'CREATE TABLE places_with_shop').replace("'walk'", "'walk', 'shop'"));
    database.exec('INSERT INTO places_with_shop SELECT * FROM places');
    database.exec('DROP TABLE places');
    database.exec('ALTER TABLE places_with_shop RENAME TO places');
    database.exec(placesSchema);
    database.exec('COMMIT');
  } catch (error) {database.exec('ROLLBACK');throw error;}
}

// A portable snapshot initializes a new (or empty) local database after cloning.
// Never replace places or visits already saved on the receiving computer.
const snapshotPath=join(root,'db/places.snapshot.sqlite');
if(database.prepare('SELECT COUNT(*) AS count FROM places').get().count===0 && existsSync(snapshotPath)) {
  const snapshot=new DatabaseSync(snapshotPath,{readOnly:true});
  try {
    const rows=snapshot.prepare('SELECT * FROM places').all();
    if(rows.length) {
      const columns=database.prepare('PRAGMA table_info(places)').all().map(column=>column.name);
      const insert=database.prepare(`INSERT INTO places (${columns.map(name=>`"${name}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
      database.exec('BEGIN IMMEDIATE');
      try {
        for(const row of rows)insert.run(...columns.map(name=>row[name] ?? (name==='visited' ? 0 : name==='notes' ? '' : null)));
        database.exec('COMMIT');
      } catch(error) {database.exec('ROLLBACK');throw error;}
    }
  } finally {snapshot.close();}
}

const selectPlaces = database.prepare(`
  SELECT id, source_url, canonical_url, place_id, name, latitude, longitude,
         category, area, google_types_json, photo_url, notes, enrichment_status, created_at, visited
  FROM places ORDER BY created_at ASC
`);
const findBySource = database.prepare('SELECT id FROM places WHERE source_url = ?');
const findById = database.prepare('SELECT * FROM places WHERE id = ?');
const savePhotoUrl = database.prepare("UPDATE places SET photo_url = ?, enrichment_status = 'photo_ready' WHERE id = ?");
const saveNotes = database.prepare('UPDATE places SET notes = ? WHERE id = ?');
const insertPlace = database.prepare(`
  INSERT INTO places (
    id, source_url, canonical_url, place_id, name, latitude, longitude,
    category, area, google_types_json, photo_url, enrichment_status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, 'link_only', ?)
`);

const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif' };
function sendJson(response,status,value,headers={}){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});response.end(JSON.stringify(value));}
function sessionToken(request){
  const match=String(request.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${adminCookie}=([^;]+)`));
  if(!match)return '';
  try{return decodeURIComponent(match[1]);}catch{return '';}
}
function isAdmin(request){return adminSessions.has(sessionToken(request));}
function passwordMatches(candidate){
  if(!adminPassword)return false;
  const expected=createHash('sha256').update(adminPassword).digest();
  const received=createHash('sha256').update(String(candidate||'')).digest();
  return timingSafeEqual(expected,received);
}
function sessionCookie(token){return `${adminCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;}
function clearSessionCookie(){return `${adminCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;}
function isGoogleMapsUrl(url){const host=url.hostname.toLowerCase();const googleHost=host==='maps.app.goo.gl'||host==='goo.gl'||/^(?:www\.|maps\.)?google\.[a-z.]{2,}$/.test(host);return googleHost&&(host==='maps.app.goo.gl'||url.pathname.startsWith('/maps')||url.searchParams.has('q')||url.searchParams.has('query'));}
function decodeText(value){try{return decodeURIComponent(value.replace(/\+/g,' ')).replace(/&amp;/g,'&').trim();}catch{return value.replace(/\+/g,' ').trim();}}
function photoFromHtml(html,baseUrl){
  const patterns=[
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for(const pattern of patterns){
    const value=pattern.exec(html)?.[1];if(!value)continue;
    try{const url=new URL(decodeText(value),baseUrl);if(url.protocol==='https:')return url.href;}catch{}
  }
  return null;
}

function extractPlace(url,html=''){
  const raw=decodeText(`${url.pathname}${url.search}${url.hash}`);
  const dataPoint=raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const viewportPoint=raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
  const query=url.searchParams.get('query')||url.searchParams.get('q')||'';
  const queryPoint=query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const htmlPoint=html.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)||html.match(/center=(-?\d+(?:\.\d+)?)%2C(-?\d+(?:\.\d+)?)/i);
  const point=dataPoint||viewportPoint||queryPoint||htmlPoint;
  const latitude=point?Number(point[1]):NaN;const longitude=point?Number(point[2]):NaN;
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw new Error('Google Maps no devolvió la ubicación de este link.');
  const pathName=url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/i)?.[1];
  const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]||'';
  const name=decodeText(pathName||(!queryPoint&&query)||title.replace(/\s*[|·-]\s*Google Maps\s*$/i,''));
  const placeId=url.searchParams.get('query_place_id')||url.searchParams.get('place_id')||raw.match(/(?:^|!)1s(ChI[A-Za-z0-9_-]+)/)?.[1]||null;
  return {name:name||'lugar guardado',latitude,longitude,placeId,photoUrl:photoFromHtml(html,url)};
}

async function resolveGoogleMapsLink(source){
  let current;try{current=new URL(source);}catch{throw new Error('Pegá un link válido de Google Maps.');}
  if(!isGoogleMapsUrl(current))throw new Error('Pegá un link válido de Google Maps.');
  for(let redirects=0;redirects<6;redirects+=1){
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 (compatible; PazTatoMap/1.0)'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('Google Maps devolvió un link incompleto.');const next=new URL(location,current);if(!isGoogleMapsUrl(next))throw new Error('El link salió de Google Maps durante la redirección.');current=next;continue;}
    if(!response.ok)throw new Error('No pudimos abrir ese link en Google Maps.');
    const html=(await response.text()).slice(0,1_000_000);return {...extractPlace(current,html),canonicalUrl:current.href};
  }
  throw new Error('El link tiene demasiadas redirecciones.');
}

function serializePlace(row){return {id:row.id,visited:Boolean(row.visited),sourceUrl:row.source_url,googleMapsUrl:row.canonical_url,placeId:row.place_id,name:row.name,point:[row.latitude,row.longitude],category:row.category,area:row.area,googleTypes:row.google_types_json?JSON.parse(row.google_types_json):[],photoUrl:row.photo_url,notes:row.notes||'',enrichmentStatus:row.enrichment_status,createdAt:row.created_at};}
async function readBody(request){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>16384)throw new Error('La solicitud es demasiado grande.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}


function wikimediaFilePage(photoUrl){
  try{
    const url=new URL(photoUrl);if(!['upload.wikimedia.org','thumb.wikimedia.org'].includes(url.hostname))return null;
    const thumbFile=url.pathname.match(/\/thumb\/[a-f0-9]\/[^/]+\/([^/]+)\//i)?.[1];
    const file=thumbFile||url.pathname.split('/').pop();
    return file?`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(decodeURIComponent(file))}`:null;
  }catch{return null;}
}

async function cachePhoto(row,remoteUrl){
  if(String(remoteUrl).startsWith('/photos/'))return remoteUrl;
  let url;try{url=new URL(remoteUrl);}catch{throw new Error('La URL de la foto no es válida.');}
  if(url.protocol!=='https:')throw new Error('La foto debe usar HTTPS.');
  const response=await fetch(url,{headers:{accept:'image/*','user-agent':'PazTatoMap/1.0 (personal travel map)'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('No pudimos descargar la foto.');
  const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
  const extension=extensions[mime];if(!extension)throw new Error('La foto tiene un formato no compatible.');
  const bytes=await readImageBody(response.body);
  await validatePhoto(bytes);
  const fileName=`${row.id}-${Date.now()}.${extension}`;await writeFile(join(photoRoot,fileName),bytes);
  const localUrl=`/photos/${fileName}`;savePhotoUrl.run(localUrl,row.id);return localUrl;
}

async function saveUploadedPhoto(row,mime,bytes){
  await validatePhoto(bytes);
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
  const extension=extensions[mime];if(!extension)throw new Error('Usá una foto JPG, PNG, WEBP o GIF.');
  const fileName=`${row.id}-${Date.now()}.${extension}`;await writeFile(join(photoRoot,fileName),bytes);
  const localUrl=`/photos/${fileName}`;savePhotoUrl.run(localUrl,row.id);return localUrl;
}

function words(value){return new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]);}
function titleScore(name,title,index){
  const wanted=words(name);const found=words(title);let overlap=0;
  for(const word of wanted)if(word.length>2&&found.has(word))overlap+=1;
  return overlap*100-Number(index||999);
}

let wikimediaQueue=Promise.resolve();
let lastWikimediaRequest=0;
function wikimediaJson(url){
  const request=wikimediaQueue.then(async()=>{
    const delay=Math.max(0,800-(Date.now()-lastWikimediaRequest));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    lastWikimediaRequest=Date.now();
    const response=await fetch(url,{headers:{accept:'application/json','user-agent':'PazTatoMap/1.0 (personal travel map)'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Wikimedia no respondió.');
    return response.json();
  });
  wikimediaQueue=request.catch(()=>{});
  return request;
}

async function wikimediaPhotoForPlace(row){
  if(String(row.photo_url||'').startsWith('/photos/')){
    return {photoUrl:row.photo_url,sourceUrl:null,author:null};
  }
  if(row.photo_url&&wikimediaFilePage(row.photo_url)){
    return {photoUrl:await cachePhoto(row,row.photo_url),sourceUrl:wikimediaFilePage(row.photo_url),author:{name:'Wikimedia Commons',url:'https://commons.wikimedia.org/'}};
  }
  const api=new URL('https://en.wikipedia.org/w/api.php');
  const params={action:'query',generator:'search',gsrsearch:`${row.name} New York City`,gsrnamespace:'0',gsrlimit:'5',prop:'pageimages|info',piprop:'thumbnail',pithumbsize:'1200',inprop:'url',format:'json',origin:'*'};
  for(const [key,value]of Object.entries(params))api.searchParams.set(key,value);
  const payload=await wikimediaJson(api);
  const pages=Object.values(payload.query?.pages||{}).filter(page=>page.thumbnail?.source).sort((a,b)=>titleScore(row.name,b.title,b.index)-titleScore(row.name,a.title,a.index));
  const page=pages[0];
  if(page&&titleScore(row.name,page.title,page.index)>=50){
    const photoUrl=await cachePhoto(row,page.thumbnail.source);
    return {photoUrl,sourceUrl:page.fullurl,author:{name:'Wikipedia / Wikimedia Commons',url:page.fullurl}};
  }
  const commons=new URL('https://commons.wikimedia.org/w/api.php');
  const commonsParams={action:'query',generator:'search',gsrsearch:`${row.name} New York`,gsrnamespace:'6',gsrlimit:'8',prop:'imageinfo',iiprop:'url',iiurlwidth:'1200',format:'json',origin:'*'};
  for(const [key,value]of Object.entries(commonsParams))commons.searchParams.set(key,value);
  const commonsPayload=await wikimediaJson(commons);
  const files=Object.values(commonsPayload.query?.pages||{}).filter(file=>file.imageinfo?.[0]?.thumburl).sort((a,b)=>titleScore(row.name,b.title,b.index)-titleScore(row.name,a.title,a.index));
  const file=files[0];
  if(!file||titleScore(row.name,file.title,file.index)<50)throw new Error('No encontramos una foto libre para este lugar.');
  const photoUrl=await cachePhoto(row,file.imageinfo[0].thumburl);
  return {photoUrl,sourceUrl:file.imageinfo[0].descriptionurl,author:{name:'Wikimedia Commons',url:file.imageinfo[0].descriptionurl}};
}

async function handleApi(request,response,url){
  if(url.pathname==='/api/admin/session'){
    if(request.method!=='GET'){sendJson(response,405,{error:'Método no permitido.'});return true;}
    sendJson(response,200,{authenticated:isAdmin(request),configured:Boolean(adminPassword)});return true;
  }
  if(url.pathname==='/api/admin/login'){
    if(request.method!=='POST'){sendJson(response,405,{error:'Método no permitido.'});return true;}
    if(!adminPassword){sendJson(response,503,{error:'Configurá ADMIN_PASSWORD en el archivo .env.'});return true;}
    try{
      const body=await readBody(request);
      if(!passwordMatches(body.password)){sendJson(response,401,{error:'Contraseña incorrecta.'});return true;}
      const token=randomBytes(32).toString('base64url');adminSessions.add(token);
      sendJson(response,200,{authenticated:true},{'set-cookie':sessionCookie(token)});
    }catch(error){sendJson(response,400,{error:error.message});}
    return true;
  }
  if(url.pathname==='/api/admin/logout'){
    if(request.method!=='POST'){sendJson(response,405,{error:'Método no permitido.'});return true;}
    adminSessions.delete(sessionToken(request));
    sendJson(response,200,{authenticated:false},{'set-cookie':clearSessionCookie()});return true;
  }
  if(['POST','PUT','PATCH','DELETE'].includes(request.method)&&url.pathname.startsWith('/api/places')&&!isAdmin(request)){
    sendJson(response,401,{error:'Ingresá como admin para editar el mapa.'});return true;
  }
  const visitedMatch = url.pathname.match(/^\/api\/places\/([^/]+)\/visited$/);
  if (visitedMatch) {
    if (request.method !== 'PATCH') {sendJson(response,405,{error:'Método no permitido.'});return true;}
    try {
      const id = decodeURIComponent(visitedMatch[1]);
      if (!findById.get(id)) {sendJson(response,404,{error:'Lugar no encontrado.'});return true;}
      const body = await readBody(request);
      if (typeof body.visited !== 'boolean') throw new Error('Indicá si el lugar fue visitado.');
      database.prepare('UPDATE places SET visited = ? WHERE id = ?').run(Number(body.visited),id);
      sendJson(response,200,{visited:body.visited});
    } catch (error) {sendJson(response,400,{error:error.message});}
    return true;
  }
  const notesMatch=url.pathname.match(/^\/api\/places\/([^/]+)\/notes$/);
  if(notesMatch){
    if(request.method!=='PATCH'){sendJson(response,405,{error:'Método no permitido.'});return true;}
    try{
      const id=decodeURIComponent(notesMatch[1]);
      if(!findById.get(id)){sendJson(response,404,{error:'Lugar no encontrado.'});return true;}
      const body=await readBody(request);const notes=String(body.notes||'').trim();
      if(notes.length>2000)throw new Error('La nota puede tener hasta 2000 caracteres.');
      saveNotes.run(notes,id);sendJson(response,200,{notes});
    }catch(error){sendJson(response,400,{error:error.message});}
    return true;
  }
  const photoMatch=url.pathname.match(/^\/api\/places\/([^/]+)\/photo$/);
  if(photoMatch&&request.method==='PUT'){
    try{
      const row=findById.get(decodeURIComponent(photoMatch[1]));if(!row){sendJson(response,404,{error:'Lugar no encontrado.'});return true;}
      const mime=(request.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      let photoUrl;
      if(mime==='application/json'){
        const body=await readBody(request);photoUrl=await cachePhoto(row,String(body.url||''));
      }else if(mime.startsWith('image/')){
        photoUrl=await saveUploadedPhoto(row,mime,await readImageBody(request));
      }else throw new Error('Arrastrá un archivo de imagen o una imagen desde otra página.');
      sendJson(response,200,{photoUrl,sourceUrl:null,author:null});
    }catch(error){sendJson(response,error.statusCode||400,{error:error.message});}
    return true;
  }
  if(photoMatch&&request.method==='GET'){
    try{
      const row=findById.get(decodeURIComponent(photoMatch[1]));if(!row){sendJson(response,404,{error:'Lugar no encontrado.'});return true;}
      try{sendJson(response,200,await wikimediaPhotoForPlace(row));}
      catch(error){
        if(!row.photo_url)throw error;
        sendJson(response,200,{photoUrl:await cachePhoto(row,row.photo_url),sourceUrl:row.photo_url,author:{name:'sitio oficial',url:row.photo_url}});
      }
    }
    catch(error){sendJson(response,error.statusCode||400,{error:error.message});}
    return true;
  }
  if(url.pathname!=='/api/places')return false;
  if(request.method==='GET'){sendJson(response,200,{places:selectPlaces.all().map(serializePlace)});return true;}
  if(request.method==='POST'){
    try{
      const body=await readBody(request);const sourceUrl=String(body.url||'').trim();const category=String(body.category||'');
      if(!['food','culture','walk','shop'].includes(category))throw new Error('Elegí una categoría válida.');
      if(findBySource.get(sourceUrl)){sendJson(response,409,{error:'Ese link ya está guardado.'});return true;}
      const resolved=await resolveGoogleMapsLink(sourceUrl);const id=randomUUID();const createdAt=new Date().toISOString();
      insertPlace.run(id,sourceUrl,resolved.canonicalUrl,resolved.placeId,resolved.name,resolved.latitude,resolved.longitude,category,resolved.photoUrl,createdAt);
      sendJson(response,201,{place:serializePlace(database.prepare('SELECT * FROM places WHERE id = ?').get(id))});
    }catch(error){const duplicate=String(error.message).includes('UNIQUE constraint failed');sendJson(response,duplicate?409:400,{error:duplicate?'Ese lugar ya está guardado.':error.message});}
    return true;
  }
  sendJson(response,405,{error:'Método no permitido.'});return true;
}

async function serveStatic(response,pathname){
  const isPhoto=pathname.startsWith('/photos/');
  const requested=pathname==='/'?'/index.html':pathname;
  const base=isPhoto?photoRoot:publicRoot;
  const requestedPath=isPhoto?requested.slice('/photos'.length):requested;
  const file=resolve(base,`.${requestedPath}`);
  const pathWithinBase=relative(base,file);
  if(pathWithinBase==='..'||pathWithinBase.startsWith(`..${sep}`)||isAbsolute(pathWithinBase)){response.writeHead(403).end('Forbidden');return;}
  try{const body=await readFile(file);response.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':isPhoto?'public, max-age=31536000, immutable':'no-cache'});response.end(body);}catch{response.writeHead(404).end('Not found');}
}
const saveBackup=createBackups(database,root);
const backupSafely=()=>saveBackup().catch(error=>process.stderr.write(`Backup pendiente: ${error.message}\n`));
let backupTimer;
function scheduleBackup(){clearTimeout(backupTimer);backupTimer=setTimeout(backupSafely,2000);backupTimer.unref();}
backupSafely();
setInterval(backupSafely,10*60*1000).unref();
const port=Number(process.env.PORT||4173);
const host=process.env.HOST||'0.0.0.0';
createServer(async(request,response)=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method))response.once('finish',()=>{if(response.statusCode<400)scheduleBackup();});const url=new URL(request.url,`http://${request.headers.host||'127.0.0.1'}`);if(await handleApi(request,response,url))return;if(await servePhotoVariant(response,url,photoRoot))return;await serveStatic(response,url.pathname);}).listen(port,host,()=>{process.stdout.write(`paz y tato: http://${host}:${port}\n`);});
