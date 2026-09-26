import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const widths = new Set([160, 320, 480, 640, 960, 1280, 1920]);
const pending = new Map();

export async function readImageBody(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      const error = new Error('La foto supera el límite de 50 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) throw new Error('La foto está vacía.');
  return Buffer.concat(chunks);
}

export async function validatePhoto(bytes) {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) throw new Error();
  } catch {
    throw new Error('No pudimos leer la foto. Usá JPG, PNG, WEBP o GIF.');
  }
}

export async function servePhotoVariant(response, url, photoRoot) {
  if (!url.pathname.startsWith('/photos/') || !url.searchParams.has('w')) return false;
  const name = url.pathname.slice('/photos/'.length);
  const width = Number(url.searchParams.get('w'));
  if (!/^[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|gif)$/.test(name) || !widths.has(width)) {
    response.writeHead(400).end('Invalid image size');
    return true;
  }
  const cacheRoot = join(photoRoot, 'variants');
  const cacheFile = join(cacheRoot, `${name}-${width}-v1.webp`);
  try {
    let bytes;
    try { bytes = await readFile(cacheFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!pending.has(cacheFile)) {
        const job = (async () => {
          // The UI uses square previews; the original file stays untouched.
          const output = await sharp(join(photoRoot, name), { animated: true })
            .autoOrient().resize(width, width, { fit: 'cover', withoutEnlargement: true })
            .webp({ quality: 82 }).toBuffer();
          await mkdir(cacheRoot, { recursive: true });
          await writeFile(cacheFile, output);
          return output;
        })();
        pending.set(cacheFile, job);
      }
      try { bytes = await pending.get(cacheFile); }
      finally { pending.delete(cacheFile); }
    }
    response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' });
    response.end(bytes);
  } catch {
    response.writeHead(404).end('Image unavailable');
  }
  return true;
}
