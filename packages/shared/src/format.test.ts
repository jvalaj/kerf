import { describe, expect, it } from 'vitest';

import { displayNumber, formatValue, UNITS } from './format';

describe('formatValue', () => {
  it('formats fractional inches to the nearest 1/16, reduced', () => {
    expect(formatValue(3048, 'fractional')).toBe('120"');
    expect(formatValue(763, 'fractional')).toBe('30 1/16"');
    expect(formatValue(12.7, 'fractional')).toBe('1/2"');
    expect(formatValue(637, 'fractional')).toBe('25 1/16"');
    // rounds up across a whole inch rather than showing 16/16.
    expect(formatValue(25.3, 'fractional')).toBe('1"');
  });

  it('formats decimal inches and millimeters', () => {
    expect(formatValue(763, 'decimal')).toBe('30.04"');
    expect(formatValue(763, 'metric')).toBe('763 mm');
  });
});

describe('displayNumber', () => {
  it('is the number the formatted text shows', () => {
    expect(displayNumber(763, 'fractional')).toBe(30.0625);
    expect(displayNumber(763, 'decimal')).toBe(30.04);
    expect(displayNumber(763, 'metric')).toBe(763);
  });

  it('agrees with formatValue for every length a tape can read', () => {
    const parse = (text: string) => {
      // '30 1/16"', '1/2"' or '120"'
      const parts = text.replace('"', '').split(' ');
      const fraction = parts.find((part) => part.includes('/'))?.split('/') ?? ['0', '1'];
      const whole = parts.find((part) => !part.includes('/')) ?? '0';
      return Number(whole) + Number(fraction[0]) / Number(fraction[1]);
    };
    for (let mm = 1; mm <= 7600; mm++) {
      expect(displayNumber(mm, 'fractional')).toBe(parse(formatValue(mm, 'fractional')));
      expect(displayNumber(mm, 'decimal')).toBe(parseFloat(formatValue(mm, 'decimal')));
    }
  });

  it('covers every unit', () => {
    for (const unit of UNITS) expect(displayNumber(254, unit)).toBeGreaterThan(0);
  });
});
