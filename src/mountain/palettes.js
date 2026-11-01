import { hexToLinear, direction, lerp, normalize, mix3 } from './math.js';

// Time of day as the climb goes on. Colours are sRGB here and converted to linear light once.
// key: the light that shades and casts shadows (sun, or the moon at night); sun: where the sky glows.
const RAW = {
  idle: {
    key: [215, 24], keyColor: '#9db2ff', keyPower: .95, sun: [35, -7], glow: '#ff9874', glowPower: .55,
    zenith: '#0a1130', horizon: '#3a4b82', below: '#1b2346', ambSky: '#3b4f92', ambGround: '#1b1e33', ambPower: .7,
    fog: .010, haze: .05, stars: .75, moon: 1, moonDir: [200, 32], aurora: 0, sunDisc: 0, snow: .45,
    exposure: 1.15, saturation: .95, tint: '#f2f0ff', cloud: '#7f88aa'
  },
  dawn: {
    key: [70, 7], keyColor: '#ffb58f', keyPower: 2.6, sun: [70, 3], glow: '#ffae86', glowPower: 1.25,
    zenith: '#28397a', horizon: '#f0a990', below: '#6e6a8c', ambSky: '#7181bd', ambGround: '#5b4b56', ambPower: .55,
    fog: .009, haze: .045, stars: .18, moon: .35, moonDir: [250, 20], aurora: 0, sunDisc: 1, snow: .15,
    exposure: 1.05, saturation: 1, tint: '#fff4f0', cloud: '#f3c3b6'
  },
  morning: {
    key: [105, 21], keyColor: '#ffe3c2', keyPower: 3.3, sun: [105, 21], glow: '#ffe8cc', glowPower: .7,
    zenith: '#4479be', horizon: '#cfe0ee', below: '#93a6bb', ambSky: '#88aee0', ambGround: '#6c6a5c', ambPower: .5,
    fog: .0085, haze: .035, stars: 0, moon: 0, moonDir: [250, 20], aurora: 0, sunDisc: 1, snow: .05,
    exposure: 1, saturation: 1.02, tint: '#ffffff', cloud: '#ffffff'
  },
  noon: {
    key: [160, 50], keyColor: '#fff5e6', keyPower: 3.6, sun: [160, 50], glow: '#ffffff', glowPower: .4,
    zenith: '#2c69bb', horizon: '#b8d7ee', below: '#8da6bd', ambSky: '#86b2e6', ambGround: '#6e6a5a', ambPower: .48,
    fog: .0085, haze: .03, stars: 0, moon: 0, moonDir: [250, 20], aurora: 0, sunDisc: 1, snow: 0,
    exposure: .85, saturation: 1.12, tint: '#ffffff', cloud: '#ffffff'
  },
  golden: {
    key: [235, 10], keyColor: '#ffb560', keyPower: 3.4, sun: [235, 8], glow: '#ffb35c', glowPower: 1.35,
    zenith: '#36599a', horizon: '#f5c88a', below: '#8b7b7c', ambSky: '#7d95c8', ambGround: '#6b5244', ambPower: .5,
    fog: .0095, haze: .035, stars: 0, moon: 0, moonDir: [250, 20], aurora: 0, sunDisc: 1, snow: .05,
    exposure: 1, saturation: 1.08, tint: '#fff2e2', cloud: '#ffd29a'
  },
  dusk: {
    key: [258, 3], keyColor: '#ff806c', keyPower: 1.6, sun: [258, -2], glow: '#ff6f74', glowPower: 1.2,
    zenith: '#221d4c', horizon: '#df727b', below: '#4a3552', ambSky: '#5a5aa6', ambGround: '#3a2a3e', ambPower: .75,
    fog: .009, haze: .06, stars: .35, moon: .6, moonDir: [100, 18], aurora: 0, sunDisc: 0, snow: .2,
    exposure: 1.1, saturation: 1.05, tint: '#fff0f6', cloud: '#e59aa6'
  },
  night: {
    key: [140, 34], keyColor: '#a8bdff', keyPower: 1.05, sun: [320, -25], glow: '#3b4f9e', glowPower: .2,
    zenith: '#03050e', horizon: '#16224a', below: '#0a0e20', ambSky: '#2c3d7a', ambGround: '#0e1020', ambPower: .7,
    fog: .010, haze: .05, stars: 1, moon: 1, moonDir: [140, 34], aurora: 1, sunDisc: 0, snow: .8,
    exposure: 1.2, saturation: .95, tint: '#eef2ff', cloud: '#6d7fb8'
  }
};
export const TIMES = ['dawn', 'morning', 'noon', 'golden', 'dusk', 'night'];

const prepare = raw => {
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[name] = hexToLinear(value);
    else if (Array.isArray(value)) out[name] = direction(value[0], value[1]);
    else out[name] = value;
  }
  out.keyColor = out.keyColor.map(c => c * raw.keyPower);
  out.glow = out.glow.map(c => c * raw.glowPower);
  out.ambSky = out.ambSky.map(c => c * raw.ambPower);
  out.ambGround = out.ambGround.map(c => c * raw.ambPower);
  return out;
};
export const PALETTES = Object.fromEntries(Object.entries(RAW).map(([name, raw]) => [name, prepare(raw)]));

export function blend(a, b, t) {
  const out = {};
  for (const name in a) {
    const x = a[name], y = b[name];
    out[name] = Array.isArray(x) ? mix3(x, y, t) : lerp(x, y, t);
  }
  for (const name of ['key', 'sun', 'moonDir']) out[name] = normalize(out[name]);
  return out;
}
