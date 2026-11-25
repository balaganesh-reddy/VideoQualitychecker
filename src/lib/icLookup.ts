import { useCallback, useEffect, useState } from 'react';

const LOOKUP_SHEET_ID = '1yBMqzh-yQ4UMj1YTAalmLQQdFo7fNCtgqCSDbwwt5eY';
const LOOKUP_GID = '533897913';

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function extractGrid(json: string): string[][] {
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('IC lookup sheet returned an invalid response.');
  const data = JSON.parse(json.slice(start, end + 1));
  return (data.table?.rows ?? []).map((row: { c?: Array<{ v?: unknown } | null> }) =>
    (row.c ?? []).map((cell) => cell?.v == null ? '' : String(cell.v)),
  );
}

/** Resolve an IC name from the configured Google Sheet by matching the IC number. */
export async function lookupIcName(icNumber: string): Promise<string | null> {
  if (!icNumber.trim()) return null;
  const url = `https://docs.google.com/spreadsheets/d/${LOOKUP_SHEET_ID}/gviz/tq?tqx=out:json&gid=${LOOKUP_GID}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to read the IC lookup sheet. Check its sharing permissions.');
  const rows = extractGrid(await response.text());
  if (rows.length < 2) return null;

  const headers = rows[0].map(normalize);
  const numberColumn = headers.findIndex((header) => /^(icnumber|icno|icid|ic)$/.test(header));
  const nameColumn = headers.findIndex((header) => /^(icname|name|nameofic)$/.test(header));
  if (numberColumn < 0 || nameColumn < 0) {
    throw new Error('IC lookup sheet needs recognizable IC Number and IC Name headers.');
  }
  const target = normalize(icNumber);
  const match = rows.slice(1).find((row) => normalize(row[numberColumn] ?? '') === target);
  return match?.[nameColumn]?.trim() || null;
}

/** Watches selected system log files and resolves an IC number/name pair. */
export function useIcLogLookup(logFiles: File[]) {
  const [icNumber, setIcNumber] = useState('');
  const [icName, setIcName] = useState('');
  const [error, setError] = useState('');

  const resolve = useCallback(async () => {
    setError('');
    const log = logFiles.find((file) => /\.(log|txt|csv|json)$/i.test(file.name));
    if (!log) return;
    const contents = await log.text();
    const match = contents.match(/\bIC\s*(?:Number|No\.?|ID)?\s*[:=,#-]?\s*(IC[-_ ]?\d+)\b/i)
      ?? contents.match(/\b(IC[-_]\d+)\b/i);
    if (!match) return;
    const number = match[1].replace(/\s+/g, '').toUpperCase();
    setIcNumber(number);
    try {
      setIcName(await lookupIcName(number) ?? '');
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'IC lookup failed.');
    }
  }, [logFiles]);

  useEffect(() => { void resolve(); }, [resolve]);
  return { icNumber, icName, error };
}
