import { Sky, buildWordMask } from './sky.js';
import { buildPlan, sample, FRAME_ASPECT } from './flight.js';
import {
  YT_ORIGIN, buildEmbedUrl, formatClock, isAllowedVideoId, listeningMessage,
  parsePlayerMessage, playerCommand,
} from './yt-core.js';

const root = document.documentElement;
// Hospedagens sem cabeçalhos (GitHub Pages) não aplicam frame-ancestors: esconde a página se estiver embutida.
if (window.self !== window.top) root.hidden = true;
const reelEls = [...document.querySelectorAll('[data-scene="reel"]')];

class ReelPlayer {
  constructor(section, chrome) {
    this.section = section;
    this.id = section.dataset.video;
    this.screen = section.querySelector('.screen');
    this.chrome = chrome;
    this.clock = chrome ? chrome.querySelector('[data-clock]') : section.querySelector('[data-clock]');
    this.iframe = null;
    this.alive = false;
    this.wantPlay = false;
    this.audible = false;
    this.started = false;
    this.playing = false;
    this.duration = Number(section.dataset.seconds) || 0;
  }

  load() {
    if (this.iframe || !isAllowedVideoId(this.id)) return;
    const iframe = document.createElement('iframe');
    iframe.title = this.section.dataset.title + ', muted video';
    iframe.tabIndex = -1;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    iframe.addEventListener('load', () => this.hello());
    iframe.src = buildEmbedUrl(this.id, window.location.origin);
    this.screen.querySelector('.screen-video').append(iframe);
    this.iframe = iframe;
  }

  // Descarrega o iframe de filmes já atravessados: cada player do YouTube pesa em memória e CPU.
  unload() {
    if (!this.iframe) return;
    clearInterval(this.helloTimer);
    this.iframe.remove();
    this.iframe = null;
    this.alive = this.started = this.playing = this.wantPlay = this.audible = false;
    this.screen.classList.remove('is-playing');
  }

  hello() {
    let tries = 0;
    clearInterval(this.helloTimer);
    this.helloTimer = setInterval(() => {
      if (this.alive || ++tries > 20) {
        clearInterval(this.helloTimer);
        return;
      }
      this.post(listeningMessage());
    }, 250);
    this.post(listeningMessage());
  }

  post(message) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(message, YT_ORIGIN);
    }
  }

  send(func, args) {
    this.post(playerCommand(func, args));
  }

  setPlaying(want) {
    if (want === this.wantPlay) return;
    this.wantPlay = want;
    if (want) this.load();
    if (this.alive) this.send(want ? 'playVideo' : 'pauseVideo');
  }

  applySound(on) {
    if (!this.alive || on === this.audible) return;
    this.audible = on;
    if (on) {
      this.send('unMute');
      this.send('setVolume', [90]);
    } else {
      this.send('mute');
    }
  }

  handle(message) {
    if (message.type === 'error') {
      this.section.classList.add('is-blocked');
      return;
    }
    if (!this.alive) {
      this.alive = true;
      this.send(this.wantPlay ? 'playVideo' : 'pauseVideo');
      this.applySound(soundOn && this.wantPlay);
    }
    if (message.duration > 0) this.duration = message.duration;
    if (message.state === 1) this.started = true;
    // O pôster só sai quando o vídeo já andou: evita um flash preto no carregamento.
    if (this.started && message.time > 0.4 && !this.playing) {
      this.playing = true;
      this.screen.classList.add('is-playing');
    }
    if (message.time !== undefined && this.clock) {
      this.clock.textContent = `${formatClock(message.time)} / ${formatClock(this.duration)}`;
    }
  }
}

let soundOn = false;
const players = [];

window.addEventListener('message', (event) => {
  const player = players.find((p) => p.iframe && p.iframe.contentWindow === event.source);
  if (!player) return;
  const message = parsePlayerMessage(event.origin, event.data);
  if (message) player.handle(message);
});

function setupSound(getActive) {
  const button = document.getElementById('sound');
  if (!button) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    soundOn = !soundOn;
    button.setAttribute('aria-pressed', String(soundOn));
    button.textContent = soundOn ? 'Sound on' : 'Sound off';
    players.forEach((p) => {
      if (p === getActive()) p.applySound(soundOn);
      else p.applySound(false);
    });
  });
}

