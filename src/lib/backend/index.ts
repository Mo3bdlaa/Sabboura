import { createLocalBackend } from "./local";
import { createSupabaseBackend } from "./supabase";
import type { Backend } from "./types";

export type * from "./types";

// Referenced literally so Next.js inlines them into the client bundle.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let backend: Backend | null = null;

/** Browser-only singleton. */
export function getBackend(): Backend {
  if (!backend) {
    backend =
      SUPABASE_URL && SUPABASE_KEY
        ? createSupabaseBackend(SUPABASE_URL, SUPABASE_KEY)
        : createLocalBackend();
  }
  return backend;
}
