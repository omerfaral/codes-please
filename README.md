# Checkpoint Booth

*[Türkçe](README.tr.md)*

A local UI that receives Claude Code's permission requests as paperwork at a retro border checkpoint instead of in the terminal. You inspect the documents, bring down a stamp, and your decision goes back to the agent. You can also send letters to running sessions from here. The UI is available in English (default) and Turkish; switch under **SETTINGS → Language**.

## Setup

```bash
npm install
npm run install-hooks   # backs up ~/.claude/settings.json, adds only the booth's hook entries
npm start               # builds the UI, serves it on 127.0.0.1:4777, opens the browser
```

- On first run a random access token is written to `~/.checkpoint-booth/config.json` (mode 0600). The UI link carries the token, and the token is then removed from the address bar.
- To remove the hooks, run `npm run uninstall-hooks`. Only `booth-hook.cjs` entries are removed; your other hooks stay in place.
- Already-open Claude Code sessions pick up hook changes after you open and close the `/hooks` menu, or after a restart.

## Safety net

The hook prints nothing and exits 0 in each of these cases, so Claude Code falls back to its normal terminal prompt:
- The server is down.
- The token is wrong.
- No UI is open.
- The UI has been closed for more than 15 seconds.
- Any error occurs.

If you answer a request in the terminal instead, the application leaves the queue and is recorded as "TERMINAL" in the history.

## Usage

| Key | Action |
| --- | --- |
| Enter | Calls the next applicant if the desk is empty, otherwise hands the papers back (sends) |
| A / R / P | APPROVE, REJECT or PERMANENT stamp (K also works for PERMANENT) |
| N | Focuses the note slip; a note sent without a stamp counts as NOTE (send back) |
| Esc | Leaves the note slip or closes an open folder |

- **APPROVE + note:** Allowed. The note reaches Claude via PostToolUse after the tool runs.
- **REJECT + note:** The note is sent as the reason for rejection.
- **NOTE:** The request is denied. The note is sent as an instruction: "don't do this, do that instead".
- **PERMANENT:** The rule Claude suggested is applied for this session only (`updatedPermissions`, `destination: "session"`).
- **Mail:** A message written in a folder is delivered at the first suitable hook: PreToolUse, PostToolUse, UserPromptSubmit, or a Stop that it blocks.

## Testing

```bash
npm test        # real hook script ↔ real server ↔ fake UI, 10 scenarios
npm run demo    # try the UI with fake applications, no Claude Code needed
```

Demo applications go through the real adapter. The JSON that would be sent to the agent shows up in the "Radio Log" at the bottom left. To start another round at any time, use **SETTINGS → Send demo applications**.

## Architecture

```
hooks/booth-hook.cjs      zero-dependency bridge: stdin → POST /hook/claude/<event> → stdout
server/index.ts           HTTP + WebSocket, bound to 127.0.0.1 only
server/adapters/claude.ts Claude Code hook schema ↔ agent-agnostic core
server/core.ts            queue, decisions, note queue, mailbox, diff document, state file
server/transcript.ts      title, statement, research report and recent messages from the JSONL transcript
web/src/                  React UI; the scene is procedural pixel art on canvas
web/src/i18n.ts           UI strings (English primary, Turkish)
```

To add another agent (e.g. Codex), write a file that implements the `Adapter` interface and add it to `ADAPTERS` in `server/index.ts`. To add a UI language, add a dictionary to `web/src/i18n.ts`; it must match the shape of the English one.

## Differences from the hook docs

- The `PermissionRequest` input has **no** `tool_use_id`. So a note attached to an approved request is queued by session + tool name + `tool_input`, and PostToolUse finds it by that key.
- `permission_suggestions` is provided. The PERMANENT stamp echoes it back with `destination: "session"`. If there is no suggestion, it builds the rule itself (`command:*` for Bash).
- The Stop hook blocks stopping with `decision: "block"` + `reason`. It returns nothing when the mailbox is empty, so it cannot loop.
