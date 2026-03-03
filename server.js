import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import crypto from 'crypto';

dotenv.config();

// ─── Clients ───────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY   // service role — nunca expor no front
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID; // ID do "Master Brain"

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// ─── Helper: Resposta Padrão ───────────────────────────────────────────────
const ok = (data) => ({ success: true, data });
const err = (msg) => ({ success: false, error: msg });

// ─── Middleware: Auth Guard ────────────────────────────────────────────────
async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json(err('Token ausente.'));

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json(err('Token inválido.'));

    req.user = user;
    next();
}

// ─── Middleware: Subscription Guard ───────────────────────────────────────
async function requireSubscription(req, res, next) {
    const { data: profile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', req.user.id)
        .single();

    if (!profile?.is_active) {
        return res.status(403).json(err('Assinatura inativa. Acesso bloqueado.'));
    }
    next();
}

// ══════════════════════════════════════════════════════════════════════════
//  ROTA 1 — POST /api/onboarding
//  Salva dados do diagnóstico e inicializa a thread OpenAI do aluno.
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/onboarding', requireAuth, async (req, res) => {
    const {
        pref_name, age, weight, gender,
        injuries, workout_location, equipment_tags,
        ai_persona_type, incentive_phrase, diet_status
    } = req.body;

    try {
        // 1. Criar thread persistente para este aluno na OpenAI
        const thread = await openai.beta.threads.create();

        // 2. Salvar/atualizar perfil no Supabase
        const { error: dbError } = await supabase
            .from('profiles')
            .upsert({
                id: req.user.id,
                full_name: req.user.user_metadata?.full_name,
                pref_name, age, weight, gender,
                injuries, workout_location,
                equipment_tags,
                ai_persona_type,
                incentive_phrase,
                diet_status,
                openai_thread_id: thread.id,
                discipline_score: 50
            });

        if (dbError) throw dbError;

        return res.json(ok({ thread_id: thread.id, message: 'Perfil sincronizado.' }));
    } catch (e) {
        console.error('[onboarding]', e);
        return res.status(500).json(err('Falha ao salvar o perfil.'));
    }
});

// ══════════════════════════════════════════════════════════════════════════
//  ROTA 2 — POST /api/chat
//  Envia mensagem para o Master Brain e retorna resposta personalizada.
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/chat', requireAuth, requireSubscription, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json(err('Mensagem ausente.'));

    try {
        // 1. Buscar perfil completo do aluno
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (profileErr || !profile) return res.status(404).json(err('Perfil não encontrado.'));

        // 2. Injeção de Contexto Dinâmico — o "Presença Assíncrona"
        const contextMessage = `
[CONTEXTO DO ALUNO — NÃO REVELAR AO USUÁRIO]
Nome preferido: ${profile.pref_name}
Score de Disciplina atual: ${profile.discipline_score}/100
Persona de comunicação escolhida: ${profile.ai_persona_type}
Frase motivacional pessoal: "${profile.incentive_phrase}"
Local de treino: ${profile.workout_location}
Equipamentos disponíveis: ${profile.equipment_tags?.join(', ')}
Lesões/Restrições: ${profile.injuries || 'Nenhuma informada'}
[FIM DO CONTEXTO]
    `.trim();

        // 3. Adicionar contexto + pergunta do aluno à thread
        await openai.beta.threads.messages.create(profile.openai_thread_id, {
            role: 'user',
            content: `${contextMessage}\n\nMensagem do aluno: ${message}`
        });

        // 4. Executar o Assistant — streaming para resposta mais rápida
        const run = await openai.beta.threads.runs.createAndPoll(
            profile.openai_thread_id,
            {
                assistant_id: ASSISTANT_ID,
                model: 'gpt-4o-mini', // custo baixo para interações rápidas
            }
        );

        if (run.status !== 'completed') {
            return res.status(500).json(err('A IA não conseguiu processar a mensagem.'));
        }

        // 5. Buscar última mensagem da IA
        const messages = await openai.beta.threads.messages.list(profile.openai_thread_id);
        const reply = messages.data[0]?.content[0]?.text?.value ?? 'Sem resposta.';

        return res.json(ok({ reply }));
    } catch (e) {
        console.error('[chat]', e);
        return res.status(500).json(err('Erro interno no processamento da IA.'));
    }
});

