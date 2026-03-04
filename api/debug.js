// GET /api/debug — testa conexão com OpenAI e Supabase (remover após debug)
import { supabase, openai, ASSISTANT_ID } from '../_lib/clients.js';

export default async function handler(req, res) {
    const results = {};

    // Testar OpenAI
    try {
        const thread = await openai.beta.threads.create();
        results.openai = { ok: true, thread_id: thread.id };
        // Limpar thread de teste
        await openai.beta.threads.del(thread.id);
    } catch (e) {
        results.openai = { ok: false, error: e.message };
    }

    // Testar Supabase
    try {
        const { data, error } = await supabase.from('profiles').select('id').limit(1);
        results.supabase = error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
        results.supabase = { ok: false, error: e.message };
    }

    results.env = {
        openai_key_prefix: process.env.OPENAI_API_KEY?.slice(0, 12) + '...',
        assistant_id: ASSISTANT_ID,
        supabase_url: process.env.SUPABASE_URL,
    };

    return res.status(200).json(results);
}
