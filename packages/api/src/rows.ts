import type { FeedItem, Measurement } from '@kerf/shared';

export interface MeasurementRow {
  id: number;
  group_id: number;
  value: number;
  label: string;
  device_id: string;
  created_at: number;
  created_by: number;
}

export function toMeasurement(row: MeasurementRow): Measurement {
  return {
    id: row.id,
    groupId: row.group_id,
    value: row.value,
    label: row.label,
    deviceId: row.device_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export type FeedRow = MeasurementRow & {
  project_id: number;
  project_name: string;
  group_name: string;
  created_by_name: string;
};

export function toFeedItem(row: FeedRow): FeedItem {
  return {
    ...toMeasurement(row),
    projectId: row.project_id,
    projectName: row.project_name,
    groupName: row.group_name,
    createdByName: row.created_by_name,
  };
}

// base select for a feed row; add WHERE / ORDER BY after this
export const FEED_SELECT = `
  SELECT m.*, g.project_id, g.name AS group_name, p.name AS project_name,
         u.name AS created_by_name
  FROM measurements m
  JOIN measurement_groups g ON g.id = m.group_id
  JOIN projects p ON p.id = g.project_id
  JOIN users u ON u.id = m.created_by
`;
