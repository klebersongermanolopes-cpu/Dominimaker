// Céu volumétrico em WebGL2: nuvens por ray marching, com o nome escrito no próprio volume.
// O canvas fica ACIMA dos vídeos: dentro do retângulo da tela ele só desenha as nuvens que
// estão na frente dela, por isso o filme parece mesmo estar pendurado no céu.

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const MARCH = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime, uFrame, uFocal, uCov, uStars, uCurtain, uWordOn, uWordNoise, uScreenZ, uHasScreen, uReveal;
uniform vec3 uCam, uSunDir, uSunCol, uZenith, uHorizon, uAmbient;
uniform mat3 uRot;
uniform vec4 uRect, uWordBox;
uniform vec2 uWordZ, uScreenC;
uniform int uSteps;
uniform sampler3D uNoise;
uniform sampler2D uWord;

const float Y_BOTTOM = -38.0;
const float Y_TOP = 34.0;

float sat(float x){ return clamp(x, 0.0, 1.0); }

float wordField(vec3 p){
  if (uWordOn < 0.01) return 0.0;
  vec2 uv = (p.xy - uWordBox.xy) / (uWordBox.zw * 2.0) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float dz = abs(p.z - uWordZ.x) / uWordZ.y;
  if (dz > 1.0) return 0.0;
  float m = texture(uWord, uv).r;
  vec3 q = (p + vec3(uTime * 0.16, 0.0, uTime * 0.05)) / uWordNoise;
  float n = texture(uNoise, q * 0.05).r;
  float n2 = texture(uNoise, q * 0.15).g;
  float n3 = texture(uNoise, q * 0.42).g;
  float d = m - dz * dz * 0.42 + (n - 0.5) * 0.12 + (n2 - 0.5) * 0.2 + (n3 - 0.5) * 0.1;
  return smoothstep(0.48, 0.64, d) * 1.9 * uWordOn;
}

float cumulus(vec3 p, bool hi){
  float h = (p.y - Y_BOTTOM) / (Y_TOP - Y_BOTTOM);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  // Túnel de voo: a câmera passa entre as torres de nuvem, com um mar de nuvens embaixo.
  float fit = clamp(uWordNoise, 0.42, 1.0);
  float clearR = (10.0 + 11.0 * fit) + 26.0 * fit * uWordOn * exp(-pow((p.z - uWordZ.x) / 70.0, 2.0));
  float r = length((p.xy - vec2(0.0, 5.0)) * vec2(0.8, 1.05));
  float tunnel = smoothstep(clearR, clearR + 22.0, r);
  if (tunnel <= 0.0) return 0.0;
  vec3 w = p + vec3(uTime * 0.55, 0.0, uTime * 0.2);
  float big = texture(uNoise, w * 0.0058).r;
  float mid = texture(uNoise, w * 0.019).r;
  float d = big * 0.7 + mid * 0.3;
  float g = smoothstep(0.0, 0.09, h) * smoothstep(1.0, 0.42, h);
  float deck = smoothstep(0.34, 0.08, h) * 0.2;
  float limit = mix(0.92, 1.0 - uCov - deck, g);
  d = sat((d - limit) * 6.5) * tunnel;
  if (hi && d > 0.0) {
    float billow = texture(uNoise, w * 0.031).g * 0.68 + texture(uNoise, w * 0.094).g * 0.32;
    d -= (1.0 - billow) * 0.62 * (1.0 - d * 0.72);
  }
  return max(d, 0.0) * 1.7;
}

// A cortina: nuvem que fecha sobre a tela e abre do centro para fora conforme a rolagem.
float curtain(vec3 p){
  if (uCurtain < 0.005 || uHasScreen < 0.5) return 0.0;
  float z = p.z - uScreenZ;
  if (z > -1.0 || z < -26.0) return 0.0;
  float zone = smoothstep(-26.0, -19.0, z) * smoothstep(-1.0, -6.0, z);
  vec3 w = p + vec3(uTime * 0.7, 0.0, 0.0);
  float n = texture(uNoise, w * 0.022).r;
  float n2 = texture(uNoise, w * 0.075).g;
  float radius = (1.0 - uCurtain) * 78.0;
  float dist = length(p.xy - uScreenC) + (n - 0.5) * 34.0 + (n2 - 0.5) * 8.0;
  return smoothstep(radius, radius + 9.0, dist) * zone * 1.5;
}

