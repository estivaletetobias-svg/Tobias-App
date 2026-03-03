// POST /api/workout/log
// Registra treino concluído e recalcula o Discipline Score
import { supabase, ok, err } from '../../_lib/clients.js';
import { getAuthUser, checkSubscription } from '../../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa.'));

    const { workout_name, perceived_effort } = req.body;

    try {
        // Registrar o treino
        await supabase.from('workout_logs').insert({
            user_id: user.id,
            workout_name,
            perceived_effort
        });

        // Recalcular Score — treinos nos últimos 30 dias
        const { data: logs } = await supabase
            .from('workout_logs')
            .select('id')
            .eq('user_id', user.id)
            .gte('completed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        const newScore = Math.min(100, Math.round((logs.length / 30) * 100));

        await supabase
            .from('profiles')
            .update({ discipline_score: newScore })
            .eq('id', user.id);

        return res.status(200).json(ok({ discipline_score: newScore, message: 'Treino registrado!' }));
    } catch (e) {
        console.error('[workout/log]', e);
        return res.status(500).json(err('Falha ao registrar treino.'));
    }
}
