import type { Unit } from '@kerf/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { api } from '@/lib/api';

/**
 * exports the csv on a phone: save it to the cache folder, then open the share sheet so it can
 * go to files, mail, sheets, airdrop and so on. both modules ship inside expo go.
 */
export async function exportMeasurements(unit: Unit) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await api.exportCsv(unit, timeZone);
  const filename =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
    'kerf-measurements.csv';

  // reading the body as text can drop the byte-order mark excel relies on, so put it back.
  const text = (await res.text()).replace(/^﻿/, '');
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write('﻿' + text);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Export measurements',
  });
}