float density(vec3 p, bool hi){
  return wordField(p) + cumulus(p, hi) + curtain(p);
}

float lightMarch(vec3 p){
  float sum = 0.0;
  float dist = 1.2;
  for (int i = 0; i < 4; i++) {
    sum += density(p + uSunDir * dist, false) * dist;
    dist *= 2.0;
  }
  return exp(-sum * 0.62);
}

float hg(float c, float g){
  float gg = g * g;
  return (1.0 - gg) / (12.566 * pow(1.0 + gg - 2.0 * g * c, 1.5));
}

float hash(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 sky(vec3 rd){
  float y = max(rd.y, -0.25);
  vec3 c = mix(uHorizon, uZenith, pow(sat(y * 1.35 + 0.05), 0.55));
  float s = sat(dot(rd, uSunDir));
  c += uSunCol * (pow(s, 7.0) * 0.07 + pow(s, 90.0) * 0.28 + smoothstep(0.9994, 0.9998, s) * 3.0);
  if (uStars > 0.01 && rd.y > -0.02) {
    vec3 cell = floor(rd * 380.0);
    float star = step(0.9982, hash(cell));
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + hash(cell + 3.0) * 3.0) + hash(cell + 7.0) * 6.28);
    c += vec3(0.85, 0.9, 1.0) * star * twinkle * uStars * (0.35 + hash(cell + 11.0));
  }
  return c;
}

vec3 tone(vec3 c){
  c = 1.0 - exp(-c * 1.18);
  return pow(c, vec3(1.0 / 2.2));
}

void marchRange(vec3 ro, vec3 rd, float t0, float tEnd, int steps, float phase, vec3 fogColor, inout vec3 acc, inout float T){
  float t = t0;
  for (int i = 0; i < steps; i++) {
    if (t >= tEnd) break;
    float ds = max(0.95, t * 0.042);
    vec3 p = ro + rd * t;
    float d = density(p, t < 150.0);
    if (d > 0.003) {
      float a = 1.0 - exp(-d * ds * 1.15);
      float light = lightMarch(p);
      float powder = 1.0 - exp(-d * 4.0);
      float h = sat((p.y - Y_BOTTOM) / (Y_TOP - Y_BOTTOM));
      vec3 c = uSunCol * light * phase * (0.75 + powder * 1.1) * 6.0;
      c += uAmbient * (0.34 + 0.78 * h) * (0.5 + 0.5 * light);
      c = mix(c, fogColor, 1.0 - exp(-t * 0.0034));
      acc += T * c * a;
      T *= 1.0 - a;
      if (T < 0.012) break;
      t += ds * 0.6;
    } else {
      t += ds * 1.5;
    }
  }
}

