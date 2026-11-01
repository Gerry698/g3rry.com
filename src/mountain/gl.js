// Thin WebGL2 helpers: programs with cached uniform locations, vertex arrays, textures and render targets.

export function program(gl, vertexSource, fragmentSource, name) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const numbered = source.split('\n').map((line, i) => String(i + 1).padStart(3) + ' ' + line).join('\n');
      throw new Error(name + ' shader: ' + gl.getShaderInfoLog(shader) + '\n' + numbered);
    }
    return shader;
  };
  const handle = gl.createProgram();
  gl.attachShader(handle, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(name + ' link: ' + gl.getProgramInfoLog(handle));
  const locations = {};
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(handle, i);
    locations[info.name.replace(/\[0\]$/, '')] = { location: gl.getUniformLocation(handle, info.name), type: info.type, size: info.size };
  }
  let unit = 0;
  const setters = {
    [gl.FLOAT]: (l, v) => gl.uniform1f(l, v), [gl.FLOAT_VEC2]: (l, v) => gl.uniform2fv(l, v), [gl.FLOAT_VEC3]: (l, v) => gl.uniform3fv(l, v),
    [gl.FLOAT_VEC4]: (l, v) => gl.uniform4fv(l, v), [gl.FLOAT_MAT4]: (l, v) => gl.uniformMatrix4fv(l, false, v), [gl.INT]: (l, v) => gl.uniform1i(l, v)
  };
  return {
    handle,
    use() { gl.useProgram(handle); unit = 0; return this; },
    // Sets every uniform present in the program; values missing from `values` are left alone.
    set(values) {
      for (const name in values) {
        const uniform = locations[name];
        if (!uniform) continue;
        const value = values[name];
        if (uniform.type === gl.SAMPLER_2D || uniform.type === gl.SAMPLER_2D_SHADOW) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, value);
          gl.uniform1i(uniform.location, unit++);
        } else setters[uniform.type]?.(uniform.location, value);
      }
      return this;
    }
  };
}

// attributes: [{ data, size, type, normalized, divisor }] bound to locations 0..n in order.
export function vertexArray(gl, attributes) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attributes.forEach((attribute, location) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, attribute.data, attribute.usage || gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    const type = attribute.type || gl.FLOAT;
    if (type === gl.FLOAT || attribute.normalized) gl.vertexAttribPointer(location, attribute.size, type, Boolean(attribute.normalized), 0, 0);
    else gl.vertexAttribIPointer(location, attribute.size, type, 0, 0);
    if (attribute.divisor) gl.vertexAttribDivisor(location, attribute.divisor);
    attribute.buffer = buffer;
  });
  gl.bindVertexArray(null);
  return { vao, attributes, update(index, data) { gl.bindBuffer(gl.ARRAY_BUFFER, attributes[index].buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); } };
}

export function texture(gl, width, height, { internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, filter = gl.LINEAR, data = null, compare = false } = {}) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (compare) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  return handle;
}

export function framebuffer(gl, { color = null, depth = null, colorBuffer = null, depthBuffer = null }) {
  const handle = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
  if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  if (colorBuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorBuffer);
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  if (depthBuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
  if (!color && !colorBuffer) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer: 0x' + status.toString(16));
  return handle;
}

export function renderbuffer(gl, width, height, internal, samples) {
  const handle = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, handle);
  if (samples > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, width, height);
  else gl.renderbufferStorage(gl.RENDERBUFFER, internal, width, height);
  return handle;
}
