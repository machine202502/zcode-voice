---
description: Voice dictation — record microphone speech and insert the text as my message
---

The user invoked zcode-voice voice dictation. Follow this scenario strictly:

1. Write exactly one short line to the chat: “◉ Speak now… recording stops automatically after a pause (max 3 min)” — and IMMEDIATELY, in the same turn, call the MCP tool `voice_record` (no arguments). It blocks while the speech is ongoing; that is normal.
2. The tool returns { text, seconds }. The `text` field is the user's verbatim voice message. Output the line “✓ Recognized: "<text>"”, then respond to that text as if the user had typed it.
3. If the tool returns an error:
   - “no speech detected…” — say in one short line that the microphone did not pick up speech and suggest running `/voice` again;
   - about a busy microphone — pass the error text as is, one line.
   No long advice or diagnostics.
4. Do not call `voice_record_start`/`voice_record_stop`/`voice_transcribe`, do not ask clarifying questions before recognition, and do not search files. At most one `voice_record` call per command invocation.
