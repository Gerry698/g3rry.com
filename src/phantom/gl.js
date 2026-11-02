// Thin WebGL2 helpers: programs with reflected uniforms, textures and render targets.
export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  // Half-float render targets keep highlights above 1.0 for bloom and long exposures; without them the lab renders in 8 bits.
  const hdr = Boolean(gl.getExtension('EXT_color_buffer_float'));
  gl.getExtension('EXT_float_blend');
  return { gl, hdr };
}

function shader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(result);
    const numbered = source.split('\n').map((line, i) => String(i + 1).padStart(3) + ' ' + line).join('\n');
    throw new Error('Shader compile failed: ' + log + '\n' + numbered);
  }
  return result;
}

export function program(gl, vertex, fragment, varyings) {
  const result = gl.createProgram();
  gl.attachShader(result, shader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(result, shader(gl, gl.FRAGMENT_SHADER, fragment));
  if (varyings) gl.transformFeedbackVaryings(result, varyings, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(result));
  const uniforms = new Map();
  let unit = 0;
  for (let i = 0; i < gl.getProgramParameter(result, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(result, i);
    const name = info.name.replace(/\[0\]$/, '');
    const sampler = info.type === gl.SAMPLER_2D || info.type === gl.UNSIGNED_INT_SAMPLER_2D;
    uniforms.set(name, { location: gl.getUniformLocation(result, info.name), type: info.type, size: info.size, unit: sampler ? unit++ : -1 });
  }
  return { gl, handle: result, uniforms };
}

// Sets every value that the program actually uses; unknown names are ignored so shaders can drop unused uniforms freely.
export function use(prog, values) {
  const { gl } = prog;
  gl.useProgram(prog.handle);
  for (const [name, value] of Object.entries(values)) {
    const uniform = prog.uniforms.get(name);
    if (!uniform || value === undefined) continue;
    const { location, type } = uniform;
    if (uniform.unit >= 0) {
      gl.activeTexture(gl.TEXTURE0 + uniform.unit);
      gl.bindTexture(gl.TEXTURE_2D, value.texture || value);
      gl.uniform1i(location, uniform.unit);
    } else if (type === gl.FLOAT) uniform.size > 1 ? gl.uniform1fv(location, value) : gl.uniform1f(location, value);
    else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, value);
    else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value);
    else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, value);
    else if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, value);
    else if (type === gl.INT || type === gl.BOOL) gl.uniform1i(location, value);
  }
}

export function texture(gl, { width, height, internal, format, type, filter = gl.LINEAR, data = null, wrap = gl.CLAMP_TO_EDGE }) {
  const result = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return result;
}

export function imageTexture(gl, source) {
  const result = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return result;
}

export function renderTarget(gl, width, height, hdr) {
  const tex = texture(gl, { width, height, internal: hdr ? gl.RGBA16F : gl.RGBA8, format: gl.RGBA, type: hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE });
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, texture: tex, width, height };
}

// A depth-only target: the sun's shadow map. Read back through a plain sampler with nearest filtering and compared by hand.
export function depthTarget(gl, size) {
  const tex = texture(gl, { width: size, height: size, internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, texture: tex, width: size, height: size };
}

export function freeTarget(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.texture);
}

export function bindTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, target ? target.width : gl.drawingBufferWidth, target ? target.height : gl.drawingBufferHeight);
}
