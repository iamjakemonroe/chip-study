/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PRO_LIVE?: string;
  /** "1": sign in with Google and Microsoft (once their sign-in apps are set up in Supabase). */
  readonly VITE_SSO?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
