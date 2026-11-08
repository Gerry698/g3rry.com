import { program, precompile, vertexArray, texture, framebuffer, renderbuffer } from './gl.js';
import * as shaders from './shaders.js';
import { orthographic, lookAt, multiply, add, scale, dot, TAU } from './math.js';
import { createWeather, weatherSources } from './weather.js';

// A low-poly pine: a short trunk under three stacked six-sided cones. aPart is 0 for bark, 1 for needles.
function treeGeometry() {
  const positions = [], parts = [];
  const cone = (y0, y1, radius, part, sides = 6, top = 0) => {
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * TAU, a1 = (i + 1) / sides * TAU;
      const p0 = [Math.cos(a0) * radius, y0, Math.sin(a0) * radius], p1 = [Math.cos(a1) * radius, y0, Math.sin(a1) * radius];
      const q0 = [Math.cos(a0) * top, y1, Math.sin(a0) * top], q1 = [Math.cos(a1) * top, y1, Math.sin(a1) * top];
      positions.push(...p0, ...q0, ...p1);
      if (top > 0) positions.push(...p1, ...q0, ...q1);
      // Underside, so the skirt of each tier is closed from below.
      positions.push(0, y0, 0, ...p0, ...p1);
      parts.push(...Array(top > 0 ? 9 : 6).fill(part));
    }
  };
  cone(0, .3, .055, 0, 5, .045);
  cone(.16, .62, .34, 1);
  cone(.4, .85, .26, 1);
  cone(.62, 1.06, .17, 1);
  return { positions: new Float32Array(positions), parts: new Float32Array(parts), count: positions.length / 3 };
}

const LANTERN = [1, .6, .26];
const NEAR = .05, FAR = 600;

// Every program the renderer draws with, as [vertex shader, fragment shader] names in shaders.js.
const PROGRAMS = {
  terrain: ['terrainVertex', 'terrainFragment'], trees: ['treeVertex', 'treeFragment'], props: ['propVertex', 'propFragment'],
  terrainDepth: ['terrainDepthVertex', 'depthFragment'], treeDepth: ['treeDepthVertex', 'depthFragment'], sky: ['fullscreenVertex', 'skyFragment'],
  trail: ['trailVertex', 'trailFragment'], glow: ['glowVertex', 'glowFragment'], pillar: ['pillarVertex', 'pillarFragment'],
  cloud: ['cloudVertex', 'cloudFragment'], snow: ['snowVertex', 'snowFragment'], spark: ['sparkVertex', 'sparkFragment'],
  down: ['fullscreenVertex', 'downsampleFragment'], up: ['fullscreenVertex', 'upsampleFragment'], composite: ['fullscreenVertex', 'compositeFragment']
};
// Starts compiling them before the scene exists; createRenderer() then picks them up finished.
export const warmUp = gl => precompile(gl, Object.values(PROGRAMS).map(([vertex, fragment]) => [shaders[vertex], shaders[fragment]]).concat(weatherSources));