// ══════════════════════════════════════════════════════════════════════════
//  ROTA 3 — GET /api/workout/today
//  Gera o treino do dia baseado no perfil do aluno via IA.
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/workout/today', requireAuth, requireSubscription, async (req, res) => {
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        const prompt = `
Gere um treino para hoje para ${profile.pref_name}.
- Equipamentos: ${profile.equipment_tags?.join(', ')}
- Local: ${profile.workout_location}
- Restrições: ${profile.injuries || 'Nenhuma'}
- Score de Disciplina: ${profile.discipline_score}/100

Retorne um JSON com o formato:
{
  "workout_name": "Nome do treino",
  "duration_min": 60,
  "focus": "Membros superiores",
  "exercises": [
    { "name": "Nome", "sets": 4, "reps": "10-12", "rest_sec": 60, "cues": "Dica técnica" }
  ]
}
Retorne APENAS o JSON, sem explicações.
    `.trim();

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });

        const workout = JSON.parse(completion.choices[0].message.content);
        return res.json(ok(workout));
    } catch (e) {
        console.error('[workout/today]', e);
        return res.status(500).json(err('Falha ao gerar treino.'));
    }
});

// ══════════════════════════════════════════════════════════════════════════
//  ROTA 4 — POST /api/workout/log
//  Registra o treino concluído e atualiza o Discipline Score.
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/workout/log', requireAuth, requireSubscription, async (req, res) => {
    const { workout_name, perceived_effort } = req.body;

    try {
        // 1. Registrar o log
        await supabase.from('workout_logs').insert({
            user_id: req.user.id,
            workout_name,
            perceived_effort
        });

        // 2. Recalcular Discipline Score (média dos últimos 30 logs)
        const { data: logs } = await supabase
            .from('workout_logs')
            .select('id')
            .eq('user_id', req.user.id)
            .gte('completed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        // Cada treino nos últimos 30 dias vale ~3.3 pontos (100 / 30)
        const newScore = Math.min(100, Math.round((logs.length / 30) * 100));

        await supabase
            .from('profiles')
            .update({ discipline_score: newScore })
            .eq('id', req.user.id);

        return res.json(ok({ discipline_score: newScore, message: 'Treino registrado.' }));
    } catch (e) {
        console.error('[workout/log]', e);
        return res.status(500).json(err('Falha ao registrar treino.'));
    }
});

// ══════════════════════════════════════════════════════════════════════════
//  ROTA 5 — POST /api/webhook/eduzz
//  Controle de acesso baseado em pagamentos.
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/webhook/eduzz', async (req, res) => {
    // Validação de assinatura Eduzz (HMAC)
    const signature = req.headers['x-eduzz-signature'];
    const payload = JSON.stringify(req.body);
    const expected = crypto
        .createHmac('sha256', process.env.EDUZZ_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

    if (signature !== expected) {
        return res.status(401).json(err('Assinatura inválida.'));
    }

    const { status, customer_email } = req.body;

    try {
        // Buscar usuário pelo e-mail
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const user = users.find(u => u.email === customer_email);

        if (!user) {
            // Criar conta provisória — aluno receberá Magic Link por e-mail
            await supabase.auth.admin.createUser({
                email: customer_email,
                email_confirm: true,
                user_metadata: { source: 'eduzz', is_active: false }
            });
        }

        // Mapear status Eduzz → is_active
        const activeStatuses = ['paid', 'approved', 'active'];
        const isActive = activeStatuses.includes(status?.toLowerCase());

        await supabase
            .from('profiles')
            .upsert({ id: user?.id, is_active: isActive })
            .eq('id', user?.id);

        console.log(`[eduzz] ${customer_email} → is_active: ${isActive}`);
        return res.json(ok({ processed: true }));
    } catch (e) {
        console.error('[webhook/eduzz]', e);
        return res.status(500).json(err('Erro ao processar webhook.'));
    }
});

// ─── Health Check ──────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({ status: 'Aura Master Brain Online', version: '2.0.0', timestamp: new Date() });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🧠 Master Brain Online — Porta ${PORT}`);
});

export default app;
