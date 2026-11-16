export type Cell = string | number;

/**
 * spreadsheets run a cell as a formula when it starts with one of these, even in a csv. labels
 * and device ids come from users and from other people's api clients, so text cells that start
 * this way get a leading apostrophe, which spreadsheets show as plain text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: Cell): string {
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** one csv line. crlf endings, as rfc 4180 and excel expect. */
export function csvRow(cells: Cell[]): string {
  return cells.map(cell).join(',') + '\r\n';
}

/** without a byte-order mark excel reads a utf-8 csv as the local code page and garbles accents. */
export const UTF8_BOM = '﻿';

/**
 * formats a timestamp as `2026-03-09 14:05:07` in the given iana time zone: the one layout that
 * excel and google sheets both turn into a real date-time. returns undefined for an unknown zone.
 */
export function createTimestampFormatter(timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return undefined;
  }
  return (ms: number) => {
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(new Date(ms))) parts[part.type] = part.value;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
}
