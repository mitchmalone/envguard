import { describe, expect, it } from 'vitest';
import { maskValue } from '../src/ui/mask.js';

describe('maskValue', () => {
  it('masks values longer than 4 characters', () => {
    expect(maskValue('sk_live_abc123xyz')).toBe('sk****yz');
  });

  it('shows **** for values with exactly 4 characters', () => {
    expect(maskValue('abcd')).toBe('****');
  });

  it('shows **** for values shorter than 4 characters', () => {
    expect(maskValue('abc')).toBe('****');
    expect(maskValue('a')).toBe('****');
    expect(maskValue('')).toBe('****');
  });

  it('handles 5-character values', () => {
    expect(maskValue('abcde')).toBe('ab*de');
  });

  it('handles 6-character values', () => {
    expect(maskValue('abcdef')).toBe('ab**ef');
  });

  it('handles 8-character values', () => {
    expect(maskValue('abcdefgh')).toBe('ab****gh');
  });

  it('caps asterisks at 4 for very long values', () => {
    expect(maskValue('a]234567890123456789z')).toBe('a]****9z');
  });
});