export function createRenderer(gl, scene, quality) {
  const float = Boolean(gl.getExtension('EXT_color_buffer_float'));
  const colorFormat = float ? gl.RGBA16F : gl.RGBA8, colorType = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const samples = Math.min(quality.samples, gl.getParameter(gl.MAX_SAMPLES));
  const programs = Object.fromEntries(Object.entries(PROGRAMS).map(([name, [vertex, fragment]]) => [name, program(gl, shaders[vertex], shaders[fragment], name)]));
  // Weather below the cloud deck; it adds the deck's puffs to scene.clouds, so it comes before the cloud buffers.
  const weather = createWeather(gl, scene, quality);

  const terrain = vertexArray(gl, [{ data: scene.mesh.positions, size: 3 }, { data: scene.mesh.colors, size: 4, type: gl.UNSIGNED_BYTE, normalized: true }]);
  const props = vertexArray(gl, [{ data: scene.props.positions, size: 3 }, { data: scene.props.colors, size: 4, type: gl.UNSIGNED_BYTE, normalized: true }, { data: scene.props.flags, size: 4 }]);
  const tree = treeGeometry();
  const treeCount = scene.trees.length / 6;
  const placement = new Float32Array(treeCount * 4), extra = new Float32Array(treeCount * 2);
  for (let i = 0; i < treeCount; i++) {
    placement.set(scene.trees.subarray(i * 6, i * 6 + 4), i * 4);
    extra.set(scene.trees.subarray(i * 6 + 4, i * 6 + 6), i * 2);
  }
  const trees = vertexArray(gl, [{ data: tree.positions, size: 3 }, { data: tree.parts, size: 1 }, { data: placement, size: 4, divisor: 1 }, { data: extra, size: 2, divisor: 1 }]);
  const trail = vertexArray(gl, [{ data: new Float32Array(scene.trail.flat()), size: 4, divisor: 1 }]);
  // One glow per camp, one for the climber, then the props' own lights (fire, lamps).
  const lights = scene.props.lights, lightCount = lights.length / 8;
  const glowCount = scene.camps.length + 1 + lightCount;
  const glowData = new Float32Array(glowCount * 4), glowColors = new Float32Array(glowCount * 4);
  const glows = vertexArray(gl, [{ data: glowData, size: 4, divisor: 1, usage: gl.DYNAMIC_DRAW }, { data: glowColors, size: 4, divisor: 1, usage: gl.DYNAMIC_DRAW }]);
  const cloudCount = scene.clouds.length / 5;
  const cloudOrder = Array.from({ length: cloudCount }, (_, i) => i), cloudDistance = new Float32Array(cloudCount);
  const cloudData = new Float32Array(cloudCount * 4), cloudSeeds = new Float32Array(cloudCount);
  const clouds = vertexArray(gl, [{ data: cloudData, size: 4, divisor: 1, usage: gl.DYNAMIC_DRAW }, { data: cloudSeeds, size: 1, divisor: 1, usage: gl.DYNAMIC_DRAW }]);
  const empty = gl.createVertexArray();
  // The Phantom mark arrives after start-up; until then the camp has no points.
  let spark = null;
  function setSparkShape(points) {
    spark = { array: vertexArray(gl, [{ data: points, size: 2 }]), count: points.length / 2 };
  }
  const black = texture(gl, 1, 1, { data: new Uint8Array(4) });
  const dummyDepth = texture(gl, 1, 1, { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });

  // The shadow map covers the massif only; the far ranges are always lit.
  const shadowSize = quality.shadow;
  const shadowMap = texture(gl, shadowSize, shadowSize, { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, compare: true });
  const shadowTarget = framebuffer(gl, { depth: shadowMap });
  let lightMatrix = null, shadowKey = null;
  function renderShadow(keyDir, target = shadowTarget) {
    const center = [0, 4.2, 0];
    const view = lookAt(add(center, scale(keyDir, 60)), center, Math.abs(keyDir[1]) > .98 ? [0, 0, 1] : [0, 1, 0]);
    lightMatrix = multiply(orthographic(-17, 17, -17, 17, 28, 96), view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, shadowSize, shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    programs.terrainDepth.use().set({ uLightViewProj: lightMatrix });
    gl.bindVertexArray(terrain.vao);
    gl.drawArrays(gl.TRIANGLES, 0, scene.mesh.count);
    // Props are too small for this shadow map: their shadows would land on the slopes behind as soft dark blots.
    programs.treeDepth.use().set({ uLightViewProj: lightMatrix });
    gl.bindVertexArray(trees.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, tree.count, treeCount);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    shadowKey = keyDir.slice();
  }
  // The valley's own shadow map (weather.js), drawn the same way; the climb's light matrix and key stay as they were.
  function renderValleyShadow(keyDir, target) {
    const saved = [lightMatrix, shadowKey];
    renderShadow(keyDir, target);
    const matrix = lightMatrix;
    [lightMatrix, shadowKey] = saved;
    return matrix;
  }

  let targets = null;
  function resize(width, height) {
    if (targets && targets.width === width && targets.height === height) return;
    if (targets) targets.dispose();
    const color = texture(gl, width, height, { internal: colorFormat, type: colorType });
    const depth = texture(gl, width, height, { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
    const resolved = framebuffer(gl, { color, depth });
    let multisampled = null, buffers = [];
    if (samples > 1) {
      buffers = [renderbuffer(gl, width, height, colorFormat, samples), renderbuffer(gl, width, height, gl.DEPTH_COMPONENT24, samples)];
      multisampled = framebuffer(gl, { colorBuffer: buffers[0], depthBuffer: buffers[1] });
    }
    const bloom = [];
    if (float) for (let i = 0, w = width, h = height; i < 6 && w > 8 && h > 8; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      const level = texture(gl, w, h, { internal: colorFormat, type: colorType });
      bloom.push({ texture: level, target: framebuffer(gl, { color: level }), width: w, height: h });
    }
    targets = {
      width, height, color, depth, resolved, multisampled, bloom,
      dispose() {
        gl.deleteTexture(color); gl.deleteTexture(depth); gl.deleteFramebuffer(resolved);
        if (multisampled) gl.deleteFramebuffer(multisampled);
        buffers.forEach(buffer => gl.deleteRenderbuffer(buffer));
        bloom.forEach(level => { gl.deleteTexture(level.texture); gl.deleteFramebuffer(level.target); });
      }
    };
  }

  const fullscreen = () => { gl.bindVertexArray(empty); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function render(frame) {
    const p = frame.palette, m = frame.markers;
    if (!shadowKey || dot(shadowKey, p.key) < .99999) renderShadow(p.key);
    const right = [frame.view[0], frame.view[4], frame.view[8]], up = [frame.view[1], frame.view[5], frame.view[9]];
    const common = {
      uViewProj: frame.viewProj, uInvViewProj: frame.invViewProj, uCamPos: frame.eye, uTime: frame.time, uRight: right, uUp: up,
      uPixel: 2 * Math.tan(frame.fov / 2) / targets.height,
      uKeyDir: p.key, uKeyColor: p.keyColor, uAmbSky: p.ambSky, uAmbGround: p.ambGround,
      uSunDir: p.sun, uGlow: p.glow, uZenith: p.zenith, uHorizon: p.horizon, uBelow: p.below, uFog: [p.fog, p.haze],
      uShadow: shadowMap, uLightMatrix: lightMatrix, uShadowSize: shadowSize,
      uStars: p.stars, uMoon: p.moon, uMoonDir: p.moonDir, uAurora: p.aurora, uSunDisc: p.sunDisc,
      uLantern: LANTERN, uPennants: m.pennants, uProgress: m.progress, uAhead: m.ahead, uFocus: m.focus, uSummit: [scene.camps.at(-1).x, scene.camps.at(-1).y, scene.camps.at(-1).z], uCloud: p.cloud, uCloudAmount: 1, uSnow: p.snow, uHeight: targets.height,
      uResolution: [targets.width, targets.height], uClip: [NEAR, FAR]
    };
    Object.assign(common, weather.update(frame, renderValleyShadow));
    const sceneTarget = targets.multisampled || targets.resolved;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget);
    gl.viewport(0, 0, targets.width, targets.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    programs.sky.use().set(common);
    fullscreen();

    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    programs.terrain.use().set(common);
    gl.bindVertexArray(terrain.vao);
    gl.drawArrays(gl.TRIANGLES, 0, scene.mesh.count);
    programs.props.use().set(common);
    gl.bindVertexArray(props.vao);
    gl.drawArrays(gl.TRIANGLES, 0, scene.props.count);
    programs.trees.use().set(common);
    gl.bindVertexArray(trees.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, tree.count, treeCount);

    // Soft particles read the opaque depth, which needs a single-sample copy when rendering with MSAA.
    let soft = 0, depth = dummyDepth;
    if (targets.multisampled) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.multisampled);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.resolved);
      gl.blitFramebuffer(0, 0, targets.width, targets.height, 0, 0, targets.width, targets.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget);
      soft = 1; depth = targets.depth;
    }

    // Transparent passes: premultiplied alpha; alpha 0 makes a sprite purely additive.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    weather.drawUnderClouds(common, frame.hide);
    for (let i = 0; i < cloudCount; i++) {
      const dx = scene.clouds[i * 5] - frame.eye[0], dy = scene.clouds[i * 5 + 1] - frame.eye[1], dz = scene.clouds[i * 5 + 2] - frame.eye[2];
      cloudDistance[i] = dx * dx + dy * dy + dz * dz;
    }
    cloudOrder.sort((a, b) => cloudDistance[b] - cloudDistance[a]);
    cloudOrder.forEach((index, i) => { cloudData.set(scene.clouds.subarray(index * 5, index * 5 + 4), i * 4); cloudSeeds[i] = scene.clouds[index * 5 + 4]; });
    clouds.update(0, cloudData);
    clouds.update(1, cloudSeeds);
    programs.cloud.use().set({ ...common, uDepth: depth, uSoft: soft });
    gl.bindVertexArray(clouds.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cloudCount);

    programs.trail.use().set(common);
    gl.bindVertexArray(trail.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.trail.length);

    const show = name => !frame.hide?.has(name);
    if (m.pillar[3] > .01 && show('pillar')) {
      programs.pillar.use().set({ ...common, uPillar: [m.pillar[0], m.pillar[1], m.pillar[2], 1], uPillarPower: m.pillar[3] });
      fullscreen6();
    }
    scene.camps.forEach((camp, i) => {
      const reached = i <= m.progress + .01, current = Math.max(0, 1 - Math.abs(m.progress - i) * 2) * m.settled;
      const pulse = 1 + Math.sin(frame.time * 2.4) * .12 * current;
      const power = (reached ? 1.6 : .7) + current * 3.2 * pulse;
      glowData.set([camp.x, camp.y + (camp.summit ? .75 : .2), camp.z, .1 + current * .08], i * 4);
      glowColors.set([LANTERN[0] * power, LANTERN[1] * power, LANTERN[2] * power, 0], i * 4);
    });
    glowData.set([...m.climber, .07], scene.camps.length * 4);
    glowColors.set([5 * m.climberPower, 4.4 * m.climberPower, 3.6 * m.climberPower, 0], scene.camps.length * 4);
    for (let i = 0; i < lightCount; i++) {
      const at = (scene.camps.length + 1 + i) * 4, l = lights.subarray(i * 8, i * 8 + 8);
      const power = 1.4 * (1 + l[7] * (Math.sin(frame.time * 9.3 + i * 2.1) * .2 + Math.sin(frame.time * 14.7 + i) * .12));
      glowData.set([l[0], l[1], l[2], l[3]], at);
      glowColors.set([l[4] * power, l[5] * power, l[6] * power, 0], at);
    }
    glows.update(0, glowData);
    glows.update(1, glowColors);
    if (show('glow')) {
      programs.glow.use().set(common);
      gl.bindVertexArray(glows.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, glowCount);
    }

    if (spark && scene.props.spark && show('spark')) {
      programs.spark.use().set({ ...common, uSpark: scene.props.spark, uForm: m.form, uPointer: m.pointer, uAspect: targets.width / targets.height, uSparkPower: 1 + m.form * 2.4 });
      gl.bindVertexArray(spark.array.vao);
      gl.drawArrays(gl.POINTS, 0, spark.count);
    }

    if (p.snow > .01) {
      programs.snow.use().set(common);
      gl.bindVertexArray(empty);
      gl.drawArrays(gl.POINTS, 0, quality.snow);
    }
    weather.drawPrecipitation(common);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    if (targets.multisampled) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.multisampled);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.resolved);
      gl.blitFramebuffer(0, 0, targets.width, targets.height, 0, 0, targets.width, targets.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST);

    // Bloom chain.
    let bloomTexture = black;
    if (targets.bloom.length && show('bloom')) {
      let source = targets.color, sw = targets.width, sh = targets.height;
      targets.bloom.forEach((level, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.target);
        gl.viewport(0, 0, level.width, level.height);
        programs.down.use().set({ uSource: source, uTexel: [1 / sw, 1 / sh], uThreshold: i === 0 ? 1 : 0 });
        fullscreen();
        source = level.texture; sw = level.width; sh = level.height;
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = targets.bloom.length - 1; i > 0; i--) {
        const from = targets.bloom[i], to = targets.bloom[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.target);
        gl.viewport(0, 0, to.width, to.height);
        programs.up.use().set({ uSource: from.texture, uTexel: [1 / from.width, 1 / from.height] });
        fullscreen();
      }
      gl.disable(gl.BLEND);
      bloomTexture = targets.bloom[0].texture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frame.canvasWidth, frame.canvasHeight);
    programs.composite.use().set({ uScene: targets.color, uBloom: bloomTexture, uBloomStrength: targets.bloom.length ? .14 : 0, uExposure: p.exposure, uSaturation: p.saturation, uTint: p.tint, uTime: frame.time, uFade: frame.fade,
      uFxaa: targets.multisampled ? 0 : 1, uTexel: [1 / targets.width, 1 / targets.height] });
    fullscreen();
    sampleEdge(frame.canvasWidth, frame.canvasHeight);
  }
  const fullscreen6 = () => { gl.bindVertexArray(empty); gl.drawArrays(gl.TRIANGLES, 0, 6); };

  // The colour along the top edge of the finished frame, read back without stalling: the top row is copied into a
  // buffer in one go and collected a few frames later, once a fence says the GPU is done with it.
  const probe = { buffer: gl.createBuffer(), data: null, sync: null, wait: 0, color: null };
  function sampleEdge(width, height) {
    if (probe.sync) {
      if (gl.getSyncParameter(probe.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, probe.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, probe.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(probe.sync);
      probe.sync = null;
      // Four points along the row, the middle two per channel, so a star on the edge does not flicker the colour.
      const row = probe.data, columns = row.length / 4;
      probe.color = [0, 1, 2].map(c => {
        const v = [.2, .4, .6, .8].map(x => row[Math.floor(columns * x) * 4 + c]).sort((a, b) => a - b);
        return Math.round((v[1] + v[2]) / 2);
      });
      probe.wait = 20;
      return;
    }
    if (probe.wait-- > 0) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, probe.buffer);
    if (!probe.data || probe.data.length !== width * 4) {
      probe.data = new Uint8Array(width * 4);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, probe.data.length, gl.STREAM_COPY);
    }
    gl.readPixels(0, height - 1, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    probe.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  return { resize, render, setSparkShape, edgeColor: () => probe.color, float, samples, near: NEAR, far: FAR };
}
