import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FoxgloveViewer } from '@foxglove/embed-react';
import { supabase } from '@/lib/supabase';
import type { SdCardRecord, ValidationStatus } from '@/lib/supabase';
import { pickSdCardDirectory } from '@/lib/sdCardScanner';
import type { DetectedFile } from '@/lib/sdCardScanner';
import { useIcLogLookup } from '@/lib/icLookup';
import VideoPlayer from '@/components/VideoPlayer';
import { AlertCircle, CheckCircle2, CircleDot, Eject, FileText, Film, FolderOpen, HardDrive, Info, Loader2, RefreshCw, Search, Send, Usb, XCircle } from 'lucide-react';

const STATUS_OPTIONS: { value: ValidationStatus; label: string }[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'passed_with_comment', label: 'Passed with comment' },
];
const TRACKER_FIELDS = [
  'Entry Date (Date-Month)', 'VC name', 'IC Number (IC-1)', 'Recorded Date (Date-Month)',
  'Recorded Time(00:00:00)HH:MM:SS', 'Mcap files', 'Duration', 'Video Status', 'City',
  'Project', 'IC name', 'FO Name', 'SD card count (SD-1)', 'SD Card duration', 'Drive link',
  'VC comment', 'IC comment',
];

type Notice = { kind: 'success' | 'error' | 'info'; text: string };
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : '';
function dateMonth(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(`${dateOnly(value)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date);
}
function recordingDate(file: File) {
  const date = new Date(file.lastModified);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function App() {
  const [records, setRecords] = useState<SdCardRecord[]>([]);
  const [cardName, setCardName] = useState('');
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mcapFile, setMcapFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [vcName, setVcName] = useState('');
  const [city, setCity] = useState('');
  const [project, setProject] = useState('');
  const [foName, setFoName] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [vcComment, setVcComment] = useState('');
  const [icComment, setIcComment] = useState('');
  const [status, setStatus] = useState<ValidationStatus>('pending');
  const sourceCard = useRef('');
  const selectedFile = useMemo(() => files.find((item) => item.name === (mcapFile?.name ?? records.find((r) => r.id === selectedId)?.source_file)) ?? null, [files, mcapFile, records, selectedId]);
  const logFiles = useMemo(() => files.filter(({ name }) => /\.(log|txt|csv|json)$/i.test(name)).map(({ file }) => file), [files]);
  const { icNumber, icName, error: icError, loading: icLoading } = useIcLogLookup(logFiles);
  const insertedRecords = useMemo(() => cardName ? records.filter((record) => record.sd_card_count === cardName) : [], [records, cardName]);
  const selected = insertedRecords.find((record) => record.id === selectedId) ?? null;
  const visibleRecords = insertedRecords.filter((record) => {
    const haystack = [record.source_file, record.mcap_files, record.video_status].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const mcapCount = files.filter(({ name }) => name.toLowerCase().endsWith('.mcap')).length;

  const fetchRecords = useCallback(async () => {
    const { data, error } = await supabase.from('sd_card_records').select('*').order('created_at', { ascending: false });
    if (error) setNotice({ kind: 'error', text: 'Could not load saved inspection records. Check the Supabase configuration.' });
    else setRecords((data as SdCardRecord[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void fetchRecords(); }, [fetchRecords]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => {
    setStatus(selected?.status ?? 'pending');
    setVcComment(selected?.vc_comment ?? selected?.comment ?? '');
    setIcComment(selected?.ic_comment ?? '');
    setVcName(selected?.vc_name ?? '');
    setCity(selected?.city ?? '');
    setProject(selected?.project_ic_name ?? '');
    setFoName(selected?.fo_name ?? '');
    setDriveLink(selected?.drive_link ?? '');
  }, [selectedId, selected?.id]);

  const disconnectCard = () => {
    sourceCard.current = '';
    setCardName('');
    setFiles([]);
    setMcapFile(null);
    setVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
    setSelectedId(null);
    setNotice({ kind: 'info', text: 'SD card disconnected. Its files and player source have been cleared.' });
  };

  const connectCard = async () => {
    setScanning(true);
    try {
      const result = await pickSdCardDirectory();
      if (!result) return;
      if (sourceCard.current !== result.rootName) {
        setMcapFile(null);
        setVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
        setSelectedId(null);
      }
      sourceCard.current = result.rootName;
      setCardName(result.rootName);
      setFiles([...result.files, ...result.metadataFiles]);
      const scanned = [...result.files, ...result.metadataFiles];
      const existing = records.filter((record) => record.sd_card_count === result.rootName);
      const known = new Set(existing.map((record) => record.source_file).filter(Boolean));
      const date = new Date().toISOString().slice(0, 10);
      const additions = scanned.filter((item) => !known.has(item.name)).map((item) => {
        const isMcap = item.name.toLowerCase().endsWith('.mcap');
        const isVideo = /\.(mp4|mov|avi|mkv|mts|m2ts|wmv|flv|webm|3gp)$/i.test(item.name);
        return {
          entry_date: date, recorded_date: recordingDate(item.file) || null, recorded_time: null,
          duration: null, mcap_files: isMcap ? item.name : null,
          video_status: isMcap ? 'MCAP data file' : isVideo ? 'Video recording' : 'System log',
          sd_card_count: result.rootName, source_file: item.name, video_url: item.path,
          status: 'pending', submitted: false,
        };
      });
      if (additions.length) {
        const { error } = await supabase.from('sd_card_records').insert(additions);
        if (error) throw error;
      }
      await fetchRecords();
      setNotice({ kind: 'success', text: `${result.rootName} selected · ${scanned.length} files · ${result.metadataFiles.filter((file) => file.name.toLowerCase().endsWith('.mcap')).length} MCAP recordings.` });
      if (!scanned.length) setNotice({ kind: 'info', text: `No supported recording or log files were found in ${result.rootName}.` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not read the selected SD card folder.' });
    } finally { setScanning(false); }
  };

  const openFile = (file: DetectedFile) => {
    const record = insertedRecords.find((item) => item.source_file === file.name);
    if (record?.submitted) setNotice({ kind: 'info', text: 'This recording has already been submitted.' });
    setSelectedId(record?.id ?? null);
    setVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
    if (file.name.toLowerCase().endsWith('.mcap')) setMcapFile(file.file);
    else if (/\.(mp4|mov|avi|mkv|mts|m2ts|wmv|flv|webm|3gp)$/i.test(file.name)) {
      setMcapFile(null);
      setVideoUrl(URL.createObjectURL(file.file));
    } else {
      setMcapFile(null);
      setNotice({ kind: 'info', text: `${file.name} is a system log, not a playable video recording.` });
    }
  };

  const handleSubmit = async () => {
    if (!cardName || sourceCard.current !== cardName) { setNotice({ kind: 'error', text: 'Select the currently inserted SD card before submitting.' }); return; }
    if (!selected || !selectedFile) { setNotice({ kind: 'error', text: 'Select a recording from the active SD card before submitting.' }); return; }
    if (!mcapFile || !selectedFile.name.toLowerCase().endsWith('.mcap')) { setNotice({ kind: 'error', text: 'Select and review an MCAP recording before submitting this inspection.' }); return; }
    if (!icNumber) { setNotice({ kind: 'error', text: icError || 'IC number not found in system log.' }); return; }
    if (!icName) { setNotice({ kind: 'error', text: icError || 'IC mapping not found. Please verify the IC number.' }); return; }
    if (status === 'pending') { setNotice({ kind: 'error', text: 'Select an inspection status before submitting.' }); return; }
    if (!vcName.trim()) { setNotice({ kind: 'error', text: 'Enter the VC name before submitting.' }); return; }
    if (status === 'passed_with_comment' && !vcComment.trim()) { setNotice({ kind: 'error', text: 'Add a VC comment for Passed with comment.' }); return; }
    if (selected.submitted) { setNotice({ kind: 'info', text: 'This inspection has already been submitted.' }); return; }

    setSubmitting(true);
    try {
      setSaving(true);
      const update = {
        entry_date: new Date().toISOString().slice(0, 10), vc_name: vcName.trim(), ic_number: icNumber,
        ic_name: icName, recorded_date: recordingDate(selectedFile.file) || selected.recorded_date,
        recorded_time: selected.recorded_time, mcap_files: selectedFile.name, duration: selected.duration,
        video_status: status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Passed with Comment',
        city: city.trim() || null, project_ic_name: project.trim() || null, fo_name: foName.trim() || null,
        sd_card_count: cardName, sd_card_duration: selected.sd_card_duration, drive_link: driveLink.trim() || null,
        status, vc_comment: vcComment.trim() || null, ic_comment: icComment.trim() || null, comment: vcComment.trim() || null,
      };
      const { error: saveError } = await supabase.from('sd_card_records').update(update).eq('id', selected.id).eq('sd_card_count', cardName);
      if (saveError) throw saveError;
      setRecords((previous) => previous.map((record) => record.id === selected.id ? { ...record, ...update } as SdCardRecord : record));
      setSaving(false);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-to-sheet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ recordId: selected.id, headers: TRACKER_FIELDS }),
      });
      const result = await response.json();
      if (!response.ok || result?.sheetPushed !== true) throw new Error(result?.error ?? result?.message ?? 'The Productivity Tracker did not confirm the submission.');
      setRecords((previous) => previous.map((record) => record.id === selected.id ? { ...record, submitted: true } : record));
      setNotice({ kind: 'success', text: result.message ?? 'Inspection submitted to the Productivity Tracker.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Submission failed. Your inspection details are preserved; you can retry.' });
    } finally { setSaving(false); setSubmitting(false); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white"><Film className="h-5 w-5" /></div><div><h1 className="text-base font-bold tracking-tight">Video Quality Checker</h1><p className="text-xs text-slate-500">SD card inspection workspace</p></div></div>
        <div className="flex items-center gap-2">
          {cardName ? <><div className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" />{cardName} · {files.length} files</div><button onClick={disconnectCard} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" title="Disconnect active card"><Eject className="h-4 w-4" /><span className="hidden sm:inline">Disconnect</span></button></> : <span className="hidden text-xs text-slate-500 sm:block">No SD card selected</span>}
          <button onClick={() => void connectCard()} disabled={scanning} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">{scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}{cardName ? 'Refresh card' : 'Select SD card'}</button>
        </div>
      </div>
    </header>
    <main className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 lg:grid-cols-[270px_minmax(0,1fr)] lg:px-8">
      <aside className="flex min-h-[260px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:min-h-[calc(100vh-118px)]">
        <div className="border-b border-slate-100 p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Active card files</h2>{cardName && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{visibleRecords.length}</span>}</div><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" /></div></div>
        {!cardName ? <div className="m-4 rounded-lg border border-dashed border-slate-300 p-5 text-center"><HardDrive className="mx-auto mb-2 h-7 w-7 text-slate-400" /><p className="text-sm font-medium">No active SD card</p><p className="mt-1 text-xs leading-5 text-slate-500">Select the inserted card folder to view its recordings and system logs.</p></div> : <>
          <div className="flex items-center gap-2 border-b border-slate-100 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-800"><Usb className="h-4 w-4" /><span className="truncate font-medium">{cardName}</span><span className="ml-auto shrink-0">{mcapCount} MCAP</span></div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-slate-400" />}
            {!loading && visibleRecords.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-500">No matching files on this card.</p>}
            {visibleRecords.map((record) => {
              const file = files.find((item) => item.name === record.source_file);
              const isMcap = record.source_file?.toLowerCase().endsWith('.mcap');
              return <button key={record.id} onClick={() => file && openFile(file)} disabled={!file} className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === record.id ? 'border-sky-300 bg-sky-50' : 'border-transparent hover:bg-slate-50'} disabled:opacity-50`}>
                <div className="flex items-center gap-2"><FileText className={`h-4 w-4 shrink-0 ${isMcap ? 'text-sky-600' : 'text-slate-400'}`} /><span className="truncate text-sm font-medium">{record.source_file}</span></div><div className="mt-1 flex justify-between gap-2 pl-6 text-[11px] text-slate-500"><span>{isMcap ? 'MCAP recording' : record.video_status}</span><span>{file ? formatBytes(file.size) : ''}</span></div>{record.submitted && <p className="mt-1 pl-6 text-[11px] text-emerald-700">Submitted</p>}
              </button>;
            })}
          </div>
          <button onClick={() => void connectCard()} disabled={scanning} className="m-3 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />Refresh selected folder</button>
        </>}
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-white/10 px-4 text-white"><div className="flex min-w-0 items-center gap-2 text-sm"><CircleDot className="h-3.5 w-3.5 shrink-0 text-rose-400" /><span className="truncate font-medium">{mcapFile?.name ?? (selectedFile?.name || 'Recording player')}</span></div>{mcapFile && <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-[11px] text-slate-300">Foxglove · MCAP</span>}</div>
          <div className="aspect-video min-h-[280px] w-full bg-black sm:min-h-[360px] lg:min-h-[420px]">
            {mcapFile ? <FoxgloveViewer key={`${cardName}:${mcapFile.name}`} data={{ type: 'file', file: mcapFile }} /> : videoUrl ? <VideoPlayer key={videoUrl} src={videoUrl} title={selectedFile?.name} /> : <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-400"><Film className="mb-3 h-12 w-12 opacity-60" /><p className="text-sm font-medium text-slate-300">{cardName ? 'Choose a recording to begin inspection' : 'Select the inserted SD card to begin'}</p><p className="mt-1 max-w-md text-xs leading-5">MCAP files open in Foxglove. The MCAP must contain supported message topics; a playable video stream is not guaranteed.</p></div>}
          </div>
          {mcapFile && <div className="flex items-start gap-2 border-t border-white/10 bg-slate-900 px-4 py-2.5 text-xs leading-5 text-slate-300"><Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /><p>Use Foxglove's playback bar for play, seek, timestamp, and supported speed options. Video rendering depends on the MCAP's topics and codecs; unsupported or missing video topics won't be playable video.</p></div>}
        </div>

        {cardName && <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">Active SD card</p><p className="mt-1 truncate text-sm font-semibold">{cardName}</p></div><div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">System logs</p><p className="mt-1 text-sm font-semibold">{logFiles.length} found {icLoading ? '· reading…' : ''}</p></div><div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">IC identification</p><p className="mt-1 truncate text-sm font-semibold">{icNumber || 'Not detected'}{icName ? ` · ${icName}` : ''}</p></div></div>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Inspection details</h2><p className="mt-1 text-xs text-slate-500">{selectedFile ? selectedFile.name : 'Select an MCAP recording from the active card'}</p></div>{selected?.submitted && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Submitted</span>}</div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detected IC identity</p>{icNumber && icName && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}</div><p className="text-sm font-medium">{icNumber || 'IC number not found in system log.'}</p><p className="mt-0.5 text-xs text-slate-600">{icName || (icNumber ? 'IC mapping not found. Please verify the IC number.' : 'IC name will appear when a matching map is available.')}</p>{icError && <p role="alert" className="mt-2 text-xs text-rose-700">{icError}</p>}</div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="VC name *" value={vcName} onChange={setVcName} placeholder="Video checker" /><Field label="City" value={city} onChange={setCity} placeholder="" /><Field label="Project" value={project} onChange={setProject} placeholder="" /><Field label="FO name" value={foName} onChange={setFoName} placeholder="" /></div>
            <div className="mt-4"><label className="mb-2 block text-xs font-medium text-slate-700">Inspection status *</label><div className="flex flex-wrap gap-2">{STATUS_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setStatus(option.value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${status === option.value ? option.value === 'fail' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{option.label}</button>)}</div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><TextArea label="VC comment" value={vcComment} onChange={setVcComment} /><TextArea label="IC comment" value={icComment} onChange={setIcComment} /></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Google Drive link" value={driveLink} onChange={setDriveLink} placeholder="" /><div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[11px] text-slate-500">Recording date / duration</p><p className="mt-1 text-xs font-medium text-slate-700">{selectedFile ? `${dateMonth(recordingDate(selectedFile.file)) || '—'} · Duration not available` : '—'}</p></div></div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-md text-[11px] leading-4 text-slate-500">Date comes from the selected file's modified timestamp. Duration and recording time are left blank when the source doesn't provide them.</p><button onClick={() => void handleSubmit()} disabled={submitting || saving || !selected || selected.submitted} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">{submitting || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{submitting || saving ? 'Submitting…' : selected?.submitted ? 'Already submitted' : 'Submit inspection'}</button></div>
          </section>
          <aside className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-semibold">Productivity Tracker</h2><p className="mt-1 text-xs leading-5 text-slate-500">Submits inspection details through the configured secure Supabase function to the Google Sheets Apps Script.</p><div className="mt-4 space-y-2">{TRACKER_FIELDS.map((field) => <div key={field} className="flex items-center gap-2 text-xs text-slate-600"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-600" /><span>{field}</span></div>)}</div><p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Configure the Apps Script deployment URL as the Supabase Edge Function secret <code>GOOGLE_SCRIPT_URL</code>. No deployment URL is embedded in the frontend.</p></aside>
        </div>
      </section>
    </main>
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`fixed bottom-5 right-5 z-50 flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>{notice.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : notice.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<p className="text-sm leading-5">{notice.text}</p></div>}
  </div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>;
}
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>;
}
