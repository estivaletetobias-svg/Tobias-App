// Clientes compartilhados: Supabase + OpenAI
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 25000,   // 25s — abaixo do limite de 30s do Vercel
    maxRetries: 1,
});

export const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Helper padrão de resposta
export const ok = (data) => ({ success: true, data });
export const err = (msg) => ({ success: false, error: msg });
