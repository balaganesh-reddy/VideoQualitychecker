import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FoxgloveViewer } from '@foxglove/embed-react';
import { supabase } from '@/lib/supabase';
import type { SdCardRecord, ValidationStatus } from '@/lib/supabase';
import { pickSdCardDirectory, createVideoObjectUrl } from '@/lib/sdCardScanner';
import type { DetectedFile } from '@/lib/sdCardScanner';
import { useIcLogLookup } from '@/lib/icLookup';
import VideoPlayer from '@/components/VideoPlayer';
import SdCardDetails from '@/components/SdCardDetails';
import { HardDrive, CheckCircle2, XCircle, MessageSquarePlus, Send, Search, Loader2, CircleDot, CheckCheck, AlertCircle, Usb, FolderOpen, RefreshCw, Info, FileText } from 'lucide-react';

const STATUS_LABELS: Record<ValidationStatus, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', passed_with_comment: 'Passed with Comment' };
const STATUS_BADGES: Record<ValidationStatus, string> = { pending: 'bg-amber-100 text-amber-700', pass: 'bg-emerald-100 text-emerald-700', fail: 'bg-red-100 text-red-700', passed_with_comment: 'bg-sky-100 text-sky-700' };
function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function App() {
  const [records, setRecords] = useState<SdCardRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [cardConnected, setCardConnected] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [detectedMetaFiles, setDetectedMetaFiles] = useState<DetectedFile[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mcapFile, setMcapFile] = useState<File | null>(null);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const playFileRef = useRef<(record: SdCardRecord) => void>(() => {});
  const lastIcUpdate = useRef('');
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const logFiles = useMemo(() => detectedMetaFiles.filter((file) => /\.(log|txt|csv|json)$/i.test(file.name)).map((file) => file.file), [detectedMetaFiles]);
  const { icNumber, icName, error: icLookupError } = useIcLogLookup(logFiles);

  const fetchRecords = useCallback(async () => {
    const { data, error } = await supabase.from('sd_card_records').select('*').order('created_at', { ascending: false });
    if (error) setToast({ type: 'error', msg: 'Could not load SD card records.' });
    else setRecords((data as SdCardRecord[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void fetchRecords(); }, [fetchRecords]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setComment(selected?.comment ?? ''); }, [selectedId]);

  // Log files on the inserted card provide the IC number; resolve and persist its name from the lookup sheet.
  useEffect(() => {
    if (!cardConnected || !icNumber || !icName) return;
    const updateKey = `${cardConnected}:${icNumber}:${icName}`;
    if (lastIcUpdate.current === updateKey) return;
    lastIcUpdate.current = updateKey;
    void (async () => {
      const { error } = await supabase.from('sd_card_records').update({ ic_number: icNumber, ic_name: icName }).eq('sd_card_count', cardConnected);
      if (error) {
        lastIcUpdate.current = '';
        setToast({ type: 'error', msg: 'IC was identified, but could not be saved to the card records.' });
        return;
      }
      setRecords((previous) => previous.map((record) => record.sd_card_count === cardConnected ? { ...record, ic_number: icNumber, ic_name: icName } : record));
      setToast({ type: 'success', msg: `IC ${icNumber} matched to ${icName}.` });
    })();
  }, [cardConnected, icNumber, icName]);
  useEffect(() => {
    if (icLookupError) setToast({ type: 'error', msg: icLookupError });
  }, [icLookupError]);

  const importDetectedFiles = async (cardName: string, videos: DetectedFile[], metadata: DetectedFile[]) => {
    if (!videos.length && !metadata.length) return;
    setImporting(true);
    try {
      const { data: existing, error: existingError } = await supabase.from('sd_card_records').select('source_file').eq('sd_card_count', cardName);
      if (existingError) throw existingError;
      const known = new Set((existing ?? []).map((row) => row.source_file));
      const newVideos = videos.filter((file) => !known.has(file.name));
      const newMetadata = metadata.filter((file) => !known.has(file.name));
      if (!newVideos.length && !newMetadata.length) { await fetchRecords(); return; }
      const now = new Date().toISOString().slice(0, 10);
      const rows = [
        ...newVideos.map((file) => ({ entry_date: now, recorded_date: now, recorded_time: '00:00:00', video_status: 'Detected from card', sd_card_count: cardName, video_url: file.path, source_file: file.name, status: 'pending' as const })),
        ...newMetadata.map((file) => ({ entry_date: now, recorded_date: now, recorded_time: '00:00:00', mcap_files: file.name, video_status: file.name.toLowerCase().endsWith('.mcap') ? 'MCAP data file' : 'Metadata file', sd_card_count: cardName, video_url: null, source_file: file.name, status: 'pending' as const })),
      ];
      const { error } = await supabase.from('sd_card_records').insert(rows);
      if (error) throw error;
      const stem = (name: string) => name.replace(/\.[^.]+$/, '');
      for (const metadataFile of metadata) {
        const matchingVideo = videos.find((video) => stem(video.name) === stem(metadataFile.name));
        if (matchingVideo) await supabase.from('sd_card_records').update({ mcap_files: metadataFile.name }).eq('sd_card_count', cardName).eq('source_file', matchingVideo.name);
      }
      await fetchRecords();
      setToast({ type: 'success', msg: `Imported ${newVideos.length} video(s) and ${newMetadata.length} MCAP/data file(s) from ${cardName}.` });
    } catch (error) {
      setToast({ type: 'error', msg: error instanceof Error ? error.message : 'Could not import files from this card.' });
    } finally { setImporting(false); }
  };

  const connectCard = async () => {
    setScanning(true);
    try {
      const result = await pickSdCardDirectory();
      if (!result) return;
      setDetectedFiles(result.files);
      setDetectedMetaFiles(result.metadataFiles);
      setCardConnected(result.rootName);
      await importDetectedFiles(result.rootName, result.files, result.metadataFiles);
      if (!result.files.length && !result.metadataFiles.length) setToast({ type: 'info', msg: `No video or MCAP files found on ${result.rootName}.` });
      else setToast({ type: 'success', msg: `Connected ${result.rootName}: ${result.files.length} video(s), ${result.metadataFiles.filter((file) => file.name.toLowerCase().endsWith('.mcap')).length} MCAP file(s).` });
      if (pendingPlayId) {
        const target = recordsRef.current.find((record) => record.id === pendingPlayId);
        setPendingPlayId(null);
        if (target) setTimeout(() => playFileRef.current(target), 0);
      }
    } catch (error) { setToast({ type: 'error', msg: error instanceof Error ? error.message : 'Could not read the SD card.' }); }
    finally { setScanning(false); }
  };

  const playFile = (record: SdCardRecord) => {
    const isMcapRecord = record.source_file?.toLowerCase().endsWith('.mcap') || record.mcap_files?.toLowerCase().endsWith('.mcap');
    if (isMcapRecord) {
      const fileName = record.source_file?.toLowerCase().endsWith('.mcap') ? record.source_file : record.mcap_files;
      const mcap = detectedMetaFiles.find((file) => file.name === fileName);
      if (mcap) {
        setVideoUrl(null);
        setMcapFile(mcap.file);
        setSelectedId(record.id);
        return;
      }
      setPendingPlayId(record.id);
      setToast({ type: 'info', msg: `Reconnect the SD card folder to open ${fileName ?? 'this MCAP file'} in Foxglove.` });
      void connectCard();
      return;
    }
    const basename = record.video_url?.split('/').pop()?.split('?')[0] ?? '';
    const detected = detectedFiles.find((file) => file.name === record.source_file) ?? detectedFiles.find((file) => file.name === basename) ?? detectedFiles.find((file) => file.path === record.video_url);
    if (detected) {
      setMcapFile(null);
      setVideoUrl(createVideoObjectUrl(detected.file));
      setSelectedId(record.id);
    } else if (record.video_url?.startsWith('http')) {
      setMcapFile(null);
      setVideoUrl(record.video_url);
      setSelectedId(record.id);
    } else {
      setPendingPlayId(record.id);
      setToast({ type: 'info', msg: `Reconnect the SD card folder to open ${record.source_file ?? 'this video'}.` });
      void connectCard();
    }
  };
  playFileRef.current = playFile;

  const updateStatus = async (status: ValidationStatus) => {
    if (!selected) return;
    const newComment = status === 'passed_with_comment' ? comment : null;
    const { error } = await supabase.from('sd_card_records').update({ status, comment: newComment, vc_comment: newComment }).eq('id', selected.id);
    if (error) { setToast({ type: 'error', msg: 'Could not save validation status.' }); return; }
    setRecords((previous) => previous.map((record) => record.id === selected.id ? { ...record, status, comment: newComment, vc_comment: newComment } : record));
    setToast({ type: 'success', msg: `Validation set to ${STATUS_LABELS[status]}.` });
  };

  const handleSubmit = async () => {
    if (!selected) return;
    if (selected.status === 'pending') { setToast({ type: 'error', msg: 'Please select Pass, Fail, or Passed with Comment before submitting.' }); return; }
    if (selected.status === 'passed_with_comment' && !comment.trim()) { setToast({ type: 'error', msg: 'A comment is required for Passed with Comment.' }); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-to-sheet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }, body: JSON.stringify({ recordId: selected.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? `Request failed (${response.status})`);
      if (result.sheetPushed) setRecords((previous) => previous.map((record) => record.id === selected.id ? { ...record, submitted: true } : record));
      setToast({ type: result.sheetPushed ? 'success' : 'info', msg: result.message ?? 'Submission processed.' });
    } catch (error) { setToast({ type: 'error', msg: error instanceof Error ? error.message : 'Submission failed.' }); }
    finally { setSubmitting(false); }
  };

  const visibleRecords = useMemo(() => records.filter((record) => cardConnected && record.sd_card_count === cardConnected), [records, cardConnected]);
  const filtered = visibleRecords.filter((record) => [record.vc_name, record.ic_number, record.city, record.sd_card_count, record.project_ic_name, record.source_file].some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  const pendingCount = visibleRecords.filter((record) => record.status === 'pending').length;
  const validatedCount = visibleRecords.filter((record) => record.status !== 'pending').length;
  const submittedCount = visibleRecords.filter((record) => record.submitted).length;

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="px-6 py-3 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3"><div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-600 text-white"><HardDrive className="w-5 h-5" /></div><div><h1 className="text-base font-bold text-neutral-900">SD Card Validation Dashboard</h1><p className="text-xs text-neutral-500">Detect card, review video and MCAP, validate, submit</p></div></div>
          <div className="flex items-center gap-3"><div className="hidden md:flex gap-3"><Stat label="Pending" value={pendingCount} /><Stat label="Validated" value={validatedCount} /><Stat label="Submitted" value={submittedCount} /></div><button onClick={() => void connectCard()} disabled={scanning || importing} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">{scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Usb className="w-4 h-4" />}{scanning ? 'Scanning…' : cardConnected ? 'Re-scan Card' : 'Connect SD Card'}</button></div>
        </div>
        {cardConnected && <div className="px-6 py-1.5 bg-emerald-50 border-t border-emerald-100 text-xs text-emerald-800"><CheckCircle2 className="w-3.5 h-3.5 inline mr-2" /><b>Card connected:</b> {cardConnected} — {detectedFiles.length} video(s), {detectedMetaFiles.filter((file) => file.name.toLowerCase().endsWith('.mcap')).length} MCAP file(s){importing && ' · Importing…'}{icNumber && ` · ${icNumber}${icName ? ` — ${icName}` : ''}`}</div>}
      </header>
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <aside className="flex flex-col gap-4 p-4 w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200 bg-white max-h-[45vh] lg:max-h-none">
          <div className="flex justify-between"><h2 className="text-sm font-semibold text-neutral-700">{cardConnected ? 'Inserted Card Files' : 'No card connected'}</h2><span className="text-xs text-neutral-400">{filtered.length}</span></div>
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-200 bg-neutral-50" /></div>
          {!cardConnected && <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 flex gap-2 text-xs text-sky-900"><Info className="w-4 h-4 shrink-0" /><p>Connect an SD card to show only files on the inserted card.</p></div>}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            {!loading && cardConnected && filtered.length === 0 && <p className="text-sm text-neutral-400 py-8 text-center">No matching files on this card.</p>}
            {filtered.map((record) => <button key={record.id} onClick={() => playFile(record)} className={`w-full text-left rounded-lg border px-3 py-3 ${selectedId === record.id ? 'border-sky-500 bg-sky-50' : 'border-neutral-200 bg-white hover:bg-sky-50/40'}`}>
              <div className="flex justify-between gap-2"><span className="text-sm font-semibold truncate flex items-center gap-1.5">{record.video_status === 'Metadata file' && <FileText className="w-3.5 h-3.5 text-violet-500" />}{record.source_file ?? record.sd_card_count}</span><span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGES[record.status]}`}>{STATUS_LABELS[record.status]}</span></div>
              <p className="mt-1 text-xs text-neutral-500">{record.sd_card_count} · {formatDate(record.recorded_date)}{record.mcap_files && ` · MCAP: ${record.mcap_files}`}</p>
              {record.submitted && <span className="mt-1 flex items-center gap-1 text-[10px] text-sky-600"><CheckCheck className="w-3 h-3" /> Submitted to Sheet</span>}
            </button>)}
          </div>
          {cardConnected && <button onClick={() => void connectCard()} disabled={scanning} className="flex justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-neutral-100"><RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} /> Re-scan card</button>}
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-5xl w-full mx-auto">
            <div className="w-full aspect-video rounded-xl overflow-hidden">
              {mcapFile ? <div className="w-full h-full bg-neutral-950"><FoxgloveViewer key={mcapFile.name} data={{ type: 'file', file: mcapFile }} /></div> : videoUrl ? <VideoPlayer src={videoUrl} title={selected?.source_file ?? undefined} /> : <div className="flex flex-col items-center justify-center h-full bg-neutral-950 rounded-xl text-neutral-500"><FolderOpen className="w-8 h-8 mb-2 opacity-40" /><p className="text-xs">Select a video or MCAP file from the inserted card</p></div>}
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm"><SdCardDetails record={selected} /></div>
            {selected && <section className="border border-neutral-200 bg-white rounded-xl px-5 py-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">VC Validation</p><div className="flex flex-wrap items-end gap-3"><div className="flex flex-wrap gap-2"><ValidationButton active={selected.status === 'pass'} onClick={() => void updateStatus('pass')} icon={<CheckCircle2 className="w-4 h-4" />} label="Pass" activeClass="bg-emerald-600 text-white border-emerald-600" /><ValidationButton active={selected.status === 'fail'} onClick={() => void updateStatus('fail')} icon={<XCircle className="w-4 h-4" />} label="Fail" activeClass="bg-red-600 text-white border-red-600" /><ValidationButton active={selected.status === 'passed_with_comment'} onClick={() => void updateStatus('passed_with_comment')} icon={<MessageSquarePlus className="w-4 h-4" />} label="Passed with Comment" activeClass="bg-sky-600 text-white border-sky-600" /></div>{selected.status === 'passed_with_comment' && <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Enter your comment…" rows={2} className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200" />}<button onClick={() => void handleSubmit()} disabled={submitting || selected.status === 'pending'} className="ml-auto flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm bg-sky-600 text-white disabled:opacity-40">{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{submitting ? 'Submitting…' : 'Submit to Sheet'}</button></div></section>}
          </div>
        </main>
      </div>
      {toast && <div className="fixed bottom-6 right-6 z-50"><div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : toast.type === 'error' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-sky-50 text-sky-800 border-sky-200'}`}>{toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CircleDot className="w-4 h-4" />}<span>{toast.msg}</span></div></div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200"><p className="text-xs text-neutral-500">{label}</p><p className="text-sm font-bold text-neutral-900">{value}</p></div>; }
function ValidationButton({ active, onClick, icon, label, activeClass }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; activeClass: string }) { return <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border ${active ? `${activeClass} shadow-sm` : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`}>{icon}{label}</button>; }
