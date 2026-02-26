/**
 * Mask a secret value for display.
 * Shows first 2 and last 2 characters with asterisks in between.
 * Values ≤4 characters show as '****'.
 */
export function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  const starCount = Math.min(value.length - 4, 4);
  return `${value.slice(0, 2)}${'*'.repeat(starCount)}${value.slice(-2)}`;
}
