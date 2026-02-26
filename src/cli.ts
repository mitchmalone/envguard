#!/usr/bin/env node
import { runCli } from './cli-main.js';
import { setupSignalHandlers } from './utils/errors.js';

const ctx = {
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: process.exit,
  cwd: process.cwd,
};

setupSignalHandlers(ctx, process);
runCli(ctx);
