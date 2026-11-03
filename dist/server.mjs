// zcode-voice MCP server: recording runs in the PLUGIN BACKEND (ffmpeg, dshow),
// the Voice panel is UI only. Recognition: sherpa-onnx-offline (GigaAM v3), fully local.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IS_WIN = process.platform === 'win32';
const SHERPA_VERSION = '1.13.8';
const SHERPA_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MD-Release.tar.bz2`;
const MODEL_REPO = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16/resolve/main';
const MODEL_SHA = 'f86ebfa0429ced91be6054fc344827e9c6c2572f3c318416cd974b06f66437ec';
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
const MAX_RECORD_SEC = 180;

function dataRoot() {
  if (process.env.ZCODE_VOICE_DATA_ROOT) return process.env.ZCODE_VOICE_DATA_ROOT;
  if (IS_WIN) return join(process.env.LOCALAPPDATA || '.', 'zcode-voice');
  return join(process.env.HOME || '.', 'Library/Application Support/zcode-voice');
}
const enginePath = () => join(dataRoot(), 'bin', IS_WIN ? 'sherpa-onnx-offline.exe' : 'sherpa-onnx-offline');
const modelPath = () => join(dataRoot(), 'models', 'gigaam-v3', 'model.int8.onnx');
const tokensPath = () => join(dataRoot(), 'models', 'gigaam-v3', 'tokens.txt');
const PANEL_HTML = join(ROOT, 'dist', 'ui', 'panel.html');

const DBG = (...a) => { try { writeFileSync(join(dataRoot(), 'debug.log'), new Date().toISOString().slice(11, 23) + ' ' + a.map(String).join(' ') + String.fromCharCode(10), { flag: 'a' }); } catch { } };
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyErr = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

function spawnRun(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(e));
    p.on('exit', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error((err || `код ${code}`).trim().slice(-300)))));
  });
}

// --- установка движка и модели (node fetch + системный tar, без внешних скриптов) ---
async function download(url, out, expectSha) {
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectSha) {
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== expectSha) throw new Error(`SHA-256 mismatch: ${got}`);
  }
  writeFileSync(out, buf);
  return buf.length;
}

async function ensureEngine() {
  if (existsSync(enginePath())) return;
  const archive = join(dataRoot(), 'sherpa.tar.bz2');
  const extract = join(dataRoot(), '.extract');
  mkdirSync(extract, { recursive: true });
  await download(SHERPA_URL, archive);
  const tar = IS_WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  await spawnRun(tar, ['-xf', archive, '-C', extract]);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(exe|dll)$/i.test(name)) {
        mkdirSync(join(dataRoot(), 'bin'), { recursive: true });
        writeFileSync(join(dataRoot(), 'bin', name), readFileSync(full));
      }
    }
  };
  walk(extract);
  try { rmSync(archive, { force: true }); rmSync(extract, { recursive: true, force: true }); } catch { }
  if (!existsSync(enginePath())) throw new Error('sherpa-onnx-offline not found in the archive');
}

async function ensureModel() {
  mkdirSync(join(dataRoot(), 'models', 'gigaam-v3'), { recursive: true });
  if (existsSync(modelPath())) {
    const got = createHash('sha256').update(readFileSync(modelPath())).digest('hex');
    if (got === MODEL_SHA && existsSync(tokensPath())) return;
  }
  await download(`${MODEL_REPO}/model.int8.onnx`, modelPath(), MODEL_SHA);
  await download(`${MODEL_REPO}/tokens.txt`, tokensPath());
}

async function setup() {
  await ensureEngine();
  await ensureModel();
  return { engine: 'ok', model: 'ok' };
}

// --- распознавание ---
function tidy(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  let t = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!/[.!?…]$/.test(t)) t += '.';
  return t;
}

async function transcribeFile(wav) {
  if (!existsSync(wav)) throw new Error(`file not found: ${wav}`);
  if (!existsSync(enginePath())) throw new Error('engine is not installed - run voice_setup');
  const { out } = await spawnRun(enginePath(), [
    `--nemo-ctc-model=${modelPath()}`, `--tokens=${tokensPath()}`, '--num-threads=2', wav,
  ]);
  const parsed = JSON.parse(out.trim());
  return { text: tidy(parsed.text) };
}

// --- запись на серверной части: ffmpeg (системный или скачанный плагином) ---
async function hasDshow(ffmpeg) {
  try {
    const { out } = await spawnRun(ffmpeg, ['-hide_banner', '-demuxers']);
    return /dshow/i.test(out);
  } catch { return false; }
}

async function findFfmpeg() {
  const local = join(dataRoot(), 'bin', 'ffmpeg.exe');
  if (existsSync(local) && (await hasDshow(local))) return local;
  try {
    const { out } = await spawnRun(IS_WIN ? 'where.exe' : 'which', ['ffmpeg']);
    const p = out.trim().split(/\r?\n/)[0];
    if (p && (await hasDshow(p))) return p;
  } catch { }
  return null;
}

async function ensureFfmpeg() {
  const found = await findFfmpeg();
  if (found) return found;
  if (!IS_WIN) throw new Error('ffmpeg not found. Install ffmpeg (brew install ffmpeg / apt install ffmpeg) and try again.');
  // статическая сборка (один раз), достаём ffmpeg.exe
  const zip = join(dataRoot(), 'ffmpeg.zip');
  const extract = join(dataRoot(), '.ffmpeg-extract');
  mkdirSync(extract, { recursive: true });
  await download(FFMPEG_URL, zip);
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  await spawnRun(tar, ['-xf', zip, '-C', extract]);
  let exe = null;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'ffmpeg.exe') exe = full;
    }
  };
  walk(extract);
  if (!exe) throw new Error('ffmpeg.exe not found in the archive');
  mkdirSync(join(dataRoot(), 'bin'), { recursive: true });
  writeFileSync(join(dataRoot(), 'bin', 'ffmpeg.exe'), readFileSync(exe));
  try { rmSync(zip, { force: true }); rmSync(extract, { recursive: true, force: true }); } catch { }
  return join(dataRoot(), 'bin', 'ffmpeg.exe');
}

let micDevice = null;
async function pickMic() {
  if (micDevice) return micDevice;
  const ffmpeg = await ensureFfmpeg();
  let err = '';
  await new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { windowsHide: true });
    const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } resolve(); }, 12000);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => { clearTimeout(killer); resolve(); });
    p.on('exit', () => { clearTimeout(killer); resolve(); });
  });
  const norm = err.split(String.fromCharCode(13)).join('');
  const audioIdx = norm.toLowerCase().indexOf('directshow audio devices');
  const section = audioIdx >= 0 ? norm.slice(audioIdx) : norm;
  const names = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const mic = names.find((n) => /микрофон|microphone|micro/i.test(n)) || names[0];
  if (!mic) {
    throw new Error('DirectShow sees no audio input: the microphone is missing, disabled, or not passed through to the system (VM). Check Settings -> Sound -> Input.');
  }
  micDevice = mic;
  return mic;
}

// активная сессия записи (одна одновременно)
let rec = null;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordStart() {
  if (rec) return { already: true, startedAt: rec.startedAt };
  if (!IS_WIN) throw new Error('server-side recording is supported on Windows (ffmpeg dshow)');
  const ffmpeg = await ensureFfmpeg();
  const dir = join(dataRoot(), 'recordings');
  mkdirSync(dir, { recursive: true });
  // синхронно бронируем слот до всяких await, чтобы параллельный вызов не создал вторую запись
  const session = { child: null, raw: '', wav: '', startedAt: Date.now(), manualStop: false, timer: null };
  rec = session;
  let lastDevice = '';
  try {
    // захват может не стартовать разово (устройство занято другим приложением на миг) - до 3 попыток
    for (let attempt = 0; attempt < 3; attempt++) {
      const device = await pickMic();
      lastDevice = device;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      session.raw = join(dir, `voice-${stamp}.raw`);
      session.wav = join(dir, `voice-${stamp}.wav`);
      const child = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'dshow', '-i', `audio=${device}`,
        '-ar', '16000', '-ac', '1', '-f', 's16le',
        // сбрасывать каждый пакет на диск сразу: без этого данные копятся в буфере
        // ~256КБ и короткие записи (несколько секунд) остаются пустыми файлами
        '-flush_packets', '1', session.raw,
      ], { windowsHide: true });
      session.child = child;
      // убедимся, что pcm реально течёт в файл (до 3с), иначе считаем попытку неудачной
      const flowing = await new Promise((resolve) => {
        const probe = setInterval(() => {
          try { if (statSync(session.raw).size > 0) { clearInterval(probe); resolve(true); } } catch { }
        }, 150);
        const giveup = setTimeout(() => { clearInterval(probe); resolve(false); }, 3000);
        child.on('exit', () => { clearInterval(probe); clearTimeout(giveup); resolve(false); });
      });
      if (flowing) {
        child.on('exit', () => {
          if (session.timer) clearTimeout(session.timer);
          if (!session.manualStop && rec === session) rec = null;
        });
        session.timer = setTimeout(() => { if (rec === session) stopRecording().catch(() => { }); }, (MAX_RECORD_SEC + 10) * 1000);
        return { started: true, device, maxSeconds: MAX_RECORD_SEC };
      }
      try { child.kill('SIGKILL'); } catch { }
      await new Promise((r) => { child.on('exit', r); setTimeout(r, 1500); });
      session.child = null;
      micDevice = null; // переопределить устройство на следующей попытке
      await sleepMs(400);
    }
    throw new Error(`microphone "${lastDevice}" did not start streaming: busy or unavailable. Close other apps using the microphone and try again.`);
  } catch (e) {
    if (session.child) { try { session.child.kill('SIGKILL'); } catch { } }
    if (rec === session) rec = null;
    throw e;
  }
}

function wrapWav(rawPath, wavPath) {
  const dataLen = statSync(rawPath).size;
  if (dataLen < 3200) throw new Error('recording is empty - the microphone produced no signal');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(dataLen + 36, 4);
  head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(dataLen, 40);
  const data = readFileSync(rawPath);
  writeFileSync(wavPath, Buffer.concat([head, data]));
}

async function stopRecording() {
  if (rec && !rec.child) throw new Error('recording is still starting, one moment…');
  if (!rec || !rec.child) { rec = null; throw new Error('no recording in progress'); }
  const session = rec;
  rec = null;
  session.manualStop = true;
  const duration = (Date.now() - session.startedAt) / 1000;
  try { session.child.kill(); } catch { }
  await new Promise((resolve) => {
    if (session.child.exitCode != null) return resolve();
    session.child.on('exit', resolve);
    setTimeout(resolve, 3000);
  });
  wrapWav(session.raw, session.wav);
  try { rmSync(session.raw, { force: true }); } catch { }
  const result = await transcribeFile(session.wav);
  return { ...result, seconds: Math.round(duration), wav: session.wav };
}

async function cancelRecording() {
  if (!rec) return;
  const session = rec;
  rec = null;
  session.manualStop = true;
  if (session.timer) clearTimeout(session.timer);
  try { session.child.kill('SIGKILL'); } catch { }
  try { rmSync(session.raw, { force: true }); } catch { }
}

// rms хвоста pcm-файла (s16le 16k mono)
function tailRms(path, bytes) {
  let buf = null;
  try {
    const size = statSync(path).size;
    const len = Math.min(bytes, size);
    if (len < 2) return 0;
    const fd = openSync(path, 'r');
    buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
  } catch { return 0; }
  let sum = 0, n = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i); sum += v * v; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}

// запись с автостановкой по тишине: блокируется до конца фразы, потом распознаёт
async function recordAuto() {
  await recordStart();
  const session = rec;
  if (!session || !session.child) throw new Error('recording did not start');
  const startedAt = Date.now();
  let baseline = -1, threshold = 0, speechSeen = false, lastSpeechAt = 0, lastSize = 0;
  try {
    while (true) {
      await sleepMs(250);
      if (rec !== session) throw new Error('recording was stopped manually');
      let size = 0;
      try { size = statSync(session.raw).size; } catch { }
      if (size > lastSize) {
        const rms = tailRms(session.raw, Math.min(size - lastSize + 3200, 32000));
        if (threshold === 0) {
          // адаптивный порог: калибровка по фону первых 1.5 c
          if (Date.now() - startedAt < 1500) {
            if (baseline < 0 || rms < baseline) baseline = rms;
          } else {
            threshold = baseline >= 0 && baseline < 200 ? Math.max(120, baseline * 3) : 120;
          }
        }
        if (threshold > 0 && rms >= threshold) { speechSeen = true; lastSpeechAt = Date.now(); }
        lastSize = size;
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      if (speechSeen && Date.now() - lastSpeechAt >= 1500) break;
      if (!speechSeen && elapsed >= 8) {
        await cancelRecording();
        throw new Error('no speech detected within 8s. Check the microphone (level/muted) and try /voice again.');
      }
      if (elapsed >= MAX_RECORD_SEC) break;
    }
  } catch (e) {
    if (rec === session) await cancelRecording();
    throw e;
  }
  const result = await stopRecording();
  return { ...result, mode: 'auto' };
}

const TOOLS = [
  {
    name: 'voice_setup',
    description: 'Install/repair zcode-voice: download the sherpa-onnx engine and the GigaAM v3 model (~224 MB, once), plus ffmpeg if missing. After setup the Voice panel is ready to record.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_record_start',
    description: 'Start microphone recording in the plugin backend (ffmpeg dshow). Returns {started}. Stop with voice_record_stop. Voice panel service tool; do not call without a user request.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_record',
    description: 'Record microphone speech and transcribe it (GigaAM v3, local; Russian-oriented model). Blocks until the phrase ends: stops automatically after 1.5 s of silence (max 180 s; errors if no speech within 8 s). Returns {text, seconds, wav}. Use for voice dictation on user request.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_level',
    description: 'Current input level of the active recording (rms 0..~10000). Voice panel service tool for the level indicator.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_record_stop',
    description: 'Stop the recording and transcribe it (GigaAM v3). Returns {text}. Voice panel service tool.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_transcribe',
    description: 'Transcribe a ready PCM WAV file (16 kHz mono works best) locally (GigaAM v3). Returns the text.',
    inputSchema: { type: 'object', properties: { wav: { type: 'string', description: 'Path to a wav file' } }, required: ['wav'] },
  },
  {
    name: 'voice_log_ui',
    description: 'Service: append a ui-bridge probe result to the log (ui-probe.log).',
    inputSchema: { type: 'object', properties: { data: { type: 'string', description: 'Log line' } }, required: ['data'] },
  },
  {
    name: 'voice_status',
    description: 'zcode-voice diagnostics: engine, model, ffmpeg, active recording.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

async function callTool(name, args) {
  if (name === 'voice_setup') return setup();
  if (name === 'voice_record') return recordAuto();
  if (name === 'voice_level') {
    if (!rec || !rec.child) return { recording: false, rms: 0 };
    return { recording: true, rms: tailRms(rec.raw, 6400) };
  }
  if (name === 'voice_record_start') return recordStart();
  if (name === 'voice_record_stop') return stopRecording();
  if (name === 'voice_transcribe') return transcribeFile(args && args.wav);
  if (name === 'voice_log_ui') {
    try { writeFileSync(join(dataRoot(), 'ui-probe.log'), new Date().toISOString() + ' ' + (args && args.data) + '\n', { flag: 'a' }); } catch { }
    return { logged: true };
  }
  if (name === 'voice_status') {
    return {
      dataRoot: dataRoot(),
      engine: existsSync(enginePath()) ? 'ok' : 'missing (voice_setup)',
      model: existsSync(modelPath()) ? 'ok' : 'missing (voice_setup)',
      ffmpeg: (await findFfmpeg().catch(() => null)) ? 'ok' : 'will be downloaded on first recording',
      recording: rec && rec.child ? 'active' : 'idle',
      rms: rec && rec.child ? tailRms(rec.raw, 6400) : 0,
      panel: 'New tab -> App plugins -> Voice',
    };
  }
  throw new Error('unknown tool: ' + name);
}

// --- JSON-RPC over stdio (MCP, newline-delimited) ---
createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'zcode-voice', version: '1.0.1' },
      });
      break;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      break;
    case 'resources/list':
      reply(id, { resources: [{
        uri: 'ui://voice/panel.html',
        name: 'Voice panel',
        mimeType: 'text/html;profile=mcp-app',
        _meta: { ui: { resourceUri: 'ui://voice/panel.html' } },
      }] });
      break;
    case 'resources/read': {
      const uri = (params && params.uri) || '';
      if (uri.endsWith('panel.html')) {
        reply(id, { contents: [{
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: readFileSync(PANEL_HTML, 'utf8'),
          _meta: { ui: { resourceUri: uri } },
        }] });
      } else replyErr(id, -32602, 'unknown resource: ' + uri);
      break;
    }
    case 'tools/list':
      reply(id, { tools: TOOLS });
      break;
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOL_NAMES.has(name)) { replyErr(id, -32602, 'no such tool: ' + name); break; }
      const token = params && params._meta && params._meta.progressToken;
      if (token != null) notify('notifications/progress', { progressToken: token, progress: 0, total: 1, message: 'working…' });
      callTool(name, params && params.arguments)
        .then((r) => reply(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: r }))
        .catch((e) => reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }));
      break;
    }
    case 'ping':
      if (id != null) reply(id, {});
      break;
    default:
      if (id != null) replyErr(id, -32601, 'method not supported: ' + method);
  }
});
process.on('disconnect', () => process.exit(0));

// фоновая проверка установки при старте (не блокирует MCP)
(async () => {
  try {
    if (!existsSync(enginePath()) || !existsSync(modelPath())) await setup();
  } catch (e) {
    try { writeFileSync(join(dataRoot(), 'server.log'), new Date().toISOString() + ' setup: ' + e.message + '\n', { flag: 'a' }); } catch { }
  }
})();
