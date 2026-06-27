/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSENGER_API_V2?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