void main(){
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uRot * vec3(ndc.x * uRes.x / uRes.y, ndc.y, uFocal));
  vec3 ro = uCam;

  float tFull = 300.0;
  // A cortina não respeita a camada de nuvens: sem esta exceção ela ganha uma borda reta.
  if (uCurtain < 0.005 || uHasScreen < 0.5) {
    if (rd.y > 0.001) tFull = min(tFull, (Y_TOP - ro.y) / rd.y);
    else if (rd.y < -0.001) tFull = min(tFull, (Y_BOTTOM - ro.y) / rd.y);
  }
  bool inRect = uHasScreen > 0.5 && ndc.x > uRect.x && ndc.x < uRect.z && ndc.y > uRect.y && ndc.y < uRect.w;
  float tFront = inRect ? min(tFull, (uScreenZ - ro.z) / max(rd.z, 0.001)) : tFull;

  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
  float cosSun = dot(rd, uSunDir);
  float phase = hg(cosSun, 0.62) * 0.7 + hg(cosSun, -0.25) * 0.3 + 0.075;
  vec3 bg = sky(rd);
  vec3 fogColor = mix(uHorizon, bg, 0.3);

  vec3 acc = vec3(0.0);
  float T = 1.0;
  marchRange(ro, rd, ign * 1.4, tFront, uSteps, phase, fogColor, acc, T);

  if (inRect) {
    // Enquanto a abertura é menor que a tela, o céu cobre o retângulo por inteiro (K = 1):
    // sem isso, só um pedaço do filme apareceria pelos buracos da nuvem.
    float K = 1.0 - uReveal;
    vec3 acc2 = vec3(0.0);
    float T2 = 1.0;
    if (K > 0.01 && tFront < tFull) marchRange(ro, rd, tFront + ign * 1.4, tFull, uSteps / 2, phase, fogColor, acc2, T2);
    vec3 pre = acc + T * K * (acc2 + T2 * bg);
    float alpha = 1.0 - T * (1.0 - K);
    vec3 c = alpha > 0.001 ? tone(pre / alpha) * alpha : vec3(0.0);
    outColor = vec4(c, alpha);
  } else {
    outColor = vec4(tone(acc + T * bg), 1.0);
  }
}`;

const BLEND = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uNow, uPrev;
uniform vec2 uRes;
uniform float uKeep;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  outColor = mix(texture(uNow, uv), texture(uPrev, uv), uKeep);
}`;

