// GET /api/admin/dashboard — lista clientes
// DELETE /api/admin/dashboard — remove usuário
// PATCH /api/admin/dashboard — ativa/desativa usuário
import { supabase, err, ok } from '../../_lib/clients.js';

export default async function handler(req, res) {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json(err('Acesso negado.'));
    }

    // DELETE — remover usuário
    if (req.method === 'DELETE') {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json(err('user_id obrigatório.'));
        try {
            await supabase.from('profiles').delete().eq('id', user_id);
            const { error } = await supabase.auth.admin.deleteUser(user_id);
            if (error) throw error;
            return res.status(200).json(ok({ deleted: true }));
        } catch (e) {
            return res.status(500).json(err(`Erro ao deletar: ${e.message}`));
        }
    }

    // PATCH — ativar/desativar acesso
    if (req.method === 'PATCH') {
        const { user_id, is_active } = req.body;
        if (!user_id) return res.status(400).json(err('user_id obrigatório.'));
        try {
            await supabase.from('profiles').update({ is_active }).eq('id', user_id);
            return res.status(200).json(ok({ updated: true, is_active }));
        } catch (e) {
            return res.status(500).json(err(`Erro ao atualizar: ${e.message}`));
        }
    }

    // GET — listar todos os clientes
    if (req.method !== 'GET') return res.status(405).json(err('Método não permitido.'));

    try {
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, pref_name, workout_location, discipline_score, is_active, openai_thread_id, ai_persona_type, injuries, created_at')
            .order('discipline_score', { ascending: false });
        if (profileError) throw profileError;

        const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
        if (usersError) throw usersError;

        const { data: logs } = await supabase
            .from('workout_logs')
            .select('user_id, workout_name, logged_at, perceived_effort')
            .order('logged_at', { ascending: false });

        const userMap = {};
        for (const u of users) userMap[u.id] = { email: u.email, created_at: u.created_at };

        const lastWorkoutMap = {};
        for (const log of (logs || [])) {
            if (!lastWorkoutMap[log.user_id]) lastWorkoutMap[log.user_id] = log;
        }

        const now = new Date();
        const clients = profiles.map(p => {
            const auth = userMap[p.id] || {};
            const lastLog = lastWorkoutMap[p.id];
            const daysSinceTrain = lastLog
                ? Math.floor((now - new Date(lastLog.logged_at)) / (1000 * 60 * 60 * 24))
                : null;
            return {
                id: p.id,
                name: p.pref_name || auth.email?.split('@')[0] || 'Sem nome',
                email: auth.email || '—',
                is_active: p.is_active,
                has_onboarding: !!p.openai_thread_id,
                discipline_score: p.discipline_score || 0,
                workout_location: p.workout_location || '—',
                last_workout: lastLog ? { name: lastLog.workout_name, date: lastLog.logged_at, effort: lastLog.perceived_effort, days_ago: daysSinceTrain } : null,
                at_risk: daysSinceTrain === null ? p.is_active : daysSinceTrain >= 4,
                member_since: auth.created_at || p.created_at,
            };
        });

        const stats = {
            total: clients.length,
            active: clients.filter(c => c.is_active).length,
            onboarded: clients.filter(c => c.has_onboarding).length,
            at_risk: clients.filter(c => c.is_active && c.at_risk).length,
            avg_score: Math.round(clients.reduce((s, c) => s + c.discipline_score, 0) / (clients.length || 1)),
        };

        return res.status(200).json(ok({ stats, clients }));
    } catch (e) {
        console.error('[admin/dashboard]', e.message);
        return res.status(500).json(err(`Erro: ${e.message}`));
    }
}
