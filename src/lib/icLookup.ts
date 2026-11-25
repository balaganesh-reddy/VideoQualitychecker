import { useCallback, useEffect, useState } from 'react';

const LOOKUP_SHEET_ID = '1yBMqzh-yQ4UMj1YTAalmLQQdFo7fNCtgqCSDbwwt5eY';
const LOOKUP_GID = '533897913';
const cache = new Map<string, string | null>();
let mappingPromise: Promise<Map<string, string>> | null = null;
const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');

function extractGrid(json: string): string[][] {
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('IC lookup sheet returned an invalid response.');
  const data = JSON.parse(json.slice(start, end + 1));
  return (data.table?.rows ?? []).map((row: { c?: Array<{ v?: unknown } | null> }) =>
    (row.c ?? []).map((cell) => cell?.v == null ? '' : String(cell.v)),
  );
}
function headerKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function getMapping() {
  if (mappingPromise) return mappingPromise;
  mappingPromise = (async () => {
    const configuredUrl = import.meta.env.VITE_IC_MAPPING_URL as string | undefined;
    const url = configuredUrl || `https://docs.google.com/spreadsheets/d/${LOOKUP_SHEET_ID}/gviz/tq?tqx=out:json&gid=${LOOKUP_GID}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Unable to read the IC lookup sheet. Check its sharing permissions or mapping endpoint.');
    const rows = configuredUrl?.toLowerCase().includes('format=csv') || configuredUrl?.toLowerCase().endsWith('.csv')
      ? (await response.text()).trim().split(/\r?\n/).map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')))
      : extractGrid(await response.text());
    if (rows.length < 2) throw new Error('IC lookup sheet contains no mapping rows.');
    const headers = rows[0].map(headerKey);
    const numberColumn = headers.findIndex((header) => ['icnumber', 'icno', 'icid', 'ic'].includes(header));
    const nameColumn = headers.findIndex((header) => ['icname', 'nameofic'].includes(header));
    if (numberColumn < 0 || nameColumn < 0) throw new Error('IC lookup sheet needs recognizable IC Number and IC Name headers.');
    const mappings = new Map<string, string>();
    rows.slice(1).forEach((row) => {
      const number = normalize(row[numberColumn] ?? '');
      const name = (row[nameColumn] ?? '').trim();
      if (number && name) mappings.set(number, name);
    });
    return mappings;
  })().catch((error) => { mappingPromise = null; throw error; });
  return mappingPromise;
}

export async function lookupIcName(icNumber: string): Promise<string | null> {
  const target = normalize(icNumber);
  if (!target) return null;
  if (cache.has(target)) return cache.get(target) ?? null;
  const mapping = await getMapping();
  const name = mapping.get(target) ?? null;
  cache.set(target, name);
  return name;
}

/** Read logs from the currently selected card and resolve a verified IC number/name pair. */
export function useIcLogLookup(logFiles: File[]) {
  const [icNumber, setIcNumber] = useState('');
  const [icName, setIcName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resolve = useCallback(async () => {
    let number = '';
    setIcNumber('');
    setIcName('');
    setError('');
    const logs = logFiles.filter((file) => /\.(log|txt|csv|json)$/i.test(file.name));
    try {
      for (const log of logs) {
        const contents = await log.text();
        const match = contents.match(/\bIC\s*(?:Number|No\.?|ID)?\s*[:=,#-]?\s*(IC[-_ ]?\d+)\b/i)
          ?? contents.match(/\b(IC[-_]\d+)\b/i);
        if (match) { number = normalize(match[1]); break; }
      }
      if (!number) {
        if (logs.length) setError('IC number not found in system log.');
        return;
      }
      setIcNumber(number);
      setLoading(true);
      const name = await lookupIcName(number);
      if (name) setIcName(name);
      else setError('IC mapping not found. Please verify the IC number.');
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'IC lookup failed.');
    } finally { setLoading(false); }
  }, [logFiles]);

  useEffect(() => { void resolve(); }, [resolve]);
  return { icNumber, icName, error, loading };
}
