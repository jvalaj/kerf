import { displayNumber, formatValue, UNITS } from '@kerf/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csvRow } from '../src/csv';
import { type Api, HENDRICKS_GROUP, startApi } from './harness';

let api: Api;
beforeEach(async () => {
  api = await startApi();
});
afterEach(() => api.stop());

/** a small rfc 4180 reader, so the tests check what a spreadsheet would actually parse. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}

async function exportCsv(who: 'alex' | 'sam' | 'priya', query = '') {
  const res = await api.request(`/export/measurements.csv${query}`, {
    token: await api.login(who),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  // decode without stripping the bom, to see the file as it lands on disk.
  const raw = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return { res, bytes, raw, rows: parseCsv(raw.replace(/^﻿/, '')) };
}

describe('CSV export', () => {
  it('requires sign-in', async () => {
    expect((await api.request('/export/measurements.csv')).status).toBe(401);
  });

  it('downloads as a UTF-8 CSV file with a byte-order mark and CRLF line endings', async () => {
    const { res, bytes, raw } = await exportCsv('alex');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="kerf-measurements-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('access-control-expose-headers')).toContain('Content-Disposition');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.endsWith('\r\n')).toBe(true);
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('has one row per measurement with the columns the office asked for', async () => {
    const { rows } = await exportCsv('alex', '?tz=UTC');
    expect(rows[0]).toEqual([
      'Project',
      'Group',
      'Label',
      'Measurement',
      'Value (in)',
      'Captured by',
      'Device',
      'Captured at (UTC)',
    ]);
    expect(rows).toHaveLength(1 + 30);
    const sink = rows.find((r) => r[2] === 'Sink wall run')!;
    expect(sink.slice(0, 7)).toEqual([
      'Hendricks Kitchen Remodel',
      'Base cabinets',
      'Sink wall run',
      '120"',
      '120',
      'Alex',
      'TP-3F2A',
    ]);
    expect(sink[7]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('only includes projects you belong to', async () => {
    const projects = async (who: 'alex' | 'sam' | 'priya') =>
      [...new Set((await exportCsv(who)).rows.slice(1).map((r) => r[0]))].sort();
    expect(await projects('alex')).toEqual([
      'Garage Shelving',
      'Hendricks Kitchen Remodel',
      'Unit 4B Flooring',
    ]);
    expect(await projects('priya')).toEqual(['Hendricks Kitchen Remodel']);
    expect(await projects('sam')).toEqual(['Maple St Deck']);
  });

  it('shows each measurement exactly as the app does, with a number that agrees with it', async () => {
    const alex = await api.login('alex');
    const groups = (await (
      await api.request('/projects/1/measurements', { token: alex })
    ).json()) as { measurements: { label: string; value: number }[] }[];
    const byLabel = new Map(groups.flatMap((g) => g.measurements).map((m) => [m.label, m.value]));

    for (const unit of UNITS) {
      const { rows } = await exportCsv('alex', `?unit=${unit}`);
      expect(rows[0][4]).toBe(unit === 'metric' ? 'Value (mm)' : 'Value (in)');
      for (const row of rows.slice(1).filter((r) => r[0] === 'Hendricks Kitchen Remodel')) {
        const mm = byLabel.get(row[2])!;
        expect(row[3]).toBe(formatValue(mm, unit));
        // a bare number a spreadsheet can add up: digits and a decimal point, nothing else.
        expect(row[4]).toMatch(/^\d+(\.\d+)?$/);
        expect(Number(row[4])).toBe(displayNumber(mm, unit));
      }
    }

    // 763 mm is 30.039…": the app rounds it to 30 1/16", so the sheet says 30.0625, not 30.039.
    const range = (await exportCsv('alex')).rows.find((r) => r[2] === 'Range opening')!;
    expect(range.slice(3, 5)).toEqual(['30 1/16"', '30.0625']);
  });

  it('writes times in the requested time zone', async () => {
    api.db
      .prepare('UPDATE measurements SET created_at = ? WHERE id = 1')
      .run(Date.UTC(2026, 2, 9, 4, 5, 7));
    const time = async (query: string) => {
      const { rows } = await exportCsv('alex', query);
      return [rows[0][7], rows.find((r) => r[2] === 'Sink wall run')![7]];
    };
    expect(await time('')).toEqual(['Captured at (UTC)', '2026-03-09 04:05:07']);
    expect(await time('?tz=America/Chicago')).toEqual([
      'Captured at (America/Chicago)',
      '2026-03-08 23:05:07',
    ]);
  });

  it('rejects an unknown unit or time zone', async () => {
    expect((await exportCsv('alex', '?unit=cubits')).res.status).toBe(400);
    expect((await exportCsv('alex', '?tz=Mars/Olympus')).res.status).toBe(400);
  });

  it('keeps awkward labels intact and stops them running as formulas', async () => {
    const alex = await api.login('alex');
    const labels = [
      'Left, of "window"',
      'Two\nlines',
      '=HYPERLINK("http://evil.example","click")',
      '+1 800 555 0100',
      '-2 offset',
      '@cmd',
      'Fenêtre côté 北',
    ];
    for (const label of labels) await api.capture(alex, HENDRICKS_GROUP, label);

    const { rows } = await exportCsv('alex');
    const exported = rows.map((r) => r[2]);
    expect(exported).toEqual(
      expect.arrayContaining([
        'Left, of "window"',
        'Two\nlines',
        `'=HYPERLINK("http://evil.example","click")`,
        `'+1 800 555 0100`,
        `'-2 offset`,
        `'@cmd`,
        'Fenêtre côté 北',
      ]),
    );
    // every row still has eight columns: nothing spilled into a neighbour.
    expect(rows.every((r) => r.length === 8)).toBe(true);
  });
});

describe('csvRow', () => {
  it('quotes only when it has to, and leaves numbers bare', () => {
    expect(csvRow(['plain', 30.0625, 'a,b', 'say "hi"', ' padded '])).toBe(
      'plain,30.0625,"a,b","say ""hi"""," padded "\r\n',
    );
  });
});
