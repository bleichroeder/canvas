/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSENGER_API?: string;
  readonly VITE_PASSENGER_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
