// GET /api/admin/dashboard — Painel exclusivo do Fundador
// Protegido por ADMIN_SECRET no header

import { supabase, err, ok } from '../../_lib/clients.js';

export default async function handler(req, res) {
    // Autenticação simples por secret
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json(err('Acesso negado.'));
    }

    try {
        // Buscar todos os perfis com dados dos usuários
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, pref_name, workout_location, discipline_score, is_active, openai_thread_id, ai_persona_type, injuries, created_at')
            .order('discipline_score', { ascending: false });

        if (profileError) throw profileError;

        // Buscar emails dos usuários auth
        const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
        if (usersError) throw usersError;

        // Buscar últimos treinos de todos os usuários
        const { data: logs } = await supabase
            .from('workout_logs')
            .select('user_id, workout_name, logged_at, perceived_effort')
            .order('logged_at', { ascending: false });

        // Mapear email para cada perfil
        const userMap = {};
        for (const u of users) {
            userMap[u.id] = { email: u.email, created_at: u.created_at };
        }

        // Mapear último treino por usuário
        const lastWorkoutMap = {};
        for (const log of (logs || [])) {
            if (!lastWorkoutMap[log.user_id]) {
                lastWorkoutMap[log.user_id] = log;
            }
        }

        // Montar dados completos
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
                ai_persona: p.ai_persona_type || '—',
                injuries: p.injuries || 'Nenhuma',
                last_workout: lastLog ? {
                    name: lastLog.workout_name,
                    date: lastLog.logged_at,
                    effort: lastLog.perceived_effort,
                    days_ago: daysSinceTrain,
                } : null,
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
