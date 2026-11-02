import { hex } from './http.js';

const encoder = new TextEncoder();

// IPv6 users usually control a whole /64, so the prefix is the meaningful identity for limits and bans.
export function ipKey(ip) {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const halves = ip.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  const prefix = groups.slice(0, 4);
  if (prefix.length < 4 || prefix.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return ip;
  return prefix.map(group => parseInt(group, 16).toString(16)).join(':') + '::/64';
}

let cachedKey;
let cachedPepper;
// Keyed hash (HMAC-SHA-256) with a secret pepper: the stored value cannot be reversed or matched against a list of
// addresses without the secret, yet the same visitor still maps to the same value for limits and bans.
export async function ipHash(ip, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('IP_PEPPER is missing or too short.');
  if (pepper !== cachedPepper) {
    cachedKey = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    cachedPepper = pepper;
  }
  return hex(await crypto.subtle.sign('HMAC', cachedKey, encoder.encode(ipKey(ip || 'unknown')))).slice(0, 32);
}
