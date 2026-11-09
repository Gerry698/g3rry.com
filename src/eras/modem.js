// The modem. A service worker for /eras/ that slows the 1996 and 1999 copies of the site to the speed of a
// dial-up line: one line shared by every request, at most four connections at a time (as browsers of the period
// opened), and a quarter of a second before each response starts. Bytes are handed to the browser as the line
// would have delivered them, so pages and images draw themselves in, line by line and pass by pass.
'use strict';

const SETTING = '/eras/modem-setting';
const STORE = 'eras-modem';
const USUAL = { 1996: 28800, 1999: 48000 };
const CONNECTIONS = 4;
const LATENCY = 250; // milliseconds before the first byte of each response
const EFFICIENCY = 0.85; // what is left of the line after modem framing, PPP, IP and TCP

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function chosen() {
  try {
    const cache = await caches.open(STORE);
    const stored = await cache.match(SETTING);
    if (!stored) return null;
    const value = (await stored.json()).bps;
    return typeof value === 'number' && value >= 0 ? value : null;
  } catch (error) { return null; }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const match = /^\/eras\/(1996|1999)\//.exec(url.pathname);
  if (!match) return;
  event.respondWith(slowly(request, match[1]));
});

async function slowly(request, year) {
  const response = await fetch(request);
  try {
    const setting = await chosen();
    const bps = setting === null ? USUAL[year] : setting;
    if (!bps || response.status !== 200 || response.type !== 'basic' || !response.body) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const headers = new Headers(response.headers);
    // The body handed on is already decoded, so its encoding and length headers no longer apply.
    headers.delete('content-encoding');
    headers.delete('content-length');
    let job;
    const body = new ReadableStream({
      start(controller) { job = line.open(bytes, controller, bps); },
      cancel() { line.close(job); }
    });
    return new Response(body, { status: 200, statusText: response.statusText, headers });
  } catch (error) {
    return fetch(request);
  }
}

const line = {
  queue: [], active: new Set(), timer: 0, last: 0,
  open(bytes, controller, bps) {
    const job = { bytes, controller, rate: bps / 8 * EFFICIENCY, sent: 0, credit: 0, start: 0 };
    this.queue.push(job);
    this.pump();
    return job;
  },
  close(job) {
    this.active.delete(job);
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
  },
  pump() {
    while (this.active.size < CONNECTIONS && this.queue.length) {
      const job = this.queue.shift();
      job.start = Date.now() + LATENCY;
      this.active.add(job);
    }
    if (!this.timer && this.active.size) {
      this.last = Date.now();
      this.timer = setInterval(() => this.tick(), 40);
    }
  },
  tick() {
    const now = Date.now(), seconds = (now - this.last) / 1000;
    this.last = now;
    const flowing = [...this.active].filter(job => now >= job.start);
    if (flowing.length) {
      // The line's rate is shared equally by the connections that are receiving.
      const rate = flowing[0].rate;
      for (const job of flowing) {
        job.credit += rate * seconds / flowing.length;
        const count = Math.min(Math.floor(job.credit), job.bytes.length - job.sent);
        try {
          if (count > 0) {
            job.controller.enqueue(job.bytes.slice(job.sent, job.sent + count));
            job.sent += count;
            job.credit -= count;
          }
          if (job.sent >= job.bytes.length) { job.controller.close(); this.active.delete(job); }
        } catch (error) { this.active.delete(job); }
      }
    }
    this.pump();
    if (!this.active.size && !this.queue.length) { clearInterval(this.timer); this.timer = 0; }
  }
};
