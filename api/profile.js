// GET/PATCH /api/profile
import { supabase, ok, err } from '../_lib/clients.js';
import { getAuthUser } from '../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'PATCH' && req.method !== 'GET') {
        return res.status(405).json(err('Método não permitido.'));
    }

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    if (req.method === 'GET') {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error || !profile) return res.status(404).json(err('Perfil não encontrado.'));

        const { data: todayLog } = await supabase
            .from('workout_logs')
            .select('id')
            .eq('user_id', user.id)
            .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
            .limit(1);

        return res.status(200).json(ok({
            ...profile,
            daily_energy: profile.daily_energy || 'Alta',
            daily_sleep: profile.daily_sleep || '7.5h',
            daily_focus: profile.daily_focus || 'Nitidez',
            workout_completed_today: todayLog && todayLog.length > 0
        }));
    }

    if (req.method === 'PATCH') {
        const allowedFields = [
            'pref_name', 'age', 'weight', 'gender',
            'injuries', 'workout_location', 'equipment_tags',
            'ai_persona_type', 'incentive_phrase', 'diet_status',
            'discipline_score'
        ];

        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json(err('Nenhum campo válido para atualizar.'));
        }

        const { error: dbError } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id);

        if (dbError) return res.status(500).json(err(`Erro: ${dbError.message}`));

        return res.status(200).json(ok({ updated: true, fields: Object.keys(updates) }));
    }
}
