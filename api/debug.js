// GET /api/debug — testa conexão com OpenAI e Supabase (remover após debug)
import { supabase } from '../_lib/clients.js';

export default async function handler(req, res) {
    const results = {};

    // Testar via fetch nativo (sem SDK)
    try {
        const r = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2',
            },
            body: JSON.stringify({}),
        });
        const body = await r.json();
        if (r.ok) {
            results.openai_fetch = { ok: true, thread_id: body.id };
        } else {
            results.openai_fetch = { ok: false, status: r.status, error: body.error?.message };
        }
    } catch (e) {
        results.openai_fetch = { ok: false, error: e.message };
    }

    // Testar Supabase
    try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        results.supabase = error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
        results.supabase = { ok: false, error: e.message };
    }

    results.env = {
        openai_key_prefix: process.env.OPENAI_API_KEY?.slice(0, 15) + '...',
        key_length: process.env.OPENAI_API_KEY?.length,
    };

    return res.status(200).json(results);
}
