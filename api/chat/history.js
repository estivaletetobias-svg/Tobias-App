// GET /api/chat/history — carrega mensagens anteriores da thread do aluno
import { getUserProfile, getAuthUser, checkSubscription } from '../../_lib/auth.js';
import { err, ok } from '../../_lib/clients.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa.'));

    const { profile } = await getUserProfile(user.id);
    if (!profile?.openai_thread_id) return res.status(200).json(ok({ messages: [] }));

    try {
        const r = await fetch(
            `https://api.openai.com/v1/threads/${profile.openai_thread_id}/messages?limit=30&order=asc`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2',
                },
            }
        );

        if (!r.ok) return res.status(200).json(ok({ messages: [] }));

        const data = await r.json();

        // Filtrar e formatar: só mensagens com texto, ignorar blocos de contexto
        const messages = (data.data || [])
            .filter(m => m.content?.[0]?.type === 'text')
            .map(m => ({
                role: m.role, // 'user' ou 'assistant'
                text: m.content[0].text.value
                    .replace(/\[CONTEXTO DO ALUNO[^\]]*\][^]*?\[FIM DO CONTEXTO\]/g, '') // remove bloco de contexto
                    .replace(/^Mensagem:\s*/m, '') // remove prefixo "Mensagem: "
                    .trim(),
            }))
            .filter(m => m.text.length > 0);

        return res.status(200).json(ok({ messages }));
    } catch (e) {
        console.error('[chat/history]', e.message);
        return res.status(200).json(ok({ messages: [] }));
    }
}