const FINAL = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uRect;
uniform float uHasScreen, uTime;
float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 37.0) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 ndc = uv * 2.0 - 1.0;
  vec2 px = 0.72 / vec2(textureSize(uTex, 0));
  vec4 s = (texture(uTex, uv + px * vec2(1.0, 0.4)) + texture(uTex, uv + px * vec2(-1.0, -0.4))
    + texture(uTex, uv + px * vec2(-0.4, 1.0)) + texture(uTex, uv + px * vec2(0.4, -1.0))) * 0.25;
  bool inRect = uHasScreen > 0.5 && ndc.x > uRect.x && ndc.x < uRect.z && ndc.y > uRect.y && ndc.y < uRect.w;
  float vig = 1.0 - 0.2 * pow(length(ndc * vec2(0.82, 0.92)), 2.6);
  float grain = (rand(gl_FragCoord.xy) - 0.5) * 0.028;
  if (inRect) {
    float a = s.a * s.a * (3.0 - 2.0 * s.a);
    vec3 c = s.a > 0.001 ? s.rgb / s.a : vec3(0.0);
    outColor = vec4((c * vig + grain) * a, a);
  } else {
    vec3 c = s.rgb / max(s.a, 0.02);
    outColor = vec4(c * vig + grain, 1.0);
  }
}`;

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

function program(gl, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(prog));
  }
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(prog, i).name;
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, uniforms };
}

// Ruído 3D que repete sem emenda: R = forma (Perlin-Worley), G = detalhe (Worley fino).
function buildNoise(size) {
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const wrap = (v, n) => ((v % n) + n) % n;

  const cells = (n) => {
    const pts = new Float32Array(n * n * n * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    return { n, pts };
  };
  const worley = (grid, x, y, z) => {
    const { n, pts } = grid;
    const fx = x * n, fy = y * n, fz = z * n;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let best = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const cx = ix + a, cy = iy + b, cz = iz + c;
      const k = (wrap(cx, n) + wrap(cy, n) * n + wrap(cz, n) * n * n) * 3;
      const dx = cx + pts[k] - fx, dy = cy + pts[k + 1] - fy, dz = cz + pts[k + 2] - fz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    return 1 - Math.min(Math.sqrt(best), 1);
  };

  const lattice = (n) => {
    const v = new Float32Array(n * n * n);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    return { n, v };
  };
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const value = (grid, x, y, z) => {
    const { n, v } = grid;
    const fx = x * n, fy = y * n, fz = z * n;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
    const at = (a, b, c) => v[wrap(ix + a, n) + wrap(iy + b, n) * n + wrap(iz + c, n) * n * n];
    const lerp = (p, q, t) => p + (q - p) * t;
    return lerp(
      lerp(lerp(at(0, 0, 0), at(1, 0, 0), tx), lerp(at(0, 1, 0), at(1, 1, 0), tx), ty),
      lerp(lerp(at(0, 0, 1), at(1, 0, 1), tx), lerp(at(0, 1, 1), at(1, 1, 1), tx), ty),
      tz
    );
  };

  const w1 = cells(4), w2 = cells(8), w3 = cells(16), w4 = cells(24);
  const v1 = lattice(4), v2 = lattice(8), v3 = lattice(16);
  const data = new Uint8Array(size * size * size * 2);
  let k = 0;
  for (let zi = 0; zi < size; zi++) {
    const z = zi / size;
    for (let yi = 0; yi < size; yi++) {
      const y = yi / size;
      for (let xi = 0; xi < size; xi++) {
        const x = xi / size;
        const perlin = value(v1, x, y, z) * 0.6 + value(v2, x, y, z) * 0.28 + value(v3, x, y, z) * 0.12;
        const wa = worley(w1, x, y, z), wb = worley(w2, x, y, z), wc = worley(w3, x, y, z);
        const wf = wa * 0.62 + wb * 0.26 + wc * 0.12;
        const shape = Math.min(Math.max((perlin - (1 - wf)) / Math.max(wf, 0.001) * 0.72 + perlin * 0.5, 0), 1);
        const detail = wc * 0.6 + worley(w4, x, y, z) * 0.4;
        data[k++] = Math.round(shape * 255);
        data[k++] = Math.round(detail * 255);
      }
    }
  }
  return data;
}

// Desenha o texto, engrossa e desfoca: a borda suave é o que vira nuvem no shader.
export function buildWordMask(lines, size = 1024) {
  const pad = 0.1;
  const tracking = 0.15;
  const probe = document.createElement('canvas').getContext('2d');
  const font = '200px Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Bold", "Roboto Condensed", "sans-serif-condensed", "Arial Black", sans-serif';
  probe.font = font;
  const widthOf = (line) => [...line].reduce((sum, ch) => sum + probe.measureText(ch).width, 0) + (line.length - 1) * 200 * tracking;
  const lineWidth = Math.max(...lines.map(widthOf));
  const lineStep = 216;

  const w = size;
  const scale = (w * (1 - pad * 2)) / lineWidth;
  const h = Math.min(Math.round((lines.length * lineStep * scale) / (1 - pad * 2)), 1024);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * scale;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font.replace('200px', 200 * scale + 'px');
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * lineStep * scale;
    let x = (w - widthOf(line) * scale) / 2;
    for (const ch of line) {
      ctx.strokeText(ch, x, y);
      ctx.fillText(ch, x, y);
      x += (probe.measureText(ch).width + 200 * tracking) * scale;
    }
  });
  boxBlur(ctx, w, h, Math.max(2, Math.round(w / 340)));
  return { canvas, aspect: w / h };
}

function boxBlur(ctx, w, h, radius) {
  const img = ctx.getImageData(0, 0, w, h);
  let src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = img.data[i * 4];
  let tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(Math.max(x, 0), w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (radius * 2 + 1);
        sum += src[y * w + Math.min(x + radius + 1, w - 1)] - src[y * w + Math.max(x - radius, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(Math.max(y, 0), h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        src[y * w + x] = sum / (radius * 2 + 1);
        sum += tmp[Math.min(y + radius + 1, h - 1) * w + x] - tmp[Math.max(y - radius, 0) * w + x];
      }
    }
  }
  for (let i = 0; i < src.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = src[i];
  }
  ctx.putImageData(img, 0, 0);
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

export class Sky {
  constructor(canvas, { onLost } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('webgl2 indisponível');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (onLost) onLost();
    });

    this.march = program(gl, MARCH);
    this.blend = program(gl, BLEND);
    this.final = program(gl, FINAL);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const size = 48;
    this.noise = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.noise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, size, size, size, 0, gl.RG, gl.UNSIGNED_BYTE, buildNoise(size));
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, axis, gl.REPEAT);
    }
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.wordTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.wordTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.scale = this.software ? 0.2 : coarse ? 0.38 : 0.62;
    this.maxScale = this.software ? 0.25 : coarse ? 0.5 : 0.9;
    this.steps = this.software ? 24 : coarse ? 36 : 64;
    this.frame = 0;
    this.history = 0;
    this.lastW = 0;
    this.timing = { sum: 0, count: 0 };
    this.resize();
  }

  setWord(mask) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.wordTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    this.rw = Math.max(64, Math.round(window.innerWidth * this.scale));
    this.rh = Math.max(64, Math.round(window.innerHeight * this.scale));
    for (const t of this.targets || []) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.targets = [target(gl, this.rw, this.rh), target(gl, this.rw, this.rh), target(gl, this.rw, this.rh)];
    this.fresh = true;
  }

  // Ajusta qualidade pelo tempo real de quadro, para não travar notebook nem celular.
  adapt(dt) {
    this.timing.sum += dt;
    this.timing.count++;
    if (this.timing.count < 45) return;
    const avg = this.timing.sum / this.timing.count;
    this.timing.sum = this.timing.count = 0;
    if (avg > 22 && this.scale > 0.2) {
      this.scale = Math.max(0.2, this.scale * 0.82);
      this.steps = Math.max(20, Math.round(this.steps * 0.92));
      this.resize();
    } else if (avg < 12.5 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale * 1.08);
      this.resize();
    }
  }

  render(state, time, moving) {
    const gl = this.gl;
    const { camera, sky, word, screen, curtain, focal } = state;
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const rot = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
    this.frame = (this.frame + 1) % 1024;

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.rw, this.rh);

    const [now, prev, next] = this.targets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, now.fbo);
    gl.useProgram(this.march.prog);
    const u = this.march.uniforms;
    gl.uniform2f(u.uRes, this.rw, this.rh);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uFrame, this.frame);
    gl.uniform1f(u.uFocal, focal);
    gl.uniform3f(u.uCam, camera.x, camera.y, camera.z);
    gl.uniformMatrix3fv(u.uRot, false, rot);
    gl.uniform1f(u.uCov, sky.cov);
    gl.uniform1f(u.uStars, sky.stars);
    gl.uniform3fv(u.uSunDir, sky.sunDir);
    gl.uniform3fv(u.uSunCol, sky.sunCol);
    gl.uniform3fv(u.uZenith, sky.zenith);
    gl.uniform3fv(u.uHorizon, sky.horizon);
    gl.uniform3fv(u.uAmbient, sky.ambient);
    gl.uniform1f(u.uCurtain, curtain);
    gl.uniform1f(u.uWordOn, word.on);
    gl.uniform4f(u.uWordBox, word.x, word.y, word.halfW, word.halfH);
    gl.uniform2f(u.uWordZ, word.z, word.depth);
    gl.uniform1f(u.uWordNoise, word.noise);
    gl.uniform1f(u.uHasScreen, screen ? 1 : 0);
    gl.uniform1f(u.uReveal, state.reveal);
    gl.uniform1i(u.uSteps, this.steps);
    gl.uniform1i(u.uNoise, 2);
    gl.uniform1i(u.uWord, 3);
    if (screen) {
      gl.uniform1f(u.uScreenZ, screen.z);
      gl.uniform2f(u.uScreenC, screen.x, screen.y);
      gl.uniform4f(u.uRect, screen.ndc[0], screen.ndc[1], screen.ndc[2], screen.ndc[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.useProgram(this.blend.prog);
    const b = this.blend.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, now.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(b.uNow, 0);
    gl.uniform1i(b.uPrev, 1);
    gl.uniform2f(b.uRes, this.rw, this.rh);
    gl.uniform1f(b.uKeep, this.fresh ? 0 : moving ? 0.55 : 0.88);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.fresh = false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.final.prog);
    const f = this.final.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.uniform1i(f.uTex, 0);
    gl.uniform2f(f.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(f.uTime, time % 10);
    gl.uniform1f(f.uHasScreen, screen ? 1 : 0);
    if (screen) gl.uniform4f(f.uRect, screen.ndc[0], screen.ndc[1], screen.ndc[2], screen.ndc[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.targets = [now, next, prev];
  }
}
