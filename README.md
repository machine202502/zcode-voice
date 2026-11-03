# zcode-voice

Voice input plugin for [ZCode](https://z.ai): a dictation panel and a `/voice` command. Speak in Russian → get text → send it straight to the chat.

Recognition is **fully local and offline** — the open SOTA model for Russian speech [GigaAM v3 CTC](https://github.com/salute-developers/GigaAM) (Sber, December 2025) via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) on CPU. No GPU, no internet, no cloud APIs.

## Features

- 🎙 **Voice panel** (*New tab → App plugins → Voice*): `● Record` → live mic waveform + timer → colored progress (🔴 mic start / 🟡 recording / 🟢 transcription) → editable text → `⧉ Copy` / `⤴ To chat` / `✕ Clear`
- ⤴ **To chat** — sends the recognized text as your chat message in one click (the host asks for confirmation — by design)
- 💬 **`/voice` command** — hands-free dictation right in the chat: records, auto-stops after a pause, and the recognized text becomes your message
- 🤫 End of phrase detection: adaptive silence threshold (background calibration), auto-stop after 1.5 s of silence, 8 s no-speech timeout
- 🔒 Private: audio never leaves your machine
- 🪟 Windows (server-side recording via ffmpeg dshow)

## Install

1. Clone or download: `git clone https://github.com/machine202502/zcode-voice.git`
2. In ZCode: **Plugin Marketplace → Add → Add Plugin Marketplace** → point to the cloned folder (the one with `marketplace.json` at its root)
3. **Personal → zcode-voice → Install**
4. The first recording auto-downloads the engine + model (~224 MB, one time) into the user data directory. No Node/Python required — everything ships inside the plugin.

## Usage

| What | How |
|---|---|
| Dictate (panel) | Voice panel → `● Record` → speak → pause → edit → `⤴ To chat` or `⧉ Copy` |
| Dictate (chat) | Type `/voice` → speak → pause → the text is inserted as your message |
| Transcribe a WAV | Ask the agent (tool `voice_transcribe`) |
| Diagnostics | Ask the agent (tool `voice_status`) |

## How it works

- Recording: Windows — ffmpeg dshow (16 kHz mono WAV, streamed to disk per packet so short takes are never lost)
- End of phrase: adaptive threshold — the background level is calibrated during the first 1.5 s; speech must exceed it, then 1.5 s of silence finishes the take
- Recognition: `sherpa-onnx-offline`, GigaAM v3 int8, ~0.2× audio duration on CPU
- Minimal punctuation: a capital letter and a period (the model emits bare text)

## Privacy

Audio stays on your machine (`recordings/` inside the plugin data directory). Recognition is offline; only the recognized text goes to the model.

## Credits

- Reference architecture: [machine202502/dsh-voice-ext](https://github.com/machine202502/dsh-voice-ext) (GigaAM v3 CTC + sherpa-onnx, MIT)
- Model: [salute-developers/GigaAM](https://github.com/salute-developers/GigaAM), ONNX conversion [csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16)
- Engine: [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0)

---

## 🇷🇺 Русский

Голосовой ввод для ZCode: панель диктовки и команда `/voice`. Говоришь по-русски → получаешь текст → отправляешь прямо в чат.

Распознавание **полностью локальное и офлайн** — открытая SOTA-модель для русской речи [GigaAM v3 CTC](https://github.com/salute-developers/GigaAM) (Сбер, декабрь 2025) через [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) на CPU. Без GPU, без интернета, без облачных API.

**Возможности:** панель Voice с живой индикацией уровня и цветным прогрессом; кнопка «To chat» отправляет текст сообщением в чат; команда `/voice` — диктовка без рук прямо в чат с автостановкой по тишине; адаптивный порог шума; аудио не покидает машину.

**Установка:**
1. `git clone https://github.com/machine202502/zcode-voice.git`
2. ZCode → **Plugin Marketplace → Add → Add Plugin Marketplace** → указать каталог клона (где лежит `marketplace.json`)
3. **Personal → zcode-voice → Install**
4. Первая запись автоматически скачает движок и модель (~224 МБ, один раз)

**Как пользоваться:** панель — «Record» → говорите → пауза → правьте → «To chat» или «Copy»; либо `/voice` → говорите → пауза → текст сам встанет вашим сообщением; расшифровать WAV или продиагностировать — просто попросите агента (инструменты `voice_transcribe` и `voice_status`).
