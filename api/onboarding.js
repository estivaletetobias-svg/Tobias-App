// POST /api/onboarding
// Salva dados do diagnóstico e cria thread OpenAI do aluno
import { supabase, ok, err } from '../_lib/clients.js';
import { getAuthUser } from '../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const {
        pref_name, age, weight, gender,
        injuries, workout_location, equipment_tags,
        ai_persona_type, incentive_phrase, diet_status
    } = req.body;

    try {
        // Criar thread na OpenAI via fetch nativo (evita bug do SDK no Vercel)
        const openaiRes = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2',
            },
            body: JSON.stringify({}),
        });

        if (!openaiRes.ok) {
            const errBody = await openaiRes.json();
            return res.status(500).json(err(`OpenAI: ${errBody.error?.message || openaiRes.status}`));
        }

        const thread = await openaiRes.json();

        // Salvar perfil no Supabase
        const { error: dbError } = await supabase
            .from('profiles')
            .upsert({
                id: user.id,
                full_name: user.user_metadata?.full_name,
                pref_name, age, weight, gender,
                injuries, workout_location,
                equipment_tags, ai_persona_type,
                incentive_phrase, diet_status,
                openai_thread_id: thread.id,
                discipline_score: 50
            });

        if (dbError) return res.status(500).json(err(`Supabase: ${dbError.message}`));

        return res.status(200).json(ok({ thread_id: thread.id, message: 'Perfil sincronizado.' }));
    } catch (e) {
        console.error('[onboarding]', e);
        return res.status(500).json(err(`Erro interno: ${e.message}`));
    }
}
