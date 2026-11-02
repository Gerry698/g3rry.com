import { program, use, texture } from './gl.js';
import { simVertex, simFragment, pointVertex, pointFragment, shadowVertex, shadowFragment } from './shaders.js';

export const ROW = 1024;

// One pool of particles shared by every chapter. Targets are swapped, never the particles, so each change of scene is a morph.
export class Particles {
  constructor(gl) {
    this.gl = gl;
    this.sim = program(gl, simVertex, simFragment, ['vPos', 'vVel']);
    this.points = program(gl, pointVertex, pointFragment);
    this.shadows = program(gl, shadowVertex, shadowFragment);
    this.count = 0;
    this.side = 0;
    this.morph = 1;
    this.morphSpeed = .6;
    this.sweep = [0, 0, 0, 0];
  }

  // Allocates state for `count` particles (a multiple of ROW). With `burst` they start packed into a single point and
  // morph out into `set`; otherwise (a change of quality) they start exactly on it.
  // `carry` starts the new particles where the current ones are (repeated to fill a larger count), so a change of quality
  // tier is a short flight to the new targets instead of a cut.
  allocate(count, set, { burst = false, carry = false } = {}) {
    const { gl } = this;
    const previous = carry && this.count ? { buffers: this.buffers, vaos: this.vaos, feedback: this.feedback, slots: [this.from, this.to], pos: this.buffers[this.side].pos, count: this.count } : null;
    if (!previous) this.free();
    this.count = count;
    const rows = count / ROW;
    const position = burst ? new Float32Array(count * 4) : previous ? null : set.pos.slice();
    if (burst) {
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2, r = .03 * Math.cbrt(Math.random()), s = Math.sqrt(1 - u * u);
        position.set([Math.cos(phi) * s * r, u * r, Math.sin(phi) * s * r, 1], i * 4);
      }
    }
    const start = burst ? { pos: position, col: set.col, gain: set.gain } : set;
    this.buffers = [0, 1].map(() => {
      const pos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      if (position) gl.bufferData(gl.ARRAY_BUFFER, position, gl.DYNAMIC_COPY);
      else gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      const vel = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vel);
      gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      return { pos, vel };
    });
    this.vaos = this.buffers.map(({ pos, vel }) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vel);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    });
    // Feedback object i writes into the opposite side's buffers.
    this.feedback = [0, 1].map(i => {
      const tf = gl.createTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[1 - i].pos);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.buffers[1 - i].vel);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      return tf;
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if (previous) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, previous.pos);
      for (const { pos } of this.buffers) {
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, pos);
        for (let offset = 0; offset < count; offset += previous.count) gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, offset * 16, Math.min(previous.count, count - offset) * 16);
      }
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      for (const { pos, vel } of previous.buffers) { gl.deleteBuffer(pos); gl.deleteBuffer(vel); }
      previous.vaos.forEach(vao => gl.deleteVertexArray(vao));
      previous.feedback.forEach(tf => gl.deleteTransformFeedback(tf));
      for (const old of previous.slots) { gl.deleteTexture(old.pos); gl.deleteTexture(old.col); }
    }
    const slot = () => ({
      pos: texture(gl, { width: ROW, height: rows, internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST }),
      col: texture(gl, { width: ROW, height: rows, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST })
    });
    this.from = slot();
    this.to = slot();
    this.upload(this.from, start);
    this.upload(this.to, set);
    this.fromSet = start;
    this.toSet = set;
    this.morph = burst ? 0 : 1;
    this.morphSpeed = .45;
    this.sweep = [0, 0, 0, 0];
    this.side = 0;
  }

  upload(slot, set) {
    const { gl } = this;
    const rows = this.count / ROW;
    gl.bindTexture(gl.TEXTURE_2D, slot.pos);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RGBA, gl.FLOAT, set.pos);
    gl.bindTexture(gl.TEXTURE_2D, slot.col);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, rows, gl.RGBA, gl.UNSIGNED_BYTE, set.col);
  }

  // The old destination becomes the origin, so a morph interrupted halfway still leaves from where the particles were heading.
  retarget(set, { speed = .6, sweep = [0, 0, 0, 0] } = {}) {
    if (set.pos.length !== this.count * 4) return;
    [this.from, this.to] = [this.to, this.from];
    this.upload(this.to, set);
    this.fromSet = this.toSet;
    this.toSet = set;
    this.morph = 0;
    this.morphSpeed = speed;
    this.sweep = sweep;
  }

  get flight() { return this.morph < 1 ? Math.sin(Math.PI * Math.min(1, this.morph * 1.15)) : 0; }

  morphUniforms() {
    return { uFromPos: this.from.pos, uToPos: this.to.pos, uMorph: this.morph, uSpread: .45, uSweep: this.sweep, uFromGain: this.fromSet.gain, uToGain: this.toSet.gain };
  }

  step(dt, values) {
    const { gl } = this;
    this.morph = Math.min(1, this.morph + dt * this.morphSpeed);
    use(this.sim, { ...this.morphUniforms(), ...values, uDt: dt });
    gl.bindVertexArray(this.vaos[this.side]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback[this.side]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    this.side = 1 - this.side;
  }

  // The sun's depth map: the same points, drawn from the sun into whatever depth target is bound.
  shadow(values) {
    const { gl } = this;
    use(this.shadows, { ...this.morphUniforms(), ...values });
    gl.bindVertexArray(this.vaos[this.side]);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  draw(values) {
    const { gl } = this;
    use(this.points, { ...this.morphUniforms(), uFromColor: this.from.col, uToColor: this.to.col, ...values });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vaos[this.side]);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  free() {
    const { gl } = this;
    if (!this.count) return;
    for (const { pos, vel } of this.buffers) { gl.deleteBuffer(pos); gl.deleteBuffer(vel); }
    this.vaos.forEach(vao => gl.deleteVertexArray(vao));
    this.feedback.forEach(tf => gl.deleteTransformFeedback(tf));
    for (const slot of [this.from, this.to]) { gl.deleteTexture(slot.pos); gl.deleteTexture(slot.col); }
    this.count = 0;
  }
}
