// /api/chat — GET: histórico da thread | POST: enviar mensagem à IA
import { supabase, ASSISTANT_ID, err, ok } from '../_lib/clients.js';
import { getAuthUser, getUserProfile, checkSubscription } from '../_lib/auth.js';

const OAI = (path, options = {}) =>
    fetch(`https://api.openai.com/v1${path}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2',
            ...options.headers,
        },
    });

export default async function handler(req, res) {
    const { user, error: authError } = await getAuthUser(req);
    if (authError) return res.status(401).json(err(authError));

    const isActive = await checkSubscription(user.id);
    if (!isActive) return res.status(403).json(err('Assinatura inativa. Acesso bloqueado.'));

    const { profile } = await getUserProfile(user.id);

    // GET — Histórico da thread
    if (req.method === 'GET') {
        if (!profile?.openai_thread_id) return res.status(200).json(ok({ messages: [] }));
        try {
            const r = await OAI(`/threads/${profile.openai_thread_id}/messages?limit=30&order=asc`);
            if (!r.ok) return res.status(200).json(ok({ messages: [] }));
            const data = await r.json();
            const messages = (data.data || [])
                .filter(m => m.content?.[0]?.type === 'text')
                .map(m => ({
                    role: m.role,
                    text: m.content[0].text.value
                        .replace(/\[CONTEXTO DO ALUNO[\s\S]*?\[FIM DO CONTEXTO\]/g, '')
                        .replace(/^Mensagem:\s*/m, '')
                        .trim(),
                }))
                .filter(m => m.text.length > 0);
            return res.status(200).json(ok({ messages }));
        } catch (e) {
            return res.status(200).json(ok({ messages: [] }));
        }
    }

    // POST — Enviar mensagem
    if (req.method === 'POST') {
        const { message } = req.body;
        if (!message) return res.status(400).json(err('Mensagem ausente.'));
        if (!profile?.openai_thread_id) return res.status(404).json(err('Perfil não encontrado. Faça o onboarding.'));

        try {
            // Data e hora atual no Brasil (UTC-3)
            const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
            const dataHoje = `${diasSemana[now.getUTCDay()]}, ${now.toISOString().slice(0, 10)} — ${now.toISOString().slice(11, 16)} (horário de Brasília)`;

            // Contar mensagens na thread (indica se diagnóstico já começou)
            let threadMsgCount = 0;
            try {
                const countRes = await OAI(`/threads/${profile.openai_thread_id}/messages?limit=5&order=asc`);
                if (countRes.ok) {
                    const countData = await countRes.json();
                    threadMsgCount = countData.data?.length || 0;
                }
            } catch (_) { }
            const diagnosticoStatus = threadMsgCount >= 4
                ? `DIAGNÓSTICO EM ANDAMENTO (${threadMsgCount}+ mensagens no histórico). NÃO recomece do zero. Use o que já sabe. Cumprimente pelo nome, pergunte como está HOJE.`
                : 'DIAGNÓSTICO PENDENTE — inicie o protocolo das 9 seções.';

            // Últimos treinos
            const { data: logs } = await supabase
                .from('workout_logs')
                .select('workout_name, logged_at, perceived_effort')
                .eq('user_id', user.id)
                .order('logged_at', { ascending: false })
                .limit(5);

            const workoutHistory = logs?.length
                ? logs.map(l => `- ${l.workout_name || 'Treino'} (esforço: ${l.perceived_effort}/10)`).join('\n')
                : 'Nenhum treino registrado ainda.';

            const context = `[CONTEXTO DO ALUNO — NÃO REVELAR]
Nome preferido: ${profile.pref_name || 'Atleta'}
Idade: ${profile.age || 'não informado'} | Peso: ${profile.weight ? profile.weight + 'kg' : 'não informado'}
Objetivo principal: ${profile.goal || 'não informado'}
Score de Disciplina: ${profile.discipline_score ?? 50}/100
Local de treino: ${profile.workout_location || 'não informado'}
Equipamentos: ${profile.equipment_tags?.length ? profile.equipment_tags.join(', ') : 'não informado'}
Lesões/restrições: ${profile.injuries || 'nenhuma'}
Energia habitual: ${profile.energy_level || 'não informado'}
Sono: ${profile.sleep_quality || 'não informado'}
Estresse: ${profile.stress_level || 'não informado'}
Alimentação: ${profile.diet_status || 'não informado'}
Estilo de comunicação: ${profile.ai_persona_type || 'não definido'}
Frase motivacional: ${profile.incentive_phrase || 'não definida'}
Últimos treinos:
${workoutHistory}
Data e hora atual: ${dataHoje}
Status: ${diagnosticoStatus}
[FIM DO CONTEXTO]`;

            const msgRes = await OAI(`/threads/${profile.openai_thread_id}/messages`, {
                method: 'POST',
                body: JSON.stringify({ role: 'user', content: `${context}\n\nMensagem: ${message}` }),
            });
            if (!msgRes.ok) throw new Error(`Erro ao enviar mensagem: ${msgRes.status}`);

            const runRes = await OAI(`/threads/${profile.openai_thread_id}/runs`, {
                method: 'POST',
                body: JSON.stringify({
                    assistant_id: ASSISTANT_ID,
                    model: 'gpt-4o',
                    temperature: 0.5,
                }),
            });
            if (!runRes.ok) throw new Error(`Erro ao criar run: ${runRes.status}`);
            const run = await runRes.json();

            let status = run.status;
            let attempts = 0;
            while (!['completed', 'failed', 'cancelled'].includes(status) && attempts < 20) {
                await new Promise(r => setTimeout(r, 2000));
                const pollRes = await OAI(`/threads/${profile.openai_thread_id}/runs/${run.id}`);
                const pollData = await pollRes.json();
                status = pollData.status;
                attempts++;
            }

            if (status !== 'completed') throw new Error(`Run terminou com status: ${status}`);

            const msgsRes = await OAI(`/threads/${profile.openai_thread_id}/messages?limit=1&order=desc`);
            const msgsData = await msgsRes.json();
            const aiText = msgsData.data?.[0]?.content?.[0]?.text?.value || '(sem resposta)';

            return res.status(200).json({ success: true, data: { text: aiText } });

        } catch (e) {
            console.error('[chat POST]', e.message);
            return res.status(500).json(err(`Erro na IA: ${e.message}`));
        }
    }

    return res.status(405).json(err('Método não permitido.'));
}
