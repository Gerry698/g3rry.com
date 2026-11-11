import { TAU, lerp, clamp, smoothstep, easeInOut, wrapAngle, add, sub, scale, normalize, cross, mix3 } from './math.js';

// Poses are cylindrical around the summit axis (angle, radius, height) plus a look-at target,
// so travelling between camps turns around the mountain instead of cutting through it.
// Vertical field of view in degrees: wider on portrait screens, where the mountain is framed taller than wide.
// inside: in the chamber of the Heart, a wider lens, so the rock closes round the frame.
export const FOV = { portrait: 58, landscape: 40, inside: { portrait: 82, landscape: 58 } };

export const eyeOf = pose => [Math.cos(pose.angle) * pose.radius, pose.y, Math.sin(pose.angle) * pose.radius];

export function idlePose(time) {
  return { angle: 2.2 + time * TAU / 100, radius: 25, y: 6.4 + Math.sin(time * .19) * .4, target: [0, 5.3, 0] };
}

// Below the cloud deck, across the river from the waterfall, looking up the mountain: where the sky menu takes the
// lens, so the valley's own hour and weather show in full. Framed like a camp, beside the text or above it.
export function valleyPose(layout) {
  const pose = { angle: 1.4, radius: 15, y: 1.85 }, aim = [-.5, 4.2, 3];
  return { ...pose, target: frameAside(eyeOf(pose), aim, layout) };
}

// The free camera orbits a point on the summit axis: azimuth, elevation and distance, kept within reach. Low enough,
// and far enough out, the lens is under the clouds.
export const ORBIT = { center: 4.6, near: 10, far: 44, low: -.07, high: 1.4 };
export const orbitPose = ({ az, el, dist }) => ({ angle: az, radius: dist * Math.cos(el), y: ORBIT.center + dist * Math.sin(el), target: [0, ORBIT.center, 0] });
export function orbitOf(eye) {
  const dist = Math.hypot(eye[0], eye[1] - ORBIT.center, eye[2]);
  return { az: Math.atan2(eye[2], eye[0]), el: Math.asin(clamp((eye[1] - ORBIT.center) / dist, -1, 1)), dist };
}

// Moves the aim so the subject sits right of centre ('side', text on the left) or in the upper middle ('stack').
function frameAside(eye, aim, layout) {
  const forward = normalize(sub(aim, eye)), right = normalize(cross(forward, [0, 1, 0]));
  const distance = Math.hypot(...sub(aim, eye));
  return add(aim, layout === 'side' ? scale(right, -distance * .16) : [0, -distance * .12, 0]);
}

// Each camp is framed from outside the massif, a little ahead along the climb, looking up towards the
// summit so the camp sits low in frame with the mountain and sky above it.
// layout 'side': the camp sits right of centre (text on the left); 'stack': camp in the upper middle (text below).
export function stationPose(camp, summit, progress, terrain, layout) {
  const at = [camp.x, camp.y, camp.z];
  const preferred = camp.summit ? .5 : .22;
  const frame = offset => camp.summit
    ? { pose: { angle: camp.angle + offset, radius: 9, y: camp.y - 2.6 }, aim: [camp.x, camp.y - .9, camp.z] }
    : { pose: { angle: camp.angle + offset, radius: camp.r + lerp(8.5, 6.5, progress), y: camp.y + .75 + progress * .45 }, aim: mix3(at, [summit.x, summit.y, summit.z], .3) };
  // A shoulder peak can stand right in front of a camp. Try bearings either side of the preferred one
  // and keep the view that needs the least lifting, so the camera looks past the shoulder, not over it.
  let best = null;
  for (const offset of camp.summit ? [.5, .25, .75, 1] : [.22, .4, .05, .6, -.12, .8, -.3, 1]) {
    const view = frame(offset);
    const score = lift(view.pose, at, terrain) + Math.abs(offset - preferred) * 4;
    if (!best || score < best.score) best = { ...view, score };
  }
  const { pose, aim } = best;
  pose.target = frameAside(eyeOf(pose), aim, layout);
  return pose;
}

