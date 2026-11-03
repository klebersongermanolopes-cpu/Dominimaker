// O roteiro do voo: transforma a posição da rolagem em câmera, luz do dia e tela ativa.
// Sem DOM e sem WebGL, para poder ser testado no Node.

export const FOCAL = 1.55;
export const FRAME_ASPECT = 2.39;
export const SCREEN_WIDTH = 32;
const WORD_DISTANCE = 46;
const APPROACH = 150;

const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const range = (v, a, b) => clamp((v - a) / (b - a));

const normalize = ([x, y, z]) => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
};

// Um dia inteiro no céu: a manhã abre o filme e a noite fecha.
export const DAY = [
  { name: 'morning', sunDir: [-0.5, 0.6, -0.62], sunCol: [1.0, 0.95, 0.86], zenith: [0.025, 0.11, 0.42], horizon: [0.26, 0.47, 0.8], ambient: [0.34, 0.46, 0.72], cov: 0.5, stars: 0 },
  { name: 'noon', sunDir: [-0.2, 0.88, -0.3], sunCol: [1.0, 0.97, 0.92], zenith: [0.018, 0.09, 0.38], horizon: [0.24, 0.45, 0.8], ambient: [0.36, 0.48, 0.74], cov: 0.47, stars: 0 },
  { name: 'afternoon', sunDir: [0.6, 0.5, -0.3], sunCol: [1.0, 0.86, 0.66], zenith: [0.03, 0.1, 0.34], horizon: [0.46, 0.5, 0.6], ambient: [0.3, 0.36, 0.56], cov: 0.5, stars: 0 },
  { name: 'golden', sunDir: [0.68, 0.16, 0.72], sunCol: [1.0, 0.54, 0.25], zenith: [0.05, 0.08, 0.25], horizon: [0.92, 0.45, 0.22], ambient: [0.24, 0.2, 0.32], cov: 0.52, stars: 0 },
  { name: 'dusk', sunDir: [0.75, 0.03, 0.66], sunCol: [0.68, 0.24, 0.18], zenith: [0.006, 0.03, 0.08], horizon: [0.16, 0.17, 0.24], ambient: [0.07, 0.12, 0.18], cov: 0.5, stars: 0.2 },
  { name: 'blue hour', sunDir: [0.2, 0.3, 0.9], sunCol: [0.18, 0.26, 0.46], zenith: [0.003, 0.014, 0.05], horizon: [0.03, 0.07, 0.14], ambient: [0.035, 0.065, 0.12], cov: 0.48, stars: 0.6 },
  { name: 'night', sunDir: [-0.5, 0.55, -0.66], sunCol: [0.62, 0.72, 0.95], zenith: [0.002, 0.005, 0.018], horizon: [0.01, 0.02, 0.045], ambient: [0.035, 0.055, 0.1], cov: 0.46, stars: 1 },
];

export function dayAt(u) {
  const pos = clamp(u) * (DAY.length - 1);
  const i = Math.min(Math.floor(pos), DAY.length - 2);
  const t = smooth(pos - i);
  const a = DAY[i], b = DAY[i + 1];
  const mixv = (x, y) => x.map((v, k) => lerp(v, y[k], t));
  return {
    name: t < 0.5 ? a.name : b.name,
    sunDir: normalize(mixv(a.sunDir, b.sunDir)),
    sunCol: mixv(a.sunCol, b.sunCol),
    zenith: mixv(a.zenith, b.zenith),
    horizon: mixv(a.horizon, b.horizon),
    ambient: mixv(a.ambient, b.ambient),
    cov: lerp(a.cov, b.cov, t),
    stars: lerp(a.stars, b.stars, t),
  };
}

// Calcula onde cada tela fica no mundo para aparecer no tamanho que o layout reservou.
export function buildPlan({ vw, vh, sections, frames, wordAspects }) {
  const fpx = (FOCAL * vh) / 2;
  const aspect = vw / vh;

  const wordFor = (maskAspect) => {
    const halfW = Math.min(0.88 * WORD_DISTANCE * aspect / FOCAL, 58);
    const k = halfW / 38;
    return { halfW, halfH: halfW / maskAspect, depth: Math.max(1.5, 2.5 * k), noise: Math.max(0.42, k) };
  };

  const reels = [];
  let z = 8;
  sections.forEach((section) => {
    if (section.kind !== 'reel') return;
    const frame = frames[reels.length];
    const dist = (SCREEN_WIDTH * fpx) / frame.width;
    // 150 de distância: o filme nasce longe, como um ponto no céu, e cresce enquanto a câmera se aproxima.
    const screenZ = z + dist + APPROACH;
    const offsetY = ((vh / 2 - (frame.top + frame.height / 2)) / fpx) * dist;
    reels.push({ z: screenZ, dist, offsetY, frame });
    z = screenZ + 8;
  });

  const lastZ = z;
  return {
    vw, vh, fpx, sections, reels,
    words: { title: wordFor(wordAspects.title), final: wordFor(wordAspects.final) },
    aboutEnd: lastZ + 120,
    finalWordZ: lastZ + 120 + 150,
  };
}

