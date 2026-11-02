import { TAU, lerp, clamp, easeInOut, wrapAngle, add, sub, scale, normalize, cross, mix3 } from './math.js';

// Poses are cylindrical around the summit axis (angle, radius, height) plus a look-at target,
// so travelling between camps turns around the mountain instead of cutting through it.
export const eyeOf = pose => [Math.cos(pose.angle) * pose.radius, pose.y, Math.sin(pose.angle) * pose.radius];

export function idlePose(time) {
  return { angle: 2.2 + time * TAU / 100, radius: 25, y: 6.4 + Math.sin(time * .19) * .4, target: [0, 5.3, 0] };
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
  const eye = eyeOf(pose);
  const forward = normalize(sub(aim, eye)), right = normalize(cross(forward, [0, 1, 0]));
  const distance = Math.hypot(...sub(aim, eye));
  pose.target = add(aim, layout === 'side' ? scale(right, -distance * .16) : [0, -distance * .12, 0]);
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

export function clampToGround(eye, terrain) {
  const ground = terrain.height(eye[0], eye[2]) + .7;
  return eye[1] < ground ? [eye[0], ground, eye[2]] : eye;
}
