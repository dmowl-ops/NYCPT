import { backup } from 'node:sqlite';
import { mkdir, readdir, copyFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

// One shared photo archive, a current database snapshot and one snapshot per day.
// Originals are immutable; generated image variants can be rebuilt.
export function createBackups(database, root) {
  let running = null;
  async function copyMissing(source, destination) {
    await mkdir(destination, {recursive:true});
    for (const entry of await readdir(source, {withFileTypes:true})) {
      if (entry.name === 'variants') continue;
      const from=join(source,entry.name), to=join(destination,entry.name);
      if(entry.isDirectory()) await copyMissing(from,to);
      else if(entry.isFile()) {
        try {await copyFile(from,to,constants.COPYFILE_EXCL);}
        catch(error) {if(error.code!=='EEXIST')throw error;}
      }
    }
  }
  async function save() {
    const destination=join(root,'backups');
    await mkdir(destination,{recursive:true});
    await copyMissing(join(root,'data/photos'),join(destination,'photos'));
    const temporary=join(destination,'latest.pending.sqlite');
    await backup(database,temporary);
    await rename(temporary,join(destination,'latest.sqlite'));
    const day=new Date().toISOString().slice(0,10);
    try {await copyFile(join(destination,'latest.sqlite'),join(destination,day+'.sqlite'),constants.COPYFILE_EXCL);}
    catch(error) {if(error.code!=='EEXIST')throw error;}
    try {await copyFile(join(root,'db/photo-sources.json'),join(destination,'photo-sources.json'));}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    await writeFile(join(destination,'status.json'),JSON.stringify({savedAt:new Date().toISOString(),database:'latest.sqlite',photos:'photos'},null,2)+'\n');
  }
  return () => {
    if(!running)running=save().finally(()=>{running=null;});
    return running;
  };
}
