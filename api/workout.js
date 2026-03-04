// /api/workout — GET: treino do dia | POST: registrar treino
// Usa fetch nativo (sem SDK) para evitar timeout no Vercel Hobby
import { supabase, ok, err } from '../_lib/clients.js';
import { getAuthUser, getUserProfile, checkSubscription } from '../_lib/auth.js';

const OAI = (path, options = {}) =>
    fetch(`https://api.openai.com/v1${path}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

export default async function handler(req, res) {
    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa.'));

    // GET — Treino do dia
    if (req.method === 'GET') {
        try {
            const { profile } = await getUserProfile(user.id);
            if (!profile) return res.status(404).json(err('Perfil não encontrado.'));

            const prompt = `Gere um treino para hoje para ${profile.pref_name || 'o aluno'}.
- Local: ${profile.workout_location || 'academia'}
- Equipamentos: ${profile.equipment_tags?.join(', ') || 'academia completa'}
- Restrições: ${profile.injuries || 'nenhuma'}
- Score de Disciplina: ${profile.discipline_score || 50}/100

Retorne APENAS um JSON válido com este formato exato:
{
  "workout_name": "nome do treino",
  "duration_min": 60,
  "focus": "foco muscular",
  "exercises": [
    { "name": "nome", "sets": 4, "reps": "10-12", "rest_sec": 60, "cues": "dica técnica" }
  ]
}`;

            const r = await OAI('/chat/completions', {
                method: 'POST',
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    max_tokens: 1000,
                }),
            });

            if (!r.ok) {
                const errData = await r.json();
                throw new Error(`OpenAI ${r.status}: ${errData.error?.message || 'falha'}`);
            }

            const data = await r.json();
            const workout = JSON.parse(data.choices[0].message.content);
            return res.status(200).json(ok(workout));

        } catch (e) {
            console.error('[workout GET]', e.message);
            return res.status(500).json(err(`Falha ao gerar treino: ${e.message}`));
        }
    }

    // POST — Registrar treino concluído
    if (req.method === 'POST') {
        const { workout_name, perceived_effort, exercises_summary } = req.body;
        try {
            // Salvar nome enriquecido com exercícios (para a IA ter contexto completo)
            const richName = exercises_summary
                ? `${workout_name || 'Treino do Dia'} | ${exercises_summary}`
                : (workout_name || 'Treino do Dia');

            await supabase.from('workout_logs').insert({
                user_id: user.id,
                workout_name: richName,
                perceived_effort
                // completed_at é auto-preenchido pelo Supabase
            });

            const { data: logs } = await supabase
                .from('workout_logs')
                .select('id')
                .eq('user_id', user.id)
                .gte('completed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

            const newScore = Math.min(100, Math.round(((logs?.length || 0) / 30) * 100));
            await supabase.from('profiles').update({ discipline_score: newScore }).eq('id', user.id);

            return res.status(200).json(ok({ discipline_score: newScore, message: 'Treino registrado!' }));
        } catch (e) {
            console.error('[workout POST]', e.message);
            return res.status(500).json(err('Falha ao registrar treino.'));
        }
    }

    return res.status(405).json(err('Método não permitido.'));
}
