// GET /api/admin/history?user_id=xxx — histórico de treinos de um cliente
import { supabase, ok, err } from '../../_lib/clients.js';

export default async function handler(req, res) {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json(err('Acesso negado.'));
    }

    const { user_id } = req.query;
    if (!user_id) return res.status(400).json(err('user_id obrigatório.'));

    try {
        const { data: logs, error } = await supabase
            .from('workout_logs')
            .select('id, workout_name, perceived_effort, completed_at')
            .eq('user_id', user_id)
            .order('completed_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        return res.status(200).json(ok({ logs: logs || [] }));
    } catch (e) {
        return res.status(500).json(err(`Erro: ${e.message}`));
    }
}
