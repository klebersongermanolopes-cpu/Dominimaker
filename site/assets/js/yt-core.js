// Tudo que toca o YouTube passa por aqui. Sem DOM, para poder ser testado no Node.
// Nenhum script do YouTube roda nesta origem: o player fica isolado num iframe com sandbox
// e a conversa acontece só por postMessage, com origem conferida nos dois sentidos.

export const YT_ORIGIN = 'https://www.youtube-nocookie.com';

export const VIDEO_IDS = Object.freeze([
  'LixZqTkPQvs',
  'j4P1Nhs7qIE',
  '_o0JfgBWUwQ',
  'Hs0HayhSx2Y',
]);

const ID_FORMAT = /^[A-Za-z0-9_-]{11}$/;
const MAX_MESSAGE = 64 * 1024;
const COMMANDS = new Set(['playVideo', 'pauseVideo', 'mute', 'unMute', 'setVolume']);

export function isAllowedVideoId(id) {
  return typeof id === 'string' && ID_FORMAT.test(id) && VIDEO_IDS.includes(id);
}

export function buildEmbedUrl(id, pageOrigin) {
  if (!isAllowedVideoId(id)) throw new Error('vídeo fora da lista permitida');
  const url = new URL(`/embed/${id}`, YT_ORIGIN);
  const params = {
    autoplay: '1',
    mute: '1',
    loop: '1',
    playlist: id,
    controls: '0',
    disablekb: '1',
    fs: '0',
    iv_load_policy: '3',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (isHttpOrigin(pageOrigin)) url.searchParams.set('origin', pageOrigin);
  return url.href;
}

function isHttpOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.origin === value
      && /^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:]+\]$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function watchUrl(id) {
  if (!isAllowedVideoId(id)) throw new Error('vídeo fora da lista permitida');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function playerCommand(func, args = []) {
  if (!COMMANDS.has(func)) throw new Error('comando não permitido');
  return JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' });
}

export function listeningMessage() {
  return JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// Devolve só campos numéricos conhecidos. Mensagem de outra origem, quebrada ou gigante vira null.
export function parsePlayerMessage(origin, data) {
  if (origin !== YT_ORIGIN) return null;
  if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
  let message;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (message === null || typeof message !== 'object' || typeof message.event !== 'string') return null;

  const { event, info } = message;
  if (event === 'onReady') return { type: 'ready' };
  if (event === 'onError') return { type: 'error' };
  if (event === 'onStateChange') {
    const state = finite(info);
    return state === undefined ? null : { type: 'info', state };
  }
  if ((event === 'infoDelivery' || event === 'initialDelivery') && info !== null && typeof info === 'object') {
    return {
      type: 'info',
      state: finite(info.playerState),
      time: finite(info.currentTime),
      duration: finite(info.duration),
    };
  }
  return null;
}

export function formatClock(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  return `${String(m).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
