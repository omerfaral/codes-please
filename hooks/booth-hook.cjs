#!/usr/bin/env node
// Codes, Please — Claude Code hook bridge (zero dependencies).
// Forwards the hook event on stdin to the local server and prints the server's JSON reply to stdout.
// Safety net: on any problem, print nothing and exit 0 → Claude Code falls back to its normal flow.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const done = (out) => {
  if (out) process.stdout.write(out);
  process.exit(0);
};
process.on('uncaughtException', () => done());

const CONFIG = path.join(process.env.BOOTH_HOME || path.join(os.homedir(), '.checkpoint-booth'), 'config.json');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let cfg, event;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    event = JSON.parse(input).hook_event_name;
  } catch {
    return done();
  }
  if (!event) return done();
  // PermissionRequest waits for a human (long-poll); every other event must return immediately.
  const longPoll = event === 'PermissionRequest';
  const req = http.request(
    {
      host: '127.0.0.1',
      port: cfg.port,
      path: '/hook/claude/' + encodeURIComponent(event),
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.token },
    },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => done(res.statusCode === 200 ? body : ''));
      res.on('error', () => done());
    },
  );
  req.on('error', () => done());
  req.setTimeout(longPoll ? 0 : 3000, () => {
    req.destroy();
    done();
  });
  req.end(input);
});
