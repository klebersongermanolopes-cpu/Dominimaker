// Regras de confiança do player e o roteiro do voo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIDEO_IDS, YT_ORIGIN, buildEmbedUrl, formatClock, isAllowedVideoId,
  parsePlayerMessage, playerCommand, watchUrl,
} from '../site/assets/js/yt-core.js';
import { buildPlan, dayAt, sample, DAY } from '../site/assets/js/flight.js';

test('só os quatro vídeos passam na lista', () => {
  for (const id of VIDEO_IDS) assert.equal(isAllowedVideoId(id), true);
  for (const bad of ['dQw4w9WgXcQ', '', null, undefined, 42, {}, ['LixZqTkPQvs'], '../../evil', 'LixZqTkPQvs?x=1', 'LixZqTkPQvs/', '<script>', 'a'.repeat(5000)]) {
    assert.equal(isAllowedVideoId(bad), false, String(bad));
  }
});

test('URL do player é sempre do domínio sem cookies e com os parâmetros certos', () => {
  const url = new URL(buildEmbedUrl(VIDEO_IDS[0], 'https://dominimaker.com'));
  assert.equal(url.origin, YT_ORIGIN);
  assert.equal(url.pathname, `/embed/${VIDEO_IDS[0]}`);
  assert.equal(url.searchParams.get('autoplay'), '1');
  assert.equal(url.searchParams.get('mute'), '1');
  assert.equal(url.searchParams.get('origin'), 'https://dominimaker.com');
  assert.throws(() => buildEmbedUrl('dQw4w9WgXcQ', 'https://x.com'));
  assert.throws(() => buildEmbedUrl('../../evil', 'https://x.com'));
  assert.throws(() => watchUrl('evil'));
});

test('origem inválida da página não entra na URL', () => {
  for (const origin of ['javascript:alert(1)', 'null', 'https://a.com/path', 'https://a.com&autoplay=0', '', undefined]) {
    const url = new URL(buildEmbedUrl(VIDEO_IDS[0], origin));
    assert.equal(url.searchParams.get('origin'), null, String(origin));
  }
});

test('mensagem de qualquer outra origem é descartada', () => {
  const valid = JSON.stringify({ event: 'onReady' });
  assert.deepEqual(parsePlayerMessage(YT_ORIGIN, valid), { type: 'ready' });
  for (const origin of [
    'https://evil.example', 'https://www.youtube.com', 'http://www.youtube-nocookie.com',
    'https://www.youtube-nocookie.com.evil.example', 'https://evil.example/https://www.youtube-nocookie.com',
    'null', '', undefined,
  ]) {
    assert.equal(parsePlayerMessage(origin, valid), null, String(origin));
  }
});

test('mensagem malformada, gigante ou de tipo errado é descartada', () => {
  const junk = [
    '', '{', 'null', '[]', '42', '"texto"', '{"event":1}', '{}', undefined, null, 42, {}, [],
    '{"event":"desconhecido"}', '{"event":"infoDelivery"}', '{"event":"infoDelivery","info":null}',
    '{"event":"onStateChange","info":"1"}', JSON.stringify({ event: 'onReady', pad: 'x'.repeat(70000) }),
  ];
  for (const data of junk) assert.equal(parsePlayerMessage(YT_ORIGIN, data), null, String(data).slice(0, 40));
});

test('só números finitos saem da mensagem e nada contamina protótipos', () => {
  const evil = '{"event":"infoDelivery","info":{"currentTime":"<img src=x onerror=alert(1)>","duration":1e999,"playerState":{"a":1},"__proto__":{"polluted":true}},"__proto__":{"polluted":true}}';
  const parsed = parsePlayerMessage(YT_ORIGIN, evil);
  assert.deepEqual(parsed, { type: 'info', state: undefined, time: undefined, duration: undefined });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(
    parsePlayerMessage(YT_ORIGIN, '{"event":"infoDelivery","info":{"currentTime":3.5,"duration":29,"playerState":1,"extra":"x"}}'),
    { type: 'info', state: 1, time: 3.5, duration: 29 }
  );
});

test('só comandos da lista chegam ao player', () => {
  assert.equal(JSON.parse(playerCommand('playVideo')).func, 'playVideo');
  for (const func of ['loadVideoById', 'cueVideoByUrl', 'destroy', '__proto__', '']) {
    assert.throws(() => playerCommand(func), undefined, func);
  }
});

