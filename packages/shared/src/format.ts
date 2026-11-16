import type { Unit } from './types';

const MM_PER_INCH = 25.4;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function toSixteenths(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * 16);
}

export function formatFractionalInches(mm: number): string {
  const totalSixteenths = toSixteenths(mm);
  const whole = Math.floor(totalSixteenths / 16);
  const sixteenths = totalSixteenths % 16;
  if (sixteenths === 0) {
    return `${whole}"`;
  }
  const divisor = gcd(sixteenths, 16);
  const fraction = `${sixteenths / divisor}/${16 / divisor}`;
  return whole === 0 ? `${fraction}"` : `${whole} ${fraction}"`;
}

export function formatDecimalInches(mm: number): string {
  return `${(mm / MM_PER_INCH).toFixed(2)}"`;
}

export function formatMetric(mm: number): string {
  return `${mm} mm`;
}

export function formatValue(mm: number, unit: Unit): string {
  switch (unit) {
    case 'fractional':
      return formatFractionalInches(mm);
    case 'decimal':
      return formatDecimalInches(mm);
    case 'metric':
      return formatMetric(mm);
  }
}

/**
 * the number that `formatValue` displays, as a plain number: `30 1/16"` is 30.0625, `30.04"` is
 * 30.04 and `763 mm` is 763. use it wherever people need to calculate with what they see, so the
 * sums agree with the screen rather than with the unrounded millimeters.
 */
export function displayNumber(mm: number, unit: Unit): number {
  switch (unit) {
    case 'fractional':
      return toSixteenths(mm) / 16;
    case 'decimal':
      return Number((mm / MM_PER_INCH).toFixed(2));
    case 'metric':
      return mm;
  }
}

export const UNITS: Unit[] = ['fractional', 'decimal', 'metric'];

export const UNIT_LABELS: Record<Unit, string> = {
  fractional: 'Inches (1/16")',
  decimal: 'Inches (decimal)',
  metric: 'Millimeters',
};

/** short unit name for column headings. */
export const UNIT_SYMBOLS: Record<Unit, string> = {
  fractional: 'in',
  decimal: 'in',
  metric: 'mm',
};
