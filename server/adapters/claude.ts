// Claude Code adapter: translates hook events into core calls and decisions into Claude Code's JSON output.
// Schema: https://code.claude.com/docs/en/hooks
import type { Core } from '../core.ts';

/** Adding a new agent (e.g. Codex) = one file implementing this interface + an entry in ADAPTERS in index.ts. */
export interface Adapter {
  name: string;
  /** Returning undefined makes the hook print nothing (the agent falls back to its default behaviour). */
  handle(event: string, payload: any, core: Core, signal: AbortSignal): Promise<object | undefined>;
}

const MAIL_PREFIX = 'Message from the user (via Checkpoint Booth):\n';
const NOTE_PREFIX = 'The user approved this action and attached a note:\n';

const context = (hookEventName: string, text?: string) =>
  text ? { hookSpecificOutput: { hookEventName, additionalContext: text } } : undefined;

const withPrefix = (prefix: string, text?: string) => (text ? prefix + text : undefined);

/** "Permanent" stamp: apply the rule Claude suggested, scoped to this session; build one ourselves if none was suggested. */
function sessionRules(p: any) {
  const suggested = (p.permission_suggestions ?? []).filter((s: any) => s?.type === 'addRules');
  if (suggested.length) return suggested.map((s: any) => ({ ...s, behavior: 'allow', destination: 'session' }));
  const cmd = typeof p.tool_input?.command === 'string' ? p.tool_input.command.trim().split(/\s+/)[0] : '';
  const rule = p.tool_name === 'Bash' && cmd ? { toolName: 'Bash', ruleContent: `${cmd}:*` } : { toolName: p.tool_name };
  return [{ type: 'addRules', rules: [rule], behavior: 'allow', destination: 'session' }];
}

export const claude: Adapter = {
  name: 'claude',
  async handle(event, p, core, signal) {
    if (!p?.session_id) return;
    const base = { agent: 'claude', sessionId: p.session_id, cwd: p.cwd, transcriptPath: p.transcript_path };
    const id = p.session_id as string;

    switch (event) {
      case 'SessionStart':
        core.touch({ ...base, status: 'idle', title: p.session_title, refresh: true });
        return;

      case 'UserPromptSubmit':
        core.touch({ ...base, status: 'working', prompt: p.prompt });
        return context('UserPromptSubmit', withPrefix(MAIL_PREFIX, core.takeMail(id, 'UserPromptSubmit')));

      case 'PreToolUse':
        core.touch({ ...base, status: 'working' });
        return context('PreToolUse', withPrefix(MAIL_PREFIX, core.takeMail(id, 'PreToolUse')));

      case 'PostToolUse': {
        core.touch({ ...base, status: 'working' });
        const parts = [
          withPrefix(NOTE_PREFIX, core.takeToolNote(id, p.tool_name, p.tool_input)),
          withPrefix(MAIL_PREFIX, core.takeMail(id, 'PostToolUse')),
        ].filter(Boolean);
        return context('PostToolUse', parts.join('\n\n') || undefined);
      }

      case 'Stop': {
        // Mail waiting → block the stop so Claude continues with the message.
        const mail = core.takeMail(id, 'Stop');
        core.touch({ ...base, status: mail ? 'working' : 'idle', refresh: true });
        return mail ? { decision: 'block', reason: MAIL_PREFIX + mail } : undefined;
      }

      case 'SessionEnd':
        core.touch({ ...base, status: 'closed' });
        return;

      case 'PermissionRequest': {
        const d = await core.requestPermission(
          { ...base, permissionMode: p.permission_mode, tool: p.tool_name, input: p.tool_input ?? {} },
          signal,
        );
        if (!d) return;
        const out = (decision: object) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
        switch (d.stamp) {
          case 'approve':
            return out({ behavior: 'allow' });
          case 'permanent':
            return out({ behavior: 'allow', updatedPermissions: sessionRules(p) });
          case 'deny':
            return out({ behavior: 'deny', message: d.note?.trim() || 'The user denied this request.' });
          case 'note':
            return out({
              behavior: 'deny',
              message: `The user did not approve this request as-is. Do not do it; follow this instruction instead:\n${d.note}`,
            });
        }
      }
    }
    return;
  },
};