// Raises and pulls back the pose until nothing stands between the lens and the camp; returns the steps taken.
function lift(pose, at, terrain) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const eye = eyeOf(pose);
    let blocked = terrain.height(eye[0], eye[2]) > eye[1] - .6;
    for (let s = 1; s < 24 && !blocked; s++) {
      const p = mix3(eye, at, s / 24);
      blocked = terrain.height(p[0], p[2]) > p[1] + .05 && s < 22;
    }
    if (!blocked) return attempt;
    pose.y += .45; pose.radius += .55;
  }
  return 14;
}

// Gentle drift while resting so the scene never freezes.
export function sway(pose, time, pointer = [0, 0]) {
  return { ...pose, angle: pose.angle + Math.sin(time * .23) * .012 + pointer[0] * .018, y: pose.y + Math.sin(time * .31) * .05 - pointer[1] * .12 };
}

export function travelTime(from, to) {
  const turn = Math.abs(wrapAngle(to.angle - from.angle));
  return clamp(1.25 + turn * .55 + Math.abs(to.y - from.y) * .04, 1.3, 2.9);
}

// Shortest way round, with a slight outward and upward arc mid-flight.
export function interpolate(from, to, t) {
  const e = easeInOut(t), arc = Math.sin(Math.PI * e);
  const delta = wrapAngle(to.angle - from.angle);
  return {
    angle: from.angle + delta * e,
    radius: lerp(from.radius, to.radius, e) + arc * Math.min(3, Math.abs(delta) * 1.6),
    y: lerp(from.y, to.y, e) + arc * Math.min(1.4, Math.abs(delta) * .7),
    target: mix3(from.target, to.target, easeInOut(clamp(t * 1.08 - .04, 0, 1)))
  };
}

// ---- Off the trail (beyond.js) -----------------------------------------------------------------------------------

