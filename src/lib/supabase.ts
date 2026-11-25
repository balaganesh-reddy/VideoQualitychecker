import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type ValidationStatus = 'pending' | 'pass' | 'fail' | 'passed_with_comment';

export interface SdCardRecord {
  id: string;
  entry_date: string | null;
  vc_name: string | null;
  ic_number: string | null;
  recorded_date: string | null;
  recorded_time: string | null;
  mcap_files: string | null;
  duration: string | null;
  video_status: string | null;
  city: string | null;
  project_ic_name: string | null;
  fo_name: string | null;
  sd_card_count: string | null;
  sd_card_duration: string | null;
  video_url: string | null;
  source_file: string | null;
  status: ValidationStatus;
  comment: string | null;
  submitted: boolean;
  created_at: string;
}
