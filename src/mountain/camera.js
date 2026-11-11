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
// How far along the flight the lens is at time t. Not an even ease: it comes off the mark gently, is fastest a third
// of the way through, and spends the rest slowing into its orbit, the way anything arriving at a moon does.
const PACE = (() => {
  const table = [0];
  for (let i = 1; i <= 64; i++) { const x = (i - .5) / 64; table.push(table[i - 1] + x ** 1.3 * (1 - x) ** 2); }
  return table.map(v => v / table[64]);
})();
const pace = t => { const x = clamp(t, 0, 1) * 64, i = Math.min(63, Math.floor(x)); return lerp(PACE[i], PACE[i + 1], x - i); };
// The flight between a view on the mountain (ground: an eye and a target) and that rest, t from 0 on the ground to 1
// out there. The lens climbs looking up at the moon, swings wide round its side with it filling the frame, and only
// then, slowly, turns to look home.
export function spaceFlight(ground, rest, moon, t) {
  const { center, radius, toward, up, side } = moon, e = pace(t), f = 1 - e;
  const wide = add(center, add(scale(side, -radius * 2.4), add(scale(up, radius * 1.5), scale(toward, -radius * .9))));
  const eye = [0, 1, 2].map(i => f * f * ground.eye[i] + 2 * f * e * wide[i] + e * e * rest.eye[i]);
  // Which way it looks is blended as directions, not as points: from the view it left, to the moon, to the view home.
  const facing = (from, to) => normalize(sub(to, from));
  const first = facing(ground.eye, ground.target), moonward = facing(eye, center), home = facing(rest.eye, rest.target);
  const look = e < .5 ? mix3(first, moonward, smoothstep(0, .16, e)) : mix3(moonward, home, smoothstep(.7, .995, e));
  return { eye, target: add(eye, scale(normalize(look), 100)) };
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
