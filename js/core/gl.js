// WebGL2 の薄いヘルパ層。フレームワークは使わないので、シェーダ・VAO・FBO の
// 定型部分だけをここに閉じ込める。

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,          // ポストプロセスでオフスクリーンに描くので MSAA は使わない
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: true,
  });
  if (!gl) return null;

  gl.ext = {
    colorBufferFloat: gl.getExtension('EXT_color_buffer_float'),
    floatLinear: gl.getExtension('OES_texture_float_linear'),
    aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
  };
  gl.maxAniso = gl.ext.aniso
    ? gl.getParameter(gl.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
    : 1;
  return gl;
}

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
    console.error(`[gl] ${label} コンパイル失敗:\n${log}\n${numbered}`);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${label}\n${log}`);
  }
  return sh;
}

/**
 * プログラムを作り、uniform / attribute のロケーションを自動で引く。
 * 返り値の .u と .a は名前引きのマップ。
 */
export function createProgram(gl, vsSrc, fsSrc, label = 'program') {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    console.error(`[gl] ${label} リンク失敗:\n${log}`);
    throw new Error(`program link failed: ${label}\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const u = Object.create(null);
  const nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(prog, info.name);
  }

  const a = Object.create(null);
  const na = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(prog, i);
    if (!info) continue;
    a[info.name] = gl.getAttribLocation(prog, info.name);
  }

  return { prog, u, a, label, use: () => gl.useProgram(prog) };
}

export function createBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const buf = gl.createBuffer();
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, usage);
  gl.bindBuffer(target, null);
  return buf;
}

/**
 * attribs: [{ buffer, loc, size, type, normalized, stride, offset, divisor }]
 * index: { buffer, type } | null
 */
export function createVAO(gl, attribs, index = null) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const at of attribs) {
    if (at.loc < 0 || at.loc == null) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, at.buffer);
    const type = at.type ?? gl.FLOAT;
    if (at.integer) {
      gl.vertexAttribIPointer(at.loc, at.size, type, at.stride || 0, at.offset || 0);
    } else {
      gl.vertexAttribPointer(at.loc, at.size, type, !!at.normalized, at.stride || 0, at.offset || 0);
    }
    gl.enableVertexAttribArray(at.loc);
    if (at.divisor) gl.vertexAttribDivisor(at.loc, at.divisor);
  }
  if (index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  return vao;
}

export function createTexture2D(gl, opts = {}) {
  const {
    width = 1, height = 1,
    internalFormat = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE,
    data = null,
    min = gl.LINEAR, mag = gl.LINEAR,
    wrapS = gl.CLAMP_TO_EDGE, wrapT = gl.CLAMP_TO_EDGE,
    mipmap = false, aniso = 0, compare = null,
  } = opts;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  if (compare) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, compare);
  }
  if (aniso && gl.ext.aniso) {
    gl.texParameterf(gl.TEXTURE_2D, gl.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(aniso, gl.maxAniso));
  }
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  tex.width = width;
  tex.height = height;
  tex._opts = opts;
  return tex;
}

/**
 * color: [{internalFormat, format, type, min, mag}] （複数なら MRT）
 * depth: false | true(renderbuffer) | {texture:true, compare}
 */
export function createFBO(gl, { width, height, color = [{}], depth = true }) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  const colors = [];
  const bufs = [];
  color.forEach((c, i) => {
    const tex = createTexture2D(gl, {
      width, height,
      internalFormat: c.internalFormat ?? gl.RGBA8,
      format: c.format ?? gl.RGBA,
      type: c.type ?? gl.UNSIGNED_BYTE,
      min: c.min ?? gl.LINEAR,
      mag: c.mag ?? gl.LINEAR,
      wrapS: c.wrapS ?? gl.CLAMP_TO_EDGE,
      wrapT: c.wrapT ?? gl.CLAMP_TO_EDGE,
    });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    colors.push(tex);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  if (bufs.length > 1) gl.drawBuffers(bufs);

  let depthTex = null, depthRb = null;
  if (depth && depth.texture) {
    depthTex = createTexture2D(gl, {
      width, height,
      internalFormat: gl.DEPTH_COMPONENT24,
      format: gl.DEPTH_COMPONENT,
      type: gl.UNSIGNED_INT,
      min: depth.compare ? gl.LINEAR : gl.NEAREST,
      mag: depth.compare ? gl.LINEAR : gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE,
      compare: depth.compare || null,
    });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  } else if (depth) {
    depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  }

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('[gl] FBO incomplete:', status.toString(16));
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    fbo, colors, depthTex, depthRb, width, height,
    color: colors[0],
    bind(clearColor) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, this.width, this.height);
      if (clearColor) {
        gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3] ?? 1);
        gl.clear(gl.COLOR_BUFFER_BIT | (depth ? gl.DEPTH_BUFFER_BIT : 0));
      }
    },
  };
}

export function resizeFBO(gl, fboObj, width, height) {
  if (fboObj.width === width && fboObj.height === height) return;
  fboObj.width = width;
  fboObj.height = height;
  for (const tex of fboObj.colors) {
    const o = tex._opts;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, o.internalFormat ?? gl.RGBA8, width, height, 0,
      o.format ?? gl.RGBA, o.type ?? gl.UNSIGNED_BYTE, null);
    tex.width = width; tex.height = height;
  }
  if (fboObj.depthTex) {
    gl.bindTexture(gl.TEXTURE_2D, fboObj.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  }
  if (fboObj.depthRb) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, fboObj.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/** 全画面三角形（クアッドより効率が良い）。属性なしで gl_VertexID から生成する前提。 */
let _fsVAO = null;
export function drawFullscreen(gl) {
  if (!_fsVAO) _fsVAO = gl.createVertexArray();
  gl.bindVertexArray(_fsVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

/** テクスチャユニットへのバインドをまとめる小道具 */
export function bindTextures(gl, program, list) {
  list.forEach(([name, tex], i) => {
    const loc = program.u[name];
    if (loc == null) return;
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, i);
  });
}
