/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANVAS_API?: string;
  readonly VITE_BUILD_SHA?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
