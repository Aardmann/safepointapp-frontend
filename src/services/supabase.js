import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace with your Supabase URL and anon key
const supabaseUrl = 'https://mzkkjvpnptmzmqohztak.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16a2tqdnBucHRtem1xb2h6dGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNzM3MzMsImV4cCI6MjA4Njk0OTczM30.MSj7LywgXdAV_60MpnFZTQp25qnUt8I37il3tJ77EAY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});