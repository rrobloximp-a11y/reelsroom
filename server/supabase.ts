import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Service role: bypasses row security, used only on the server.
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
// Anon key: acts as a regular visitor, used for sending auth emails.
export const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
