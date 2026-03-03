// Clientes compartilhados: Supabase + OpenAI
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Helper padrão de resposta
export const ok = (data) => ({ success: true, data });
export const err = (msg) => ({ success: false, error: msg });