function project(plan, x, y, z, cam) {
  const d = z - cam.z;
  return [plan.vw / 2 + (plan.fpx * (x - cam.x)) / d, plan.vh / 2 - (plan.fpx * (y - cam.y)) / d];
}

export function sample(plan, scrollY, sway = 0) {
  const { sections, reels, words } = plan;
  let sectionIndex = sections.findIndex((s) => scrollY < s.top + s.height - plan.vh);
  if (sectionIndex < 0) sectionIndex = sections.length - 1;
  const section = sections[sectionIndex];
  const p = clamp((scrollY - section.top) / Math.max(section.height - plan.vh, 1));
  const total = sections[sections.length - 1].top + sections[sections.length - 1].height - plan.vh;
  const u = clamp(scrollY / Math.max(total, 1));

  const camera = { x: 0, y: 0, z: 0, pitch: 0 };
  const word = { on: 0, x: 0, y: 6, z: -9999, halfW: 1, halfH: 1, depth: 4, noise: words.title.noise, kind: 'title' };
  let screen = null;
  let curtain = 0;
  let reelIndex = -1;
  let slateOn = false;
  let slate = 0;
  let ui = 1;
  let hold = 0;

  if (section.kind === 'title') {
    const e = Math.pow(p, 1.7);
    camera.z = lerp(-WORD_DISTANCE, 8, e);
    camera.y = lerp(4, 5, smooth(p));
    camera.pitch = lerp(0.03, 0, smooth(range(p, 0, 0.6)));
    Object.assign(word, words.title, { on: 1, z: 0, kind: 'title' });
    word.y = 6;
    ui = 1 - smooth(range(p, 0.04, 0.3));
  } else if (section.kind === 'reel') {
    reelIndex = reels.findIndex((r) => r === reels[section.reel]);
    const reel = reels[section.reel];
    const start = reel.z - reel.dist - APPROACH;
    const holdZ = reel.z - reel.dist;
    const inEnd = 0.3, outStart = 0.74;
    // A câmera nunca para: chega desacelerando, flutua durante a pausa e acelera para atravessar o filme.
    if (p < inEnd) camera.z = lerp(start, holdZ, 1 - Math.pow(1 - p / inEnd, 2));
    else if (p < outStart) camera.z = lerp(holdZ, holdZ + reel.dist * 0.08, (p - inEnd) / (outStart - inEnd));
    else camera.z = lerp(holdZ + reel.dist * 0.08, reel.z + 8, Math.pow((p - outStart) / (1 - outStart), 1.8));
    camera.y = 5;
    camera.x = sway * 1.1 * smooth(range(p, 0.18, 0.3)) * (1 - range(p, 0.72, 0.8));
    slateOn = p > 0.24 && p < 0.8;
    slate = smooth(range(p, 0.22, 0.36)) * (1 - smooth(range(p, 0.7, 0.8)));
    hold = p > inEnd - 0.04 && p < outStart + 0.04 ? 1 : 0;

    const sy = camera.y + reel.offsetY;
    if (reel.z - camera.z > 1.5) {
      const halfW = SCREEN_WIDTH / 2, halfH = halfW / FRAME_ASPECT;
      const [left, top] = project(plan, -halfW, sy + halfH, reel.z, camera);
      const [right, bottom] = project(plan, halfW, sy - halfH, reel.z, camera);
      screen = {
        index: section.reel,
        x: 0,
        y: sy,
        z: reel.z,
        px: { left, top, width: right - left, height: bottom - top },
        scale: (right - left) / reel.frame.width,
        ndc: [
          (left / plan.vw) * 2 - 1,
          1 - (bottom / plan.vh) * 2,
          (right / plan.vw) * 2 - 1,
          1 - (top / plan.vh) * 2,
        ],
      };
    }
  } else if (section.kind === 'about') {
    const from = reels[reels.length - 1].z + 8;
    camera.z = lerp(from, plan.aboutEnd, p);
    camera.y = 5;
    camera.x = Math.sin(p * 3.14) * 3;
    ui = smooth(range(p, 0.03, 0.2)) * (1 - smooth(range(p, 0.88, 1)));
  } else {
    const from = plan.aboutEnd;
    const to = plan.finalWordZ - WORD_DISTANCE * 1.02;
    camera.z = lerp(from, to, 1 - Math.pow(1 - p, 2.4));
    camera.y = 5;
    camera.pitch = lerp(0, 0.03, p);
    Object.assign(word, words.final, { on: smooth(range(p, 0.02, 0.2)), z: plan.finalWordZ, kind: 'final' });
    word.y = 10;
    ui = smooth(range(p, 0.18, 0.5));
  }

  // O filme se dissolve no mesmo céu: aparece conforme cresce e some antes de a câmera atravessá-lo.
  const reveal = screen
    ? smooth(range(screen.scale, 0.22, 0.62)) * (1 - smooth(range(screen.scale, 1.5, 3.4)))
    : 0;

  return {
    focal: FOCAL, camera, word, screen, curtain,
    sky: dayAt(u),
    reveal,
    scene: section.kind, sceneIndex: sectionIndex, p, u, reelIndex, slateOn, slate, ui, hold,
  };
}
