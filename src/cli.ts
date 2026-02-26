#!/usr/bin/env node
import { runCli } from './cli-main.js';

runCli({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: process.exit,
  cwd: process.cwd,
});
