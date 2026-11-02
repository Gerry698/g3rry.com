// Atlas data for the lab, built once on this machine and committed to content/phantom/atlas/.
//   node atlas.mjs globe            Natural Earth land (public domain) -> land.bin, an equirectangular land mask
//   node atlas.mjs lidar [cloud]    airborne LiDAR for each cloud listed under a site in content/phantom.json
//   node atlas.mjs frames           camera stations for the atlas stops -> frames.json
// LiDAR comes from Entwine Point Tiles (EPT) on NOAA's and USGS's open data buckets: only the octree nodes that cover a
// cloud's box are downloaded (cached in .cache/ept), decoded with laz-perf, thinned on a voxel grid, and stored in a
// local east-north-up frame around the site origin.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Las } from 'copc';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cacheDir = path.join(root, '.cache');
const outDir = path.join(root, 'content/phantom/atlas');
const lab = JSON.parse(await readFile(path.join(root, 'content/phantom.json'), 'utf8'));
const rad = Math.PI / 180;

async function cached(url, file) {
  try { return await readFile(file); } catch {}
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(response.status + ' ' + url);
      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      return bytes;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }
}

// ---- Geodesy: UTM (GRS80, which NAD83(2011) uses) and a local east-north-up frame ----------------------
const A = 6378137, F = 1 / 298.257222101, K0 = .9996, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
export function utmForward(lat, lon, zone) {
  const phi = lat * rad, lambda0 = (zone * 6 - 183) * rad;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin), t = tan * tan, c = EP2 * cos * cos, a = cos * (lon * rad - lambda0);
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
  return [
    500000 + K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5 / 120),
    K0 * (m + n * tan * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6 / 720))
  ];
}
// Grid north differs from true north by the meridian convergence; the frame is rotated so +north is true north.
export function frame(origin, zone) {
  const [e0, n0] = utmForward(origin[0], origin[1], zone);
  const gamma = Math.atan(Math.tan((origin[1] - (zone * 6 - 183)) * rad) * Math.sin(origin[0] * rad));
  const cg = Math.cos(gamma), sg = Math.sin(gamma);
  const fromLatLon = (lat, lon) => { const [e, n] = utmForward(lat, lon, zone); return [(e - e0) * cg + (n - n0) * sg, -(e - e0) * sg + (n - n0) * cg]; };
  return {
    fromGrid: (e, n) => [(e - e0) * cg + (n - n0) * sg, -(e - e0) * sg + (n - n0) * cg],
    toGrid: (east, north) => [e0 + east * cg - north * sg, n0 + east * sg + north * cg],
    fromLatLon,
    // Inverse by a few Newton steps; the frame is so close to a plane that three are plenty.
    toLatLon(east, north) {
      let lat = origin[0] + north / 111132, lon = origin[1] + east / (111320 * Math.cos(origin[0] * rad));
      for (let i = 0; i < 4; i++) {
        const [e, n] = fromLatLon(lat, lon);
        lat += (north - n) / 111132;
        lon += (east - e) / (111320 * Math.cos(lat * rad));
      }
      return [lat, lon];
    }
  };
}
// Web Mercator (EPSG:3857), which USGS 3DEP's EPT copies use, on the WGS84 sphere radius.
const mercator = {
  toLatLon: (x, y) => [(2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) / rad, x / A / rad],
  fromLatLon: (lat, lon) => [A * lon * rad, A * Math.log(Math.tan(Math.PI / 4 + lat * rad / 2))]
};
// The source grid of a site's EPT, mapped onto the site's local frame (always a UTM-based east-north-up frame).
function sourceGrid(site, local) {
  if (site.lidar.srs !== 'EPSG:3857') return { fromGrid: local.fromGrid, toGrid: local.toGrid };
  return {
    fromGrid: (x, y) => local.fromLatLon(...mercator.toLatLon(x, y)),
    toGrid: (east, north) => mercator.fromLatLon(...local.toLatLon(east, north))
  };
}

