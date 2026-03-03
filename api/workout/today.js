// GET /api/workout/today
// Gera o treino do dia com base no perfil do aluno via IA
import { openai, ok, err } from '../../_lib/clients.js';
import { getAuthUser, getUserProfile, checkSubscription } from '../../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa.'));

    try {
        const { profile } = await getUserProfile(user.id);
        if (!profile) return res.status(404).json(err('Perfil não encontrado.'));

        const prompt = `
Gere um treino para hoje para ${profile.pref_name}.
- Equipamentos: ${profile.equipment_tags?.join(', ')}
- Local: ${profile.workout_location}
- Restrições: ${profile.injuries || 'Nenhuma'}
- Score de Disciplina: ${profile.discipline_score}/100

Retorne APENAS um JSON com este formato:
{
  "workout_name": "nome do treino",
  "duration_min": 60,
  "focus": "foco muscular",
  "exercises": [
    { "name": "nome", "sets": 4, "reps": "10-12", "rest_sec": 60, "cues": "dica técnica" }
  ]
}
    `.trim();

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });

        const workout = JSON.parse(completion.choices[0].message.content);
        return res.status(200).json(ok(workout));
    } catch (e) {
        console.error('[workout/today]', e);
        return res.status(500).json(err('Falha ao gerar treino.'));
    }
}