test('relógio do vídeo aguenta valores absurdos', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(113), '01:53');
  for (const bad of [NaN, Infinity, -1, '10', null, undefined]) assert.equal(formatClock(bad), '--:--');
});

function planFor(vw, vh) {
  const heights = { title: vh * 3.2, reel: vh * 4, about: vh * 2.4, final: vh * 2.4 };
  const kinds = ['title', 'reel', 'reel', 'reel', 'reel', 'about', 'final'];
  let top = 0, reel = 0;
  const sections = kinds.map((kind) => {
    const section = { kind, top, height: heights[kind], reel: kind === 'reel' ? reel++ : -1 };
    top += section.height;
    return section;
  });
  const width = Math.min(vw - 48, 1100), height = width / 2.39;
  const frames = [0, 1, 2, 3].map(() => ({ width, height, top: 60 }));
  return buildPlan({ vw, vh, sections, frames, wordAspects: { title: 6, final: 6 } });
}

test('o voo sempre avança e nunca gera número inválido', () => {
  for (const [vw, vh] of [[1440, 900], [1024, 768], [375, 812], [2560, 1080]]) {
    const plan = planFor(vw, vh);
    const end = plan.sections.at(-1).top + plan.sections.at(-1).height - vh;
    let lastZ = -Infinity;
    for (let y = 0; y <= end; y += vh / 16) {
      const s = sample(plan, y);
      for (const v of [s.camera.x, s.camera.y, s.camera.z, s.camera.pitch, s.curtain, s.u, s.p]) {
        assert.ok(Number.isFinite(v), `${vw}x${vh} y=${y}`);
      }
      assert.ok(s.camera.z >= lastZ - 1e-6, `recuou em y=${y}: ${lastZ} -> ${s.camera.z}`);
      lastZ = s.camera.z;
      assert.ok(s.curtain >= 0 && s.curtain <= 1);
    }
  }
});

test('durante a pausa de cada filme a tela ocupa o quadro reservado e as nuvens abrem', () => {
  const plan = planFor(1440, 900);
  plan.sections.filter((s) => s.kind === 'reel').forEach((section) => {
    const s = sample(plan, section.top + (section.height - 900) * 0.5);
    assert.equal(s.curtain, 0);
    assert.equal(s.slateOn, true);
    const { frame } = plan.reels[section.reel];
    assert.ok(Math.abs(s.screen.px.width / frame.width - 1) < 0.1);
    assert.ok(Math.abs(s.screen.px.top - frame.top) < 60);
  });
});

test('o filme nasce longe e some no mesmo céu, sem cortina nem corte seco', () => {
  const plan = planFor(1440, 900);
  plan.sections.filter((s) => s.kind === 'reel').forEach((section) => {
    const span = section.height - 900;
    assert.equal(sample(plan, section.top).reveal, 0);
    assert.equal(sample(plan, section.top + span * 0.5).reveal, 1);
    assert.equal(sample(plan, section.top + span * 0.99).reveal, 0);
    // A revelação muda aos poucos: nenhum passo de rolagem de 1/40 de tela salta mais que 0,35.
    let last = 0;
    for (let y = 0; y <= span; y += 900 / 40) {
      const r = sample(plan, section.top + y).reveal;
      assert.ok(Math.abs(r - last) < 0.35, `salto de ${last} para ${r} em y=${y}`);
      last = r;
    }
  });
});

test('a câmera emenda de um filme para o outro sem salto de posição', () => {
  const plan = planFor(1440, 900);
  const reels = plan.sections.filter((s) => s.kind === 'reel');
  for (let i = 0; i < reels.length - 1; i++) {
    const end = sample(plan, reels[i].top + reels[i].height - 900).camera.z;
    const next = sample(plan, reels[i + 1].top).camera.z;
    assert.ok(Math.abs(next - end) < 8, `salto de ${end} para ${next}`);
  }
});

test('o dia vai de manhã a noite sem sair do intervalo', () => {
  assert.equal(dayAt(0).name, DAY[0].name);
  assert.equal(dayAt(1).name, DAY.at(-1).name);
  assert.equal(dayAt(-5).name, DAY[0].name);
  assert.equal(dayAt(9).name, DAY.at(-1).name);
  for (let u = 0; u <= 1; u += 0.05) {
    const day = dayAt(u);
    assert.ok(Math.abs(Math.hypot(...day.sunDir) - 1) < 1e-6);
    assert.ok(day.stars >= 0 && day.stars <= 1);
  }
});
