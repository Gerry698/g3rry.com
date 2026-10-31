import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const sourcePattern = /^Photo\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;

export async function validatePhotos(root, photos, heroId, plannedNames = []) {
  if (!Array.isArray(photos) || !photos.length) throw new Error('Add at least one photograph.');
  const names = [...await readdir(path.join(root, 'Photo')), ...plannedNames];
  const ids = new Set();
  const sources = new Set();
  for (const photo of photos) {
    if (!photo || !/^[a-z][a-z0-9-]*$/.test(photo.id) || ids.has(photo.id)) throw new Error('Photo IDs must be unique lowercase identifiers.');
    if (typeof photo.source !== 'string' || !photo.source.startsWith('Photo/') || !sourcePattern.test(photo.source) || sources.has(photo.source.toLowerCase())) throw new Error('Photo sources must be unique JPEG, PNG or WebP files inside Photo/.');
    if (!names.includes(path.basename(photo.source))) throw new Error('Source filename case does not match: ' + photo.source);
    if (typeof photo.alt !== 'string' || !photo.alt.trim()) throw new Error('Each photo needs a real description.');
    if (typeof photo.featured !== 'boolean') throw new Error('Each photo needs a featured field.');
    ids.add(photo.id);
    sources.add(photo.source.toLowerCase());
  }
  if (heroId && !ids.has(heroId)) throw new Error('Hero photoId must name a photograph.');
  if (!photos.some(photo => photo.featured)) throw new Error('Keep at least one featured photograph.');
  return photos;
}
