import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SdCardRecord, ValidationStatus } from '@/lib/supabase';
import { pickSdCardDirectory, createVideoObjectUrl } from '@/lib/sdCardScanner';
import type { DetectedFile } from '@/lib/sdCardScanner';
import VideoPlayer from '@/components/VideoPlayer';
import SdCardDetails from '@/components/SdCardDetails';
import {
  HardDrive,
  CheckCircle2,
  XCircle,
  MessageSquarePlus,
  Send,
  Search,
  Loader2,
  CircleDot,
  CheckCheck,
  AlertCircle,
  Usb,
  FolderOpen,
  RefreshCw,
  Info,
  FileText,
} from 'lucide-react';

const STATUS_LABELS: Record<ValidationStatus, string> = {
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Fail',
  passed_with_comment: 'Passed with Comment',
};

const STATUS_BADGES: Record<ValidationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  pass: 'bg-emerald-100 text-emerald-700',
  fail: 'bg-red-100 text-red-700',
  passed_with_comment: 'bg-sky-100 text-sky-700',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function App() {
  const [records, setRecords] = useState<SdCardRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);

  // SD card connection state
  const [cardConnected, setCardConnected] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [detectedMetaFiles, setDetectedMetaFiles] = useState<DetectedFile[]>([]);

  // Object URL for the currently played local file
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Record the user asked to play before the card was (re)connected
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);

  // Latest records/playFile for use inside the async connect flow
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const playFileRef = useRef<(r: SdCardRecord) => void>(() => {});

  const selected = records.find((r) => r.id === selectedId) ?? null;

  const fetchRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('sd_card_records')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setToast({ type: 'error', msg: 'Could not load SD card records.' });
    } else {
      setRecords((data as SdCardRecord[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Revoke object URL on change/unmount
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setComment(selected?.comment ?? '');
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectCard = async () => {
    setScanning(true);
    try {
      const result = await pickSdCardDirectory();
      if (!result) {
        setScanning(false);
        return; // user cancelled
      }
      setDetectedFiles(result.files);
      setDetectedMetaFiles(result.metadataFiles);
      setCardConnected(result.rootName);

      if (result.files.length === 0 && result.metadataFiles.length === 0) {
        setToast({ type: 'info', msg: `Connected to "${result.rootName}" but no video or mcap files were found on it.` });
      } else {
        setToast({
          type: 'success',
          msg: `Detected ${result.files.length} video file(s) and ${result.metadataFiles.length} mcap file(s) on "${result.rootName}".`,
        });
      }

      await importDetectedFiles(result.rootName, result.files, result.metadataFiles);

      // If the user clicked a clip before the card was read, play it now.
      if (pendingPlayId) {
        const target = recordsRef.current.find((r) => r.id === pendingPlayId);
        setPendingPlayId(null);
        if (target) {
          // Re-run after state updates land.
          setTimeout(() => playFileRef.current(target), 0);
          return;
        }
      }
    } catch (err) {
      setToast({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Could not read the SD card.',
      });
    } finally {
      setScanning(false);
    }
  };

  const importDetectedFiles = async (
    cardName: string,
    files: DetectedFile[],
    metaFiles: DetectedFile[],
  ) => {
    if (files.length === 0 && metaFiles.length === 0) return;
    setImporting(true);
    try {
      const { data: existing } = await supabase
        .from('sd_card_records')
        .select('source_file')
        .eq('sd_card_count', cardName);

      const known = new Set((existing ?? []).map((r) => r.source_file));
      const newVideos = files.filter((f) => !known.has(f.name));
      const newMetas = metaFiles.filter((f) => !known.has(f.name));

      if (newVideos.length === 0 && newMetas.length === 0) {
        await fetchRecords();
        setToast({ type: 'info', msg: 'All files on this card are already loaded.' });
        return;
      }

      const now = new Date();
      const rows = [
        ...newVideos.map((f) => ({
          entry_date: now.toISOString().slice(0, 10),
          vc_name: '',
          ic_number: '',
          recorded_date: now.toISOString().slice(0, 10),
          recorded_time: '00:00:00',
          mcap_files: '',
          duration: '',
          video_status: 'Detected from card',
          city: '',
          project_ic_name: '',
          fo_name: '',
          sd_card_count: cardName,
          sd_card_duration: '',
          video_url: f.path,
          source_file: f.name,
          status: 'pending' as const,
        })),
        ...newMetas.map((f) => ({
          entry_date: now.toISOString().slice(0, 10),
          vc_name: '',
          ic_number: '',
          recorded_date: now.toISOString().slice(0, 10),
          recorded_time: '00:00:00',
          mcap_files: f.name,
          duration: '',
          video_status: 'Metadata file',
          city: '',
          project_ic_name: '',
          fo_name: '',
          sd_card_count: cardName,
          sd_card_duration: '',
          video_url: null,
          source_file: f.name,
          status: 'pending' as const,
        })),
      ];

      const { error } = await supabase.from('sd_card_records').insert(rows);
      if (error) {
        setToast({ type: 'error', msg: 'Could not save the detected files.' });
        return;
      }

      // Link each mcap file to the video with the same base name
      // (e.g. clip_001.mcap → clip_001.mp4).
      const stem = (name: string) => name.replace(/\.[^.]+$/, '');
      for (const meta of metaFiles) {
        const match = files.find((v) => stem(v.name) === stem(meta.name));
        if (match) {
          await supabase
            .from('sd_card_records')
            .update({ mcap_files: meta.name })
            .eq('sd_card_count', cardName)
            .eq('source_file', match.name);
        }
      }

      await fetchRecords();
      setToast({
        type: 'success',
        msg: `Imported ${newVideos.length} video file(s) and ${newMetas.length} mcap file(s) from "${cardName}".`,
      });
    } finally {
      setImporting(false);
    }
  };

  const playFile = (record: SdCardRecord) => {
    // Try matching by stored file name, then by the file name inside video_url.
    const urlBasename = record.video_url?.split('/').pop()?.split('?')[0] ?? '';
    const detected =
      detectedFiles.find((f) => f.name === record.source_file) ??
      detectedFiles.find((f) => f.name === urlBasename) ??
      detectedFiles.find((f) => f.path === record.video_url);

    if (detected) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(createVideoObjectUrl(detected.file));
      setSelectedId(record.id);
      return;
    }

    if (record.video_url?.startsWith('http')) {
      setVideoUrl(record.video_url);
      setSelectedId(record.id);
      return;
    }

    if (record.video_status === 'Metadata file') {
      setToast({ type: 'info', msg: `"${record.source_file}" is a data file — it has no video to play.` });
      return;
    }

    // No local file available: the app needs the folder re-picked this session.
    setPendingPlayId(record.id);
    setToast({
      type: 'info',
      msg: `To play "${record.source_file ?? record.sd_card_count}", pick the card folder when prompted — it will start playing right after.`,
    });
    connectCard();
  };
  playFileRef.current = playFile;

  const updateStatus = async (status: ValidationStatus) => {
    if (!selected) return;
    const newComment = status === 'passed_with_comment' ? comment : null;
    const { error } = await supabase
      .from('sd_card_records')
      .update({ status, comment: newComment })
      .eq('id', selected.id);
    if (error) {
      setToast({ type: 'error', msg: 'Could not save validation status.' });
      return;
    }
    setRecords((prev) =>
      prev.map((r) => (r.id === selected.id ? { ...r, status, comment: newComment } : r)),
    );
    setToast({ type: 'success', msg: `Validation set to "${STATUS_LABELS[status]}".` });
  };

  const handleSubmit = async () => {
    if (!selected) return;
    if (selected.status === 'pending') {
      setToast({ type: 'error', msg: 'Please select Pass, Fail, or Passed with Comment before submitting.' });
      return;
    }
    if (selected.status === 'passed_with_comment' && !comment.trim()) {
      setToast({ type: 'error', msg: 'A comment is required for "Passed with Comment".' });
      return;
    }

    setSubmitting(true);
    try {
      const funcUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-to-sheet`;
      const res = await fetch(funcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ recordId: selected.id }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = errBody?.detail ? ` — ${errBody.detail}` : '';
        throw new Error(`${errBody?.error ?? `Request failed (${res.status})`}${detail}`);
      }
      const result = await res.json();
      setRecords((prev) =>
        prev.map((r) => (r.id === selected.id ? { ...r, submitted: true } : r)),
      );
      if (result.sheetPushed === false) {
        const sheetErr = result.sheetError ? ` Reason: ${result.sheetError}` : '';
        setToast({ type: 'info', msg: `${result.message}${sheetErr}` });
      } else {
        setToast({ type: 'success', msg: result.message ?? 'Record submitted to Google Sheet successfully.' });
      }
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Submission failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        const q = search.toLowerCase();
        return (
          r.vc_name?.toLowerCase().includes(q) ||
          r.ic_number?.toLowerCase().includes(q) ||
          r.city?.toLowerCase().includes(q) ||
          r.sd_card_count?.toLowerCase().includes(q) ||
          r.project_ic_name?.toLowerCase().includes(q) ||
          r.source_file?.toLowerCase().includes(q)
        );
      }),
    [records, search]
  );

  const pendingCount = records.filter((r) => r.status === 'pending').length;
  const validatedCount = records.filter((r) => r.status !== 'pending').length;
  const submittedCount = records.filter((r) => r.submitted).length;

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="px-6 py-3 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-600 text-white shadow-sm">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-neutral-900 leading-tight">SD Card Validation Dashboard</h1>
              <p className="text-xs text-neutral-500">Detect card, review clips, validate, submit</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="hidden md:flex items-center gap-3">
              <Stat label="Pending" value={pendingCount} icon={<CircleDot className="w-4 h-4 text-amber-500" />} />
              <Stat label="Validated" value={validatedCount} icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
              <Stat label="Submitted" value={submittedCount} icon={<CheckCheck className="w-4 h-4 text-sky-500" />} />
            </div>
            <button
              onClick={connectCard}
              disabled={scanning || importing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Usb className="w-4 h-4" />}
              {scanning ? 'Scanning…' : cardConnected ? 'Re-scan Card' : 'Connect SD Card'}
            </button>
          </div>
        </div>
        {cardConnected && (
          <div className="px-6 py-1.5 bg-emerald-50 border-t border-emerald-100 flex items-center gap-2 text-xs text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="font-medium">Card connected:</span> "{cardConnected}" — {detectedFiles.length} video
            file(s), {detectedMetaFiles.length} mcap file(s) detected
            {importing && (
              <span className="inline-flex items-center gap-1 text-sky-700">
                <Loader2 className="w-3 h-3 animate-spin" /> Importing…
              </span>
            )}
          </div>
        )}
      </header>

      {/* Main layout: left list, center player + details, right validation */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left column: detected files list */}
        <div className="flex flex-col gap-4 p-4 w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200 bg-white lg:min-h-0 max-h-[45vh] lg:max-h-none">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700">
              {cardConnected ? 'Detected Files' : 'Records'}
            </h2>
            <span className="text-xs text-neutral-400">{filtered.length} found</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:bg-white transition-colors"
            />
          </div>

          {!cardConnected && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 flex items-start gap-2 text-xs text-sky-900">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>Connect your SD card reader and click "Connect SD Card" to detect its video files.</p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading && (
              <div className="flex items-center justify-center py-10 text-neutral-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-neutral-400">
                <HardDrive className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{cardConnected ? 'No video files on this card.' : 'No records yet.'}</p>
              </div>
            )}
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => playFile(r)}
                className={`w-full text-left rounded-lg border px-3 py-3 transition-all ${
                  selectedId === r.id
                    ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-300'
                    : 'border-neutral-200 bg-white hover:border-sky-300 hover:bg-sky-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-neutral-900 truncate flex items-center gap-1.5">
                    {r.video_status === 'Metadata file' && (
                      <FileText className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    )}
                    {r.source_file ?? r.sd_card_count}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <span className="truncate">{r.sd_card_count}</span>
                  <span>·</span>
                  <span>{formatDate(r.recorded_date)}</span>
                  {r.duration && <span>·</span>}
                  {r.duration && <span className="truncate">{r.duration}</span>}
                </div>
                {r.submitted && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-sky-600">
                    <CheckCheck className="w-3 h-3" /> Submitted to Sheet
                  </div>
                )}
              </button>
            ))}
          </div>

          {cardConnected && (
            <button
              onClick={connectCard}
              disabled={scanning}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200 hover:bg-neutral-200 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              Re-scan card
            </button>
          )}
        </div>

        {/* Center column: video player + SD card details */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="p-4 lg:p-6 flex flex-col gap-4 items-stretch max-w-3xl w-full mx-auto">
            {/* Video player in the middle of the screen */}
            <div className="w-full aspect-video">
              {videoUrl ? (
                <VideoPlayer
                  src={videoUrl}
                  title={selected ? `${selected.source_file ?? selected.sd_card_count}` : undefined}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full bg-neutral-950 rounded-xl border border-neutral-800 text-neutral-500">
                  <FolderOpen className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs">Select a file to play</p>
                </div>
              )}
            </div>

            {/* SD card details */}
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
              <SdCardDetails record={selected} />
            </div>

            {/* Validation + Submit */}
            {selected && (
              <div className="border border-neutral-200 bg-white rounded-xl px-5 py-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                  VC Validation
                </p>
                <div className="flex flex-col xl:flex-row xl:items-end gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ValidationButton
                        active={selected.status === 'pass'}
                        onClick={() => updateStatus('pass')}
                        icon={<CheckCircle2 className="w-4 h-4" />}
                        label="Pass"
                        activeClass="bg-emerald-600 text-white border-emerald-600"
                      />
                      <ValidationButton
                        active={selected.status === 'fail'}
                        onClick={() => updateStatus('fail')}
                        icon={<XCircle className="w-4 h-4" />}
                        label="Fail"
                        activeClass="bg-red-600 text-white border-red-600"
                      />
                      <ValidationButton
                        active={selected.status === 'passed_with_comment'}
                        onClick={() => updateStatus('passed_with_comment')}
                        icon={<MessageSquarePlus className="w-4 h-4" />}
                        label="Passed with Comment"
                        activeClass="bg-sky-600 text-white border-sky-600"
                      />
                    </div>
                    {selected.status === 'passed_with_comment' && (
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Enter your comment…"
                        rows={2}
                        className="mt-3 w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:bg-white transition-colors resize-none"
                      />
                    )}
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || selected.status === 'pending'}
                      className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm w-full xl:w-auto"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" /> Submit to Sheet
                        </>
                      )}
                    </button>
                    {selected.submitted && (
                      <p className="mt-1.5 text-xs text-sky-600 flex items-center gap-1 justify-center xl:justify-end">
                        <CheckCheck className="w-3.5 h-3.5" /> Already submitted
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : toast.type === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-sky-50 text-sky-800 border-sky-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CircleDot className="w-4 h-4 shrink-0" />
            )}
            <span className="max-w-lg">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200">
      {icon}
      <div className="leading-tight">
        <p className="text-xs text-neutral-500">{label}</p>
        <p className="text-sm font-bold text-neutral-900">{value}</p>
      </div>
    </div>
  );
}

function ValidationButton({
  active,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
        active
          ? `${activeClass} shadow-sm`
          : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