// ---- Globe -----------------------------------------------------------------------------------------
async function globe() {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
  const land = JSON.parse(await cached(url, path.join(cacheDir, 'natural-earth/ne_50m_land.geojson')));
  const W = 1440, H = 720;
  const mask = new Uint8Array(W * H);
  // Even-odd scanline fill of every ring at the centre of each row of cells.
  for (let row = 0; row < H; row++) {
    const lat = 90 - (row + .5) * 180 / H;
    const crossings = [];
    for (const feature of land.features) {
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const rings of polygons) for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x1, y1] = ring[j], [x2, y2] = ring[i];
          if ((y1 > lat) !== (y2 > lat)) crossings.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] + 180) / 360 * W - .5)), to = Math.min(W - 1, Math.floor((crossings[k + 1] + 180) / 360 * W - .5));
      for (let col = from; col <= to; col++) mask[row * W + col] = 255;
    }
  }
  const header = Buffer.alloc(4);
  header.writeUInt16LE(W, 0);
  header.writeUInt16LE(H, 2);
  await mkdir(outDir, { recursive: true });
  const file = gzipSync(Buffer.concat([header, Buffer.from(mask)]), { level: 9 });
  await writeFile(path.join(outDir, 'land.bin'), file);
  console.log('land.bin', W + 'x' + H, (file.length / 1024).toFixed(0) + ' KiB', 'land share', (mask.reduce((s, v) => s + (v ? 1 : 0), 0) / mask.length).toFixed(3));
}

