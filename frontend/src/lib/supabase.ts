import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tnvnevydxobtmiackdkz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRudm5ldnlkeG9idG1pYWNrZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjg1OTUsImV4cCI6MjA4Nzk0NDU5NX0.6XY4asZBs7IFo8Y3r1iAhvF4_51UadEerglKa1ZVZcg';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: true, persistSession: true },
});
