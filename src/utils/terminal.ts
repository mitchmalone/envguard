const ESC = '\x1b[';

function makeColor(open: string, close: string): (text: string) => string {
  return (text: string) => {
    if (colorsDisabled) return text;
    return `${ESC}${open}m${text}${ESC}${close}m`;
  };
}

let colorsDisabled = false;

export function configureColors(opts: {
  env?: Record<string, string | undefined>;
  forceColor?: boolean;
}): void {
  if (opts.forceColor === true) {
    colorsDisabled = false;
    return;
  }
  if (opts.forceColor === false) {
    colorsDisabled = true;
    return;
  }
  colorsDisabled = opts.env?.NO_COLOR !== undefined;
}

export function areColorsEnabled(): boolean {
  return !colorsDisabled;
}

export const dim = makeColor('2', '22');
export const bold = makeColor('1', '22');
export const red = makeColor('31', '39');
export const green = makeColor('32', '39');
export const yellow = makeColor('33', '39');
export const cyan = makeColor('36', '39');