// ---- LiDAR via EPT ---------------------------------------------------------------------------------
async function lidar(only) {
  for (const site of lab.sites) {
    if (!site.lidar) continue;
    const { ept: base, zone } = site.lidar;
    const ept = JSON.parse(await cached(base + 'ept.json', path.join(cacheDir, 'ept', site.id, 'ept.json')));
    const [bx0, by0, bz0, bx1] = ept.bounds;
    const cube = bx1 - bx0;
    const local = frame(site.origin, zone);
    const grid = sourceGrid(site, local);
    const hierarchy = {};
    async function loadHierarchy(key) {
      const part = JSON.parse(await cached(base + 'ept-hierarchy/' + key + '.json', path.join(cacheDir, 'ept', site.id, 'hierarchy', key + '.json')));
      Object.assign(hierarchy, part);
    }
    await loadHierarchy('0-0-0-0');
    for (const cloud of site.lidar.clouds) {
      if (only && cloud.id !== only) continue;
      // The cloud's box in the local frame, then in grid coordinates for node selection.
      const [cx, cy] = local.fromLatLon(cloud.center[0], cloud.center[1]);
      const half = [cloud.size[0] / 2, cloud.size[1] / 2];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].map(([sx, sy]) => grid.toGrid(cx + sx * half[0], cy + sy * half[1]));
      const gx0 = Math.min(...corners.map(c => c[0])), gx1 = Math.max(...corners.map(c => c[0]));
      const gy0 = Math.min(...corners.map(c => c[1])), gy1 = Math.max(...corners.map(c => c[1]));
      const wanted = [];
      const visit = async (d, x, y, z) => {
        const key = d + '-' + x + '-' + y + '-' + z;
        if (hierarchy[key] === -1) await loadHierarchy(key);
        if (!hierarchy[key]) return;
        const s = cube / 2 ** d, nx0 = bx0 + x * s, ny0 = by0 + y * s;
        if (nx0 > gx1 || nx0 + s < gx0 || ny0 > gy1 || ny0 + s < gy0) return;
        wanted.push(key);
        if (d < cloud.depth) for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) await visit(d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz);
      };
      await visit(0, 0, 0, 0);
      const total = wanted.reduce((sum, key) => sum + hierarchy[key], 0);
      console.log(cloud.id, wanted.length, 'nodes,', (total / 1e6).toFixed(2), 'M points in them');
      if (process.env.DRY) continue;
      // Voxel thinning keeps one point per cell, so dense and sparse flight lines end up even.
      const cell = cloud.spacing;
      const voxels = new Map();
      const classes = {};
      let seen = 0;
      // Some surveys file a structure under the wrong class (the 2010 Golden Gate survey puts the bridge in medium
      // vegetation). A site can name a corridor whose returns above a height are re-filed, and kept at a finer spacing.
      const structures = (site.lidar.structures || []).map(item => {
        const a = local.fromLatLon(...item.from), b = local.fromLatLon(...item.to), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return { ...item, a, length, u: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
      });
      const structureAt = (east, north, z) => structures.find(item => {
        const de = east - item.a[0], dn = north - item.a[1], s = de * item.u[0] + dn * item.u[1];
        return z >= item.above && s >= 0 && s <= item.length && Math.abs(de * item.u[1] - dn * item.u[0]) <= item.width / 2;
      });
      for (const [index, key] of wanted.entries()) {
        const file = await cached(base + 'ept-data/' + key + '.laz', path.join(cacheDir, 'ept', site.id, 'data', key + '.laz'));
        const header = Las.Header.parse(file);
        const records = await Las.PointData.decompressFile(file);
        const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
        const extended = header.pointDataRecordFormat >= 6;
        for (let i = 0; i < header.pointCount; i++) {
          const o = i * header.pointDataRecordLength;
          const gx = view.getInt32(o, true) * header.scale[0] + header.offset[0];
          const gy = view.getInt32(o + 4, true) * header.scale[1] + header.offset[1];
          if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) continue;
          const z = view.getInt32(o + 8, true) * header.scale[2] + header.offset[2];
          let cls = extended ? view.getUint8(o + 16) : view.getUint8(o + 15) & 31;
          const [east, north] = grid.fromGrid(gx, gy);
          if (Math.abs(east - cx) > half[0] || Math.abs(north - cy) > half[1]) continue;
          const tally = classes[cls] || (classes[cls] = [0, -Infinity]);
          tally[0]++;
          tally[1] = Math.max(tally[1], z);
          if (cls === 7 || cls === 18 || z < -5 || z > 600) continue;
          const structure = structures.length && structureAt(east, north, z);
          if (structure) cls = structure.class;
          // Water returns are thinned harder: enough to show the surface, not enough to drown the city.
          const thin = structure ? structure.spacing || cell : cls === 9 ? cloud.waterCell || cell * 3 : cell;
          const k = Math.floor(east / thin) + ',' + Math.floor(north / thin) + ',' + Math.floor(z / thin) + (structure ? 's' : cls === 9 ? 'w' : '');
          seen++;
          if (!voxels.has(k)) voxels.set(k, [east, north, z, cls, view.getUint16(o + 12, true)]);
        }
        if (index % 25 === 0) console.log('  ' + (index + 1) + '/' + wanted.length + ' nodes, ' + voxels.size + ' kept of ' + seen);
      }
      console.log('  classes (count, highest z):', Object.entries(classes).map(([cls, [n, top]]) => cls + ': ' + n + ', ' + top.toFixed(1)).join(' | '));
      let points = [...voxels.values()];
      if (points.length > cloud.maxPoints) {
        // Named structures survive the cut whole; everything else is sampled at random to fill the rest.
        const kept = structures.length ? points.filter(p => structures.some(item => item.class === p[3])) : [];
        const rest = kept.length ? points.filter(p => !structures.some(item => item.class === p[3])) : points;
        for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
        points = kept.concat(rest.slice(0, cloud.maxPoints - kept.length));
        if (kept.length) console.log('  kept', kept.length, 'structure points whole');
      }
      await writeCloud(cloud.id, points);
    }
  }
}

