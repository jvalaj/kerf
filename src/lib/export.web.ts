import type { Unit } from '@kerf/shared';

import { api } from '@/lib/api';

/**
 * downloads the csv in a browser, desktop or mobile. the request needs the authorization header,
 * so a plain link to the api won't do: fetch it, then hand the bytes to the browser as a file.
 */
export async function exportMeasurements(unit: Unit) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await api.exportCsv(unit, timeZone);
  const filename =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
    'kerf-measurements.csv';

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
