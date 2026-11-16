import { displayNumber, formatValue, type Unit, UNIT_SYMBOLS, UNITS } from '@kerf/shared';
import { Router } from 'express';

import { createTimestampFormatter, csvRow, UTF8_BOM } from '../csv';
import type { Db } from '../db';

type ExportRow = {
  project: string;
  group_name: string;
  label: string;
  value: number;
  captured_by: string;
  device_id: string;
  created_at: number;
};

export function exportRouter(db: Db) {
  const router = Router();

  const rows = db.prepare(`
    SELECT p.name AS project, g.name AS group_name, m.label, m.value,
           u.name AS captured_by, m.device_id, m.created_at
    FROM measurements m
    JOIN measurement_groups g ON g.id = m.group_id
    JOIN projects p ON p.id = g.project_id
    JOIN project_members pm ON pm.project_id = p.id
    JOIN users u ON u.id = m.created_by
    WHERE pm.user_id = ?
    ORDER BY p.name, p.id, g.id, m.id
  `);

  /**
   * every measurement in the caller's projects.
   *
   * `unit` is the unit the caller is looking at (default: fractional inches, the app's default).
   * "measurement" is the text the app shows in that unit; "value" is the same quantity as a
   * plain number, rounded exactly as the text is, so sums in the sheet agree with the screen.
   * `tz` is an iana time zone for the "captured at" column (default: utc).
   */
  router.get('/export/measurements.csv', (req, res) => {
    const unit = (req.query.unit ?? 'fractional') as Unit;
    if (!UNITS.includes(unit)) {
      res.status(400).json({ error: `unit must be one of: ${UNITS.join(', ')}` });
      return;
    }
    const timeZone = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'UTC';
    const formatTime = createTimestampFormatter(timeZone);
    if (!formatTime) {
      res.status(400).json({ error: 'tz must be an IANA time zone, like America/Chicago' });
      return;
    }

    const date = formatTime(Date.now()).slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kerf-measurements-${date}.csv"`,
      'Cache-Control': 'no-store',
    });

    res.write(
      UTF8_BOM +
        csvRow([
          'Project',
          'Group',
          'Label',
          'Measurement',
          `Value (${UNIT_SYMBOLS[unit]})`,
          'Captured by',
          'Device',
          `Captured at (${timeZone})`,
        ]),
    );
    let chunk = '';
    let pending = 0;
    for (const row of rows.iterate(req.userId) as unknown as Iterable<ExportRow>) {
      chunk += csvRow([
        row.project,
        row.group_name,
        row.label,
        formatValue(row.value, unit),
        displayNumber(row.value, unit),
        row.captured_by,
        row.device_id,
        formatTime(row.created_at),
      ]);
      if (++pending === 500) {
        res.write(chunk);
        chunk = '';
        pending = 0;
      }
    }
    res.end(chunk);
  });

  return router;
}
