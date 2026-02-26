import { afterEach, describe, expect, it } from 'vitest';
import {
  areColorsEnabled,
  bold,
  configureColors,
  cyan,
  dim,
  green,
  red,
  yellow,
} from '../src/utils/terminal.js';

describe('terminal colors', () => {
  afterEach(() => {
    configureColors({ env: {} });
  });

  it('wraps text with ANSI codes when colors enabled', () => {
    configureColors({ env: {} });
    expect(red('error')).toBe('\x1b[31merror\x1b[39m');
    expect(green('ok')).toBe('\x1b[32mok\x1b[39m');
    expect(yellow('warn')).toBe('\x1b[33mwarn\x1b[39m');
    expect(cyan('info')).toBe('\x1b[36minfo\x1b[39m');
    expect(bold('strong')).toBe('\x1b[1mstrong\x1b[22m');
    expect(dim('faint')).toBe('\x1b[2mfaint\x1b[22m');
  });

  it('returns plain text when NO_COLOR is set', () => {
    configureColors({ env: { NO_COLOR: '1' } });
    expect(red('error')).toBe('error');
    expect(green('ok')).toBe('ok');
    expect(yellow('warn')).toBe('warn');
    expect(cyan('info')).toBe('info');
    expect(bold('strong')).toBe('strong');
    expect(dim('faint')).toBe('faint');
  });

  it('returns plain text when forceColor is false', () => {
    configureColors({ forceColor: false });
    expect(red('error')).toBe('error');
    expect(areColorsEnabled()).toBe(false);
  });

  it('enables colors when forceColor is true even with NO_COLOR', () => {
    configureColors({ forceColor: true });
    expect(red('error')).toBe('\x1b[31merror\x1b[39m');
    expect(areColorsEnabled()).toBe(true);
  });

  it('areColorsEnabled reflects state', () => {
    configureColors({ env: {} });
    expect(areColorsEnabled()).toBe(true);

    configureColors({ env: { NO_COLOR: '' } });
    expect(areColorsEnabled()).toBe(false);
  });
});
