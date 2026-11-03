# zcode-voice

Голосовой ввод для ZCode: диктовка по-русски → текст → сообщение модели. Распознавание **полностью локальное и офлайн** — открытая SOTA-модель для русской речи [GigaAM v3 CTC](https://github.com/salute-developers/GigaAM) (Сбер, декабрь 2025) через [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) на CPU. Без GPU, без интернета, без облачных API.

Кроссплатформенно: **Windows, macOS, Linux**. Никаких фоновых процессов, иконок в трее, горячих клавиш и внешних окон — вся индикация записи видна прямо в чате ZCode (ассистент сам пишет статус: «◉ запись идёт» → «● слышу речь» → «✓ Распознано»).

## Установка

1. Клонируйте репозиторий: `git clone https://github.com/machine202502/zcode-voice.git` (или скачайте ZIP и распакуйте).
2. В ZCode: **Plugin Marketplace → Add → Add Plugin Marketplace** → указать каталог клона, где лежит `marketplace.json` (в корне репозитория).
2. **Personal → dev-… → zcode-voice → Install**.
3. Первый запуск `/voice` сам предложит выполнить установку (движок + модель в пользовательский каталог данных, ~224 МБ, один раз). Либо вручную:
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1`
   - macOS/Linux: `sh scripts/setup.sh`

Требования: Windows 10/11 (встроенный PowerShell) или macOS/Linux с любым из рекордеров: `sox`, `alsa-utils` (arecord), `ffmpeg`. Node/Python не нужны.

## Использование

Панель **Voice** (основной способ): после установки плагина откройте **New tab → App plugins → Voice** (или значок микрофона в сайдбаре) → **● Записать** → говорите (в панели видно: «◉ СЛУШАЮ» → «● ЗАПИСЬ ИДЁТ» с таймером и шкалой) → после паузы текст появится в **редактируемом поле панели** → **⧉ Копировать** → вставьте в поле чата (Ctrl+V), поправьте и отправьте сами. Ничего не отправляется в чат автоматически.

| Что | Как |
|---|---|
| Продиктовать | Панель Voice → Записать → Копировать → Ctrl+V в чат |
| Расшифровать WAV | попросите агента (инструмент `voice_transcribe`) |
| Диагностика | панель сама предупредит, если движок/модель не установлены |

| Что | Как (для агента) |
|---|---|
| Записать и распознать | MCP-инструмент `voice_record` |
| Распознать файл | MCP-инструмент `voice_transcribe {wav}` |
| Статус установки | MCP-инструмент `voice_status` |

## Как это работает

- Запись: Windows — WinRT MediaCapture (встроен в ОС, WAV 16 кГц/моно); macOS/Linux — sox/arecord/ffmpeg, кто первый найдётся.
- Конец фразы: адаптивный порог тишины (калибровка по фону первые 1.5 c), авто-остановка после паузы.
- Распознавание: `sherpa-onnx-offline --nemo-ctc-model` (GigaAM v3 int8), ~0.2× длительности аудио на CPU.
- Минимальная пунктуация: заглавная буква и точка в конце фразы (модель выдаёт «голый» текст).

## Приватность

Аудио остаётся на вашей машине (`recordings/` в каталоге данных плагина). Распознавание офлайн; модели уходит только распознанный текст.

## Благодарности

- Референс-архитектура: [machine202502/dsh-voice-ext](https://github.com/machine202502/dsh-voice-ext) (GigaAM v3 CTC + sherpa-onnx, MIT).
- Модель: [salute-developers/GigaAM](https://github.com/salute-developers/GigaAM), ONNX-конверсия [csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16).
- Движок: [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
