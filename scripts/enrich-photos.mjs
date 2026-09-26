import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const database=new DatabaseSync(join(root,'data/places.sqlite'));
const places=database.prepare("SELECT id,name,source_url FROM places WHERE photo_url IS NULL OR photo_url = '' ORDER BY created_at").all();
const update=database.prepare("UPDATE places SET photo_url = ?, enrichment_status = 'photo' WHERE id = ?");

function decode(value){return value.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();}
function findPhoto(html,baseUrl){
  const patterns=[
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for(const pattern of patterns){
    const value=pattern.exec(html)?.[1];if(!value)continue;
    try{const url=new URL(decode(value),baseUrl);if(url.protocol==='https:')return url.href;}catch{}
  }
  return null;
}

for(const place of places){
  try{
    const response=await fetch(place.source_url,{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 (compatible; PazTatoMap/1.0)','accept':'text/html'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const photo=findPhoto((await response.text()).slice(0,2_000_000),response.url);
    if(!photo)throw new Error('sin metadato de imagen');
    update.run(photo,place.id);process.stdout.write(`foto: ${place.name}\n`);
  }catch(error){process.stderr.write(`sin foto: ${place.name} (${error.message})\n`);}
}