// Moonward. moon: the chapter's places (beyond.js, spaceMoon). Out there a pose is an eye and a target, as in the Heart.
// At rest the lens is low over the moon's far side, looking back along the way it came: the moon's edge curves across
// the lower part of the frame and home stands a little above it. It drifts a very little along its orbit.
export function spacePose(moon, time, pointer, layout) {
  const { center, radius, toward, up, side, home } = moon;
  const lean = (21 + Math.sin(time * .045) * 1.3 - pointer[1] * .8) * Math.PI / 180, out = radius * 1.3;
  const eye = add(center, add(scale(up, out * Math.cos(lean)), add(scale(toward, out * Math.sin(lean)), scale(side, radius * pointer[0] * -.04))));
  const back = normalize(sub(home.center, eye));
  // Aimed a little under home, so the moon's edge is in the frame; home sits right of centre beside the words, or above them.
  const aim = add(back, add(scale(up, layout === 'side' ? -.085 : -.2), scale(side, layout === 'side' ? .15 : 0)));
  return { eye, target: add(eye, scale(aim, 100)) };
}
// A smooth path through points however unevenly they are spaced (here from a few units apart on the mountain to
// hundreds on the way to the moon): centripetal Catmull-Rom, which never loops or overshoots. u runs from 0 at the
// first point to n - 1 at the last.
function spline(points) {
  const n = points.length, ends = [sub(scale(points[0], 2), points[1]), ...points, sub(scale(points[n - 1], 2), points[n - 2])];
  const knot = (a, b) => Math.max(Math.sqrt(Math.hypot(...sub(b, a))), 1e-4);
  return u => {
    const i = clamp(Math.floor(u), 0, n - 2), [p0, p1, p2, p3] = ends.slice(i, i + 4);
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3), t = lerp(t1, t2, clamp(u - i, 0, 1));
    const at = (a, b, ta, tb) => mix3(a, b, (t - ta) / (tb - ta));
    const a1 = at(p0, p1, 0, t1), a2 = at(p1, p2, t1, t2), a3 = at(p2, p3, t2, t3);
    return at(at(a1, a2, 0, t2), at(a2, a3, t1, t3), t1, t2);
  };
}
// A smooth, never-backward curve through (times, values), still at both ends: how far along the path the lens is at
// each moment, given how far it should be by each of the path's points (monotone cubic, Fritsch-Butland slopes).
function timing(times, values) {
  const n = times.length, slopes = new Array(n).fill(0), h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(times[i + 1] - times[i]); d.push((values[i + 1] - values[i]) / h[i]); }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    slopes[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return t => {
    t = clamp(t, 0, 1);
    let i = 0;
    while (i < n - 2 && t > times[i + 1]) i++;
    const s = (t - times[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * values[i] + (s3 - 2 * s2 + s) * h[i] * slopes[i] + (-2 * s3 + 3 * s2) * values[i + 1] + (s3 - s2) * h[i] * slopes[i + 1];
  };
}
const turnTo = (a, b, w) => { const m = mix3(a, b, w), l = Math.hypot(...m); return l > 1e-5 ? scale(m, 1 / l) : b; };
const facing = pose => normalize(sub(pose.target, pose.eye));

// Moonward's flight, planned once as it sets off. ground: the view on the mountain it leaves from (out) or comes home
// to (back), an eye and a target; rest: the view at the moon (spacePose) when the flight was planned; moon: the
// chapter's places (beyond.js, spaceMoon), whose `toward` runs from the summit over the crest ahead of that view.
//   Out: it eases forward, rises just over the summit's crest and skims on, level, as the far side falls away under
//   it, gathering speed; the moon shows over the horizon ahead and the lens lifts and goes for it, faster and faster,
//   past its edge, then slows round on to the far side and turns, last of all, to look home.
//   Back: it leaves the far side looking home, falls the long way back fast, slows as the mountain comes up, and
//   circles round the summit, looking at it all the while, to settle in the view it is coming home to.
// The returned function gives the pose at t (0 to 1 of the flight's time), with `rush`, how hard it is going (the lens
// widens with it), and is handed the live rest pose so the end of the flight meets the slow drift there.
export function planFlight(ground, rest, moon, terrain, back = false) {
  const { center, radius, toward, up, side, home } = moon, summit = home.summit;
  const level = normalize([toward[0], 0, toward[2]]), top = add(summit, [0, .3, 0]);
  const clear = (p, lift) => [p[0], Math.max(p[1], terrain.height(p[0], p[2]) + lift), p[2]];
  const near = add(center, add(scale(side, -radius * 1.5), add(scale(up, radius * .9), scale(toward, -radius * 1.25))));
  let points, times;
  if (!back) {
    const crest = clear(add(summit, add(scale(level, 1.8), [0, 2.1, 0])), 1.3);
    const beyond = clear(add(summit, add(scale(level, 13), [0, 1.7, 0])), 1.6);
    const climb = add(beyond, add(scale(toward, 36), scale(level, 4)));
    points = [ground.eye, crest, beyond, climb, near, rest.eye];
    times = [0, .2, .37, .49, .75, 1];
  } else {
    // Round the summit on the side the view home is on.
    const offset = sub(ground.eye, summit), across = normalize(cross([0, 1, 0], level));
    const turn = Math.sign(offset[0] * across[0] + offset[2] * across[2]) || 1;
    const descent = add(summit, add(scale(toward, 70), scale(level, 10)));
    const front = clear(add(summit, add(scale(level, 13), [0, 4.5, 0])), 2);
    const round = clear(add(summit, add(scale(across, 11 * turn), add(scale(level, 1), [0, 1.8, 0]))), 1.5);
    points = [rest.eye, near, descent, front, round, ground.eye];
    times = [0, .24, .5, .67, .85, 1];
  }
  const path = spline(points), last = points.length - 1;
  // Lengths along the path, to move by distance rather than by the spline's own parameter.
  const STEPS = 48, lengths = [0];
  let previous = path(0);
  for (let k = 1; k <= last * STEPS; k++) { const p = path(k / STEPS); lengths.push(lengths[k - 1] + Math.hypot(...sub(p, previous))); previous = p; }
  const total = lengths.at(-1), along = timing(times, points.map((_, k) => lengths[k * STEPS]));
  const placeAt = s => {
    s = clamp(s, 0, total);
    let low = 0, high = lengths.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (lengths[mid] < s) low = mid; else high = mid; }
    const f = (s - lengths[low]) / Math.max(lengths[high] - lengths[low], 1e-6);
    return path((low + f) / STEPS);
  };
  const plannedRest = rest.eye, groundLook = facing(ground);
  return (t, live) => {
    const s = along(t), drift = sub(live.eye, plannedRest);
    let eye = placeAt(s), look;
    if (!back) {
      eye = add(eye, scale(drift, smoothstep(.75, 1, t)));
      // Where the path goes next, a little way on (farther on the faster it goes), is where it looks.
      const ahead = sub(placeAt(s + 3 + s * .6), eye), way = Math.hypot(...ahead) > 1e-3 ? normalize(ahead) : facing(live);
      look = turnTo(groundLook, way, smoothstep(0, .18, t));
      look = turnTo(look, normalize(sub(center, eye)), smoothstep(.36, .52, t));
      look = turnTo(look, facing(live), smoothstep(.7, .985, t));
    } else {
      eye = add(eye, scale(drift, 1 - smoothstep(0, .25, t)));
      look = turnTo(facing(live), normalize(sub(top, eye)), smoothstep(.02, .22, t));
      look = turnTo(look, groundLook, smoothstep(.86, 1, t));
    }
    const rush = Math.sin(Math.PI * (back ? smoothstep(.12, .62, t) : smoothstep(.38, .86, t))) ** 2;
    return { eye, target: add(eye, scale(look, 100)), rush };
  };
}

// The Heart, from inside: a slow walk round it, from a little above, looking down past it into the pool that mirrors it.
// Poses in the chamber are an eye and a target (the lens is nowhere near the summit axis's ground).
export function heartPose(heart, orbit, time, pointer, layout) {
  const a = 4.05 + time * TAU / 170 + pointer[0] * .05;
  const eye = [heart[0] + Math.cos(a) * orbit, heart[1] + .5 + Math.sin(time * .31) * .04 - pointer[1] * .1, heart[2] + Math.sin(a) * orbit];
  const forward = normalize(sub(heart, eye)), right = normalize(cross(forward, [0, 1, 0]));
  return { eye, target: layout === 'side' ? add(heart, add(scale(right, -.6), [0, -.5, 0])) : add(heart, [0, -.75, 0]) };
}
// Coming in (t from 0 to 1) the lens starts back against the wall, a little high, and settles into the walk.
export function enterHeart(pose, heart, t) {
  const e = 1 - Math.pow(1 - clamp(t, 0, 1), 3), out = normalize([pose.eye[0] - heart[0], 0, pose.eye[2] - heart[2]]);
  return { eye: add(pose.eye, add(scale(out, .62 * (1 - e)), [0, .4 * (1 - e), 0])), target: mix3(heart, pose.target, e) };
}

// The door of the Heart, from outside: `door` is the lens on its threshold looking in, `approach` stands back across
// the pool, square to it. cave: { x, y, z, out } (beyond.js, placeCave).
const poseAt = (eye, target) => ({ angle: Math.atan2(eye[2], eye[0]), radius: Math.hypot(eye[0], eye[2]), y: eye[1], target });
export function doorPoses(cave) {
  const at = (ahead, up) => [cave.x + cave.out[0] * ahead, cave.y + up, cave.z + cave.out[2] * ahead];
  return { approach: poseAt(at(2.5, .72), at(0, .3)), door: poseAt(at(.42, .33), at(-1.2, .3)) };
}
const between = (a, b, e) => ({ angle: a.angle + wrapAngle(b.angle - a.angle) * e, radius: lerp(a.radius, b.radius, e), y: lerp(a.y, b.y, e), target: mix3(a.target, b.target, e) });
// Going in: round the mountain to the approach, a breath, then straight at the door, faster and faster.
export function diveIn(from, { approach, door }, t) {
  return t < .64 ? interpolate(from, approach, t / .64) : between(approach, door, ((t - .64) / .36) ** 2);
}
// Coming out: back from the door, slowing, then away to wherever the climb goes on.
export function diveOut({ approach, door }, to, t) {
  return t < .36 ? between(door, approach, 1 - (1 - t / .36) ** 2) : interpolate(approach, to, (t - .36) / .64);
}

export function clampToGround(eye, terrain) {
  const ground = terrain.height(eye[0], eye[2]) + .7;
  return eye[1] < ground ? [eye[0], ground, eye[2]] : eye;
}
