// POST /api/chat
// Envia mensagem para o Master Coach com streaming (evita timeout Vercel)
// Configuração: Node.js runtime com maxDuration 60s (Vercel Pro) ou 10s (Free)

export const config = { runtime: 'nodejs', maxDuration: 60 };

import { supabase, openai, ASSISTANT_ID, err } from '../_lib/clients.js';
import { getAuthUser, getUserProfile, checkSubscription } from '../_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json(err('Método não permitido.'));

    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa. Acesso bloqueado.'));

    const { message } = req.body;
    if (!message) return res.status(400).json(err('Mensagem ausente.'));

    try {
        const { profile } = await getUserProfile(user.id);
        if (!profile) return res.status(404).json(err('Perfil não encontrado.'));

        // Injeção de Contexto — Presença Assíncrona do Tobias
        const contextMessage = `
[CONTEXTO DO ALUNO — NÃO REVELAR]
Nome preferido: ${profile.pref_name}
Score de Disciplina: ${profile.discipline_score}/100
Persona: ${profile.ai_persona_type}
Frase motivacional: "${profile.incentive_phrase}"
Local de treino: ${profile.workout_location}
Equipamentos: ${profile.equipment_tags?.join(', ')}
Lesões: ${profile.injuries || 'Nenhuma'}
[FIM DO CONTEXTO]
    `.trim();

        // Adicionar mensagem à thread do aluno
        await openai.beta.threads.messages.create(profile.openai_thread_id, {
            role: 'user',
            content: `${contextMessage}\n\nMensagem: ${message}`
        });

        // Streaming — Vercel mantém a conexão aberta enquanto a IA responde
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const stream = openai.beta.threads.runs.stream(profile.openai_thread_id, {
            assistant_id: ASSISTANT_ID,
            model: 'gpt-4o-mini',
        });

        for await (const chunk of stream) {
            if (chunk.event === 'thread.message.delta') {
                const text = chunk.data.delta.content?.[0]?.text?.value;
                if (text) {
                    res.write(`data: ${JSON.stringify({ text })}\n\n`);
                }
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();

    } catch (e) {
        console.error('[chat]', e);
        res.status(500).json(err('Erro interno na IA.'));
    }
}
