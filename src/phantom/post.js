import { program, use, renderTarget, freeTarget, bindTarget } from './gl.js';
import { fullscreenVertex, accumulateFragment, downFragment, upFragment, compositeFragment } from './shaders.js';

const LEVELS = 6;

// HDR scene -> exponential long exposure -> bloom pyramid -> filmic composite on the canvas.
export class Post {
  constructor(gl, hdr) {
    this.gl = gl;
    this.hdr = hdr;
    this.vao = gl.createVertexArray();
    this.accumulate = program(gl, fullscreenVertex, accumulateFragment);
    this.down = program(gl, fullscreenVertex, downFragment);
    this.up = program(gl, fullscreenVertex, upFragment);
    this.composite = program(gl, fullscreenVertex, compositeFragment);
    this.width = 0;
    this.height = 0;
    this.frame = 0;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    const { gl, hdr } = this;
    [this.scene, ...(this.exposures || []), ...(this.pyramid || [])].forEach(target => freeTarget(gl, target));
    this.width = width;
    this.height = height;
    this.scene = renderTarget(gl, width, height, hdr);
    this.exposures = [renderTarget(gl, width, height, hdr), renderTarget(gl, width, height, hdr)];
    this.pyramid = [];
    let w = width, h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      this.pyramid.push(renderTarget(gl, w, h, hdr));
    }
    this.fresh = true;
  }

  begin() {
    const { gl } = this;
    bindTarget(gl, this.scene);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  fullscreen() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  finish({ decay, exposure, bloom, halation, grain, tanCorner, aberration, inner, outer }) {
    const { gl } = this;
    this.frame++;
    let image = this.scene;
    // A long shutter blends this frame into the last; a fast one (or the first frame) just passes the scene through.
    if (decay > .002 && !this.fresh) {
      const [previous, next] = this.exposures;
      bindTarget(gl, next);
      use(this.accumulate, { uCurrent: this.scene, uPrevious: previous, uDecay: decay });
      this.fullscreen();
      this.exposures = [next, previous];
      image = next;
    } else {
      bindTarget(gl, this.exposures[0]);
      use(this.accumulate, { uCurrent: this.scene, uPrevious: this.scene, uDecay: 0 });
      this.fullscreen();
      image = this.exposures[0];
    }
    this.fresh = false;
    let source = image;
    this.pyramid.forEach((target, i) => {
      bindTarget(gl, target);
      use(this.down, { uSource: source, uTexel: [1 / source.width, 1 / source.height], uKaris: i === 0 ? 1 : 0 });
      this.fullscreen();
      source = target;
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = LEVELS - 1; i > 0; i--) {
      const small = this.pyramid[i];
      bindTarget(gl, this.pyramid[i - 1]);
      use(this.up, { uSource: small, uTexel: [1 / small.width, 1 / small.height], uWeight: 1 });
      this.fullscreen();
    }
    gl.disable(gl.BLEND);
    bindTarget(gl, null);
    use(this.composite, {
      uImage: image, uBloom: this.pyramid[0], uResolution: [this.width, this.height], uExposure: exposure,
      uBloomStrength: bloom, uHalation: halation, uGrain: grain, uFrame: this.frame % 65536, uTanCorner: tanCorner,
      uAberration: aberration, uInner: inner, uOuter: outer
    });
    this.fullscreen();
    gl.bindVertexArray(null);
  }
}