// Sem movimento ou sem WebGL: página em fluxo normal, e o vídeo só carrega com um clique.
function startStatic() {
  root.classList.remove('fx');
  root.classList.add('static');
  reelEls.forEach((section) => {
    const player = new ReelPlayer(section, null);
    players.push(player);
    const button = section.querySelector('[data-load]');
    if (button) {
      button.hidden = false;
      button.addEventListener('click', () => {
        player.setPlaying(true);
        section.classList.add('is-loaded');
        button.hidden = true;
      });
    }
  });
}

function startFlight() {
  const canvas = document.getElementById('sky');
  const sky = new Sky(canvas, {
    onLost: () => window.location.reload(),
  });
  root.classList.add('fx');

  const scenes = [...document.querySelectorAll('[data-scene]')];
  const chromes = reelEls.map((section) => section.querySelector('.screen-chrome'));
  reelEls.forEach((section, i) => players.push(new ReelPlayer(section, chromes[i])));

  const hud = {
    bar: document.getElementById('progress-bar'),
    tc: document.getElementById('hud-tc'),
    alt: document.getElementById('hud-alt'),
    sun: document.getElementById('hud-sun'),
    reel: document.getElementById('hud-reel'),
  };

  let plan = null;
  let masks = {};
  let currentWord = '';
  let activePlayer = null;

  const measure = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const narrow = vw / vh < 1.05;
    masks = {
      title: buildWordMask(narrow ? ['DOMINI', 'MAKER'] : ['DOMINIMAKER']),
      final: buildWordMask(narrow ? ['@DOMINI', 'MAKER'] : ['@DOMINIMAKER']),
    };
    currentWord = '';

    const css = getComputedStyle(root);
    const barTop = parseFloat(css.getPropertyValue('--bar-top')) || 44;
    const barBottom = parseFloat(css.getPropertyValue('--bar-bottom')) || 40;
    const frames = reelEls.map((section, i) => {
      const slate = section.querySelector('.slate');
      const room = vh - barTop - barBottom - slate.offsetHeight - 24;
      const width = Math.round(Math.min(vw - (vw < 700 ? 0 : 48), room * FRAME_ASPECT));
      const height = Math.round(width / FRAME_ASPECT);
      const top = Math.round(barTop + 12 + Math.max(0, room - height) / 2);
      const screen = section.querySelector('.screen');
      screen.style.setProperty('--base-w', width + 'px');
      screen.style.setProperty('--base-h', height + 'px');
      chromes[i].style.setProperty('--base-w', width + 'px');
      return { width, height, top };
    });
    const sections = scenes.map((el) => ({
      kind: el.dataset.scene,
      reel: reelEls.indexOf(el),
      top: el.offsetTop,
      height: el.offsetHeight,
    }));
    plan = buildPlan({
      vw, vh, sections, frames,
      wordAspects: { title: masks.title.aspect, final: masks.final.aspect },
    });
    sky.resize();
  };

  let lastWidth = 0, lastHeight = 0;
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    // Barra de endereço do celular muda só a altura: não remede por tão pouco.
    if (w === lastWidth && Math.abs(h - lastHeight) < 120) return;
    lastWidth = w;
    lastHeight = h;
    measure();
  };
  window.addEventListener('resize', onResize);
  onResize();

  const setVar = (el, name, value) => {
    const text = value.toFixed(3);
    if (el.dataset['v' + name] === text) return;
    el.dataset['v' + name] = text;
    el.style.setProperty('--' + name, text);
  };
  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  let tick = 0;

  let sway = 0, swayTarget = 0;
  if (window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      swayTarget = (e.clientX / window.innerWidth) * 2 - 1;
    }, { passive: true });
  }

  setupSound(() => activePlayer);

  let smoothY = window.scrollY;
  let last = performance.now();
  let lastActive = -2;

  const clearScreens = (except) => {
    reelEls.forEach((section, i) => {
      if (i === except) return;
      section.classList.remove('is-active', 'slate-on');
    });
  };

  const frame = (now) => {
    requestAnimationFrame(frame);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(now - last, 100);
    last = now;
    // Aba em segundo plano recebe poucos quadros: isso não diz nada sobre a placa de vídeo.
    if (document.hasFocus()) sky.adapt(dt);

    const targetY = window.scrollY;
    // Inércia longa: o voo continua deslizando um instante depois que a rolagem para.
    smoothY += (targetY - smoothY) * (1 - Math.exp(-dt * 0.0062));
    if (Math.abs(targetY - smoothY) < 0.2) smoothY = targetY;
    const moving = Math.abs(targetY - smoothY) > 1;
    sway += (swayTarget - sway) * (1 - Math.exp(-dt * 0.002));

    const state = sample(plan, smoothY, sway);

    if (state.word.kind !== currentWord) {
      sky.setWord(masks[state.word.kind]);
      currentWord = state.word.kind;
    }

    // Parado, as nuvens só derivam devagar: 30 quadros bastam e poupam metade da GPU.
    tick++;
    if (moving || tick % 2 === 0) sky.render(state, now / 1000, moving);

    const sceneEl = scenes[state.sceneIndex];
    setVar(sceneEl, 'ui', state.ui);

    const active = state.scene === 'reel' ? state.reelIndex : -1;
    if (active !== lastActive) {
      clearScreens(active);
      lastActive = active;
      root.dataset.scene = state.scene;
    }
    if (active >= 0) {
      const section = reelEls[active];
      section.classList.add('is-active');
      section.classList.toggle('slate-on', state.slateOn);
      setVar(section, 'slate', state.slate);
      if (state.screen) {
        const { left, top, width, height } = state.screen.px;
        const base = plan.reels[active].frame;
        const s = Math.min(state.screen.scale, 16);
        const screen = section.querySelector('.screen');
        screen.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
        const chrome = chromes[active];
        chrome.style.transform = `translate(${left}px, ${top}px)`;
        chrome.style.width = width + 'px';
        chrome.style.height = height + 'px';
        chrome.classList.toggle('is-far', width < base.width * 0.55);
        setVar(chrome, 'on', state.reveal);
      }
      section.classList.toggle('has-screen', !!state.screen);
    }

    players.forEach((player, i) => {
      // Só o filme atual e, perto da saída, o próximo ficam carregados.
      const near = i === active
        || (i === active + 1 && state.p > 0.5)
        || (active < 0 && state.scene === 'title' && state.p > 0.4 && i === 0);
      if (near) player.load();
      else if (i < active || state.scene === 'about' || state.scene === 'final') player.unload();
      const shouldPlay = i === active && state.curtain < 0.8 && !!state.screen;
      player.setPlaying(shouldPlay);
      if (i !== active) player.applySound(false);
    });
    const nextActive = active >= 0 ? players[active] : null;
    if (nextActive !== activePlayer) {
      activePlayer = nextActive;
      if (activePlayer && soundOn) activePlayer.applySound(true);
    }

    hud.bar.style.transform = `scaleX(${state.u.toFixed(4)})`;
    const frames = Math.floor(smoothY / 4);
    const pad = (n) => String(n).padStart(2, '0');
    setText(hud.tc, `${pad(Math.floor(frames / 86400) % 24)}:${pad(Math.floor(frames / 1440) % 60)}:${pad(Math.floor(frames / 24) % 60)}:${pad(frames % 24)}`);
    setText(hud.alt, String(Math.round(3200 + state.camera.y * 40 + state.u * 600)).padStart(4, '0'));
    setText(hud.sun, state.sky.name.toUpperCase());
    setText(hud.reel, active >= 0 ? `${pad(active + 1)}/${pad(reelEls.length)}` : '--/' + pad(reelEls.length));
  };
  requestAnimationFrame(frame);
}

function boot() {
  const forced = new URLSearchParams(window.location.search).get('motion') === 'full';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !forced;
  const tooShort = window.innerHeight < 480;
  if (reduced || tooShort) {
    startStatic();
    // Janela que abriu baixa demais: volta ao voo completo assim que ficar do tamanho normal.
    if (tooShort && !reduced) {
      window.addEventListener('resize', () => {
        if (window.innerHeight >= 480) window.location.reload();
      });
    }
    // O sistema pede menos movimento (no Windows, "animações" desligadas): respeita, mas deixa ligar.
    const full = document.getElementById('fx-on');
    if (full && reduced) {
      full.hidden = false;
      full.addEventListener('click', () => { window.location.search = '?motion=full'; });
    }
    return;
  }
  try {
    startFlight();
  } catch (error) {
    console.warn('Voo indisponível, usando a versão estática:', error.message);
    startStatic();
  }
}

boot();
