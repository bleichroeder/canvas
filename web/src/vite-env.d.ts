/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSENGER_API_V2?: string;
  readonly VITE_CANVAS_API?: string;
  readonly VITE_BUILD_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