// Points are quantised to 16 bits over their box, sorted along a Morton curve so neighbours sit together,
// stored as planes of deltas and gzipped. Intensities are scaled per cloud to one byte.
async function writeCloud(id, points) {
  const min = [Infinity, Infinity, Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k], p[k]);
  const max = [0, 1, 2].map(k => points.reduce((m, p) => Math.max(m, p[k]), -Infinity));
  const size = max.map((m, k) => Math.max(m - min[k], 1e-3));
  const q = points.map(p => [0, 1, 2].map(k => Math.round((p[k] - min[k]) / size[k] * 65535)));
  // 10 bits per axis keeps the interleave inside JavaScript's 32-bit bitwise range.
  const spread = v => { v &= 0x3ff; v = (v | (v << 16)) & 0x030000ff; v = (v | (v << 8)) & 0x0300f00f; v = (v | (v << 4)) & 0x030c30c3; v = (v | (v << 2)) & 0x09249249; return v >>> 0; };
  const morton = p => spread(p[0] >> 6) * 4 + spread(p[1] >> 6) * 2 + spread(p[2] >> 6);
  const order = q.map((p, i) => [morton(p), i]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
  const n = points.length;
  const intensities = points.map(p => p[4]).sort((a, b) => a - b);
  const top = intensities[Math.floor(n * .99)] || 1;
  const body = Buffer.alloc(n * 8);
  for (let k = 0; k < 3; k++) {
    let previous = 0;
    order.forEach((i, j) => { body.writeUInt16LE((q[i][k] - previous) & 0xffff, (k * n + j) * 2); previous = q[i][k]; });
  }
  order.forEach((i, j) => {
    body[6 * n + j] = points[i][3];
    body[7 * n + j] = Math.min(255, Math.round(points[i][4] / top * 255));
  });
  const json = Buffer.from(JSON.stringify({ count: n, min, size }));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  await mkdir(outDir, { recursive: true });
  const file = gzipSync(Buffer.concat([head, json, body]), { level: 9 });
  await writeFile(path.join(outDir, id + '.bin'), file);
  console.log(id + '.bin', n, 'points', (file.length / 1048576).toFixed(2) + ' MiB', 'box', size.map(v => v.toFixed(0)).join(' x '));
}

// Camera stations for the atlas stops, solved in each site's local frame so they line up with the clouds exactly.
// A vantage is either a target seen from a bearing and distance (the ferry, placed from the photograph's own geometry)
// or a position with an azimuth and pitch. The look point sits at the subject's distance, which is where the lens focuses.
async function frames() {
  const result = { clouds: {}, stops: {} };
  for (const site of lab.sites) {
    if (!site.lidar) continue;
    const local = frame(site.origin, site.lidar.zone);
    for (const cloud of site.lidar.clouds) result.clouds[cloud.id] = { site: site.id, center: local.fromLatLon(cloud.center[0], cloud.center[1]).map(v => +v.toFixed(2)) };
    for (const stop of lab.atlas.stops.filter(item => item.site === site.id && item.vantage)) {
      const v = stop.vantage;
      let camera, look;
      if (v.target) {
        const [te, tn] = local.fromLatLon(v.target[0], v.target[1]);
        const b = v.bearing * rad;
        camera = [te + v.distance * Math.sin(b), tn + v.distance * Math.cos(b), v.height];
        // The subject is rarely centred: `frame` gives the optical axis relative to the line toward it, in degrees right and up.
        const [right, up] = v.frame || [0, 0];
        const a = b + Math.PI + right * rad, p = Math.atan2(v.target[2] - v.height, v.distance) + up * rad, d = v.distance;
        look = [camera[0] + d * Math.sin(a) * Math.cos(p), camera[1] + d * Math.cos(a) * Math.cos(p), camera[2] + d * Math.sin(p)];
      } else {
        const [e, n] = local.fromLatLon(v.at[0], v.at[1]);
        const a = v.azimuth * rad, p = v.pitch * rad, d = v.subject || 100;
        camera = [e, n, v.height];
        look = [e + d * Math.sin(a) * Math.cos(p), n + d * Math.cos(a) * Math.cos(p), v.height + d * Math.sin(p)];
      }
      result.stops[stop.id] = { camera: camera.map(x => +x.toFixed(2)), look: look.map(x => +x.toFixed(2)) };
    }
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'frames.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

const [command, argument] = process.argv.slice(2);
if (command === 'globe') await globe();
else if (command === 'lidar') await lidar(argument);
else if (command === 'frames') await frames();
else console.log('Usage: node atlas.mjs globe | lidar [cloud] | frames');
