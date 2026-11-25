/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional public/authorized read-only endpoint for the IC mapping sheet. */
  readonly VITE_IC_MAPPING_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
