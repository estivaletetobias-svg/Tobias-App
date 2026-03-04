// PATCH /api/profile — salva dados coletados pelo onboarding via IA
import { supabase, ok, err } from '../_lib/clients.js';
import { getAuthUser } from '../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    // Aceitar qualquer subconjunto dos campos de perfil
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
