import {
  CalendarDays,
  User,
  CreditCard,
  Clock,
  Film,
  Timer,
  Video,
  MapPin,
  Briefcase,
  HardDrive,
  Hourglass,
  FileVideo,
} from 'lucide-react';
import type { SdCardRecord } from '@/lib/supabase';
import type { ValidationStatus } from '@/lib/supabase';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function FieldCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 transition-colors hover:border-sky-300 hover:bg-sky-50/40">
      <div className="flex items-center justify-center w-9 h-9 rounded-md bg-sky-50 text-sky-600 shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-neutral-500 font-medium">{label}</p>
        <p className="text-sm font-semibold text-neutral-900 truncate" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<ValidationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  pass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  fail: 'bg-red-100 text-red-700 border-red-200',
  passed_with_comment: 'bg-sky-100 text-sky-700 border-sky-200',
};

const STATUS_LABELS: Record<ValidationStatus, string> = {
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Fail',
  passed_with_comment: 'Passed with Comment',
};

export default function SdCardDetails({ record }: { record: SdCardRecord | null }) {
  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-400 py-20">
        <HardDrive className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm">Select an SD card record from the list to view its details.</p>
      </div>
    );
  }

  const fields: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <CalendarDays className="w-4 h-4" />, label: 'Entry Date', value: formatDate(record.entry_date) },
    { icon: <User className="w-4 h-4" />, label: 'VC Name', value: record.vc_name ?? '—' },
    { icon: <CreditCard className="w-4 h-4" />, label: 'IC Number', value: record.ic_number ?? '—' },
    { icon: <CalendarDays className="w-4 h-4" />, label: 'Recorded Date', value: formatDate(record.recorded_date) },
    { icon: <Clock className="w-4 h-4" />, label: 'Recorded Time', value: record.recorded_time ?? '—' },
    { icon: <FileVideo className="w-4 h-4" />, label: 'Mcap Files', value: record.mcap_files ?? '—' },
    { icon: <Timer className="w-4 h-4" />, label: 'Duration', value: record.duration ?? '—' },
    { icon: <Video className="w-4 h-4" />, label: 'Video Status', value: record.video_status ?? '—' },
    { icon: <MapPin className="w-4 h-4" />, label: 'City', value: record.city ?? '—' },
    { icon: <Briefcase className="w-4 h-4" />, label: 'Project IC Name', value: record.project_ic_name ?? '—' },
    { icon: <User className="w-4 h-4" />, label: 'FO Name', value: record.fo_name ?? '—' },
    { icon: <HardDrive className="w-4 h-4" />, label: 'SD Card Count', value: record.sd_card_count ?? '—' },
    { icon: <Hourglass className="w-4 h-4" />, label: 'SD Card Duration', value: record.sd_card_duration ?? '—' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-600 text-white shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-900 truncate">SD Card Details</h2>
            <p className="text-xs text-neutral-500 truncate">
              {record.sd_card_count} · {record.city} · {record.vc_name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[record.status]}`}
          >
            {STATUS_LABELS[record.status]}
          </span>
          {record.submitted && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-indigo-100 text-indigo-700 border-indigo-200">
              Submitted
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-4 overflow-y-auto max-h-[50vh]">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
            Clip Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {fields.map((f) => (
              <FieldCard key={f.label} {...f} />
            ))}
          </div>
        </div>

        {record.comment && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-sky-700 font-medium mb-1">Comment</p>
            <p className="text-sm text-neutral-800">{record.comment}</p>
          </div>
        )}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 flex items-center gap-3">
          <Film className="w-5 h-5 text-neutral-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-neutral-500 font-medium">Video Source</p>
            <p className="text-sm font-mono text-neutral-700 truncate" title={record.video_url ?? ''}>
              {record.video_url ?? '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
