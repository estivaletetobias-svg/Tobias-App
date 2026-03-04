// POST /api/webhook/eduzz
// Recebe eventos do MyEduzz Developer Hub e controla acesso dos alunos
import crypto from 'crypto';
import { supabase, ok, err } from '../../_lib/clients.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json(err('Método não permitido.'));

    // ── Validação de Segurança (HMAC) ─────────────────────────────────────────
    const signature = req.headers['x-eduzz-signature'] || req.headers['x-hub-signature-256'];
    if (signature && process.env.EDUZZ_WEBHOOK_SECRET) {
        const payload = JSON.stringify(req.body);
        const expected = 'sha256=' + crypto
            .createHmac('sha256', process.env.EDUZZ_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
        if (signature !== expected) {
            return res.status(401).json(err('Assinatura inválida.'));
        }
    }

    // ── Mapear Eventos Eduzz Developer Hub ────────────────────────────────────
    //  Eventos que ATIVAM o acesso:
    const ACTIVE_EVENTS = [
        'myeduzz.contract_created',   // assinatura criada
        'myeduzz.invoice_paid',       // fatura paga / renovação mensal
        'myeduzz.contract_updated',   // contrato atualizado (reativação pós-suspensão)
        'sale_approved',              // venda aprovada (legado)
    ];

    //  Eventos que BLOQUEIAM o acesso:
    const INACTIVE_EVENTS = [
        'myeduzz.contract_canceled',  // assinatura cancelada
        'myeduzz.invoice_canceled',   // fatura cancelada
        'myeduzz.invoice_refunded',   // reembolso
        'sale_refunded',              // reembolso legado
        'sale_chargeback',            // chargeback
    ];

    const event = req.body?.event || req.body?.type;
    const customerEmail =
        req.body?.data?.customer?.email ||
        req.body?.customer_email ||
        req.body?.data?.subscriber?.email;

    if (!customerEmail) {
        console.warn('[eduzz] E-mail do cliente não encontrado no payload:', req.body);
        return res.status(200).json(ok({ skipped: true, reason: 'email_not_found' }));
    }

    const isActive = ACTIVE_EVENTS.includes(event);
    const isInactive = INACTIVE_EVENTS.includes(event);

    if (!isActive && !isInactive) {
        console.log(`[eduzz] Evento ignorado: ${event}`);
        return res.status(200).json(ok({ skipped: true, event }));
    }

    try {
        // Buscar usuário pelo e-mail no Supabase Auth
        const { data: { users } } = await supabase.auth.admin.listUsers();
        let user = users.find(u => u.email === customerEmail);

        if (!user) {
            // Novo aluno: criar conta automaticamente
            const { data: newUserData, error: createErr } = await supabase.auth.admin.createUser({
                email: customerEmail,
                email_confirm: true,
                user_metadata: { source: 'eduzz' }
            });
            if (createErr) throw createErr;
            user = newUserData.user;
        }

        // Atualizar status de acesso no banco
        await supabase
            .from('profiles')
            .upsert({ id: user.id, is_active: isActive });

        // Enviar Magic Link (não-bloqueante — erro aqui não derruba o webhook)
        if (isActive) {
            try {
                await supabase.auth.admin.generateLink({
                    type: 'magiclink',
                    email: customerEmail,
                });
            } catch (linkErr) {
                // Falha no Magic Link não impede o webhook de responder com sucesso
                console.warn('[eduzz] Magic Link não enviado:', linkErr.message);
            }
        }

        console.log(`[eduzz] ${event} → ${customerEmail} → is_active: ${isActive}`);
        return res.status(200).json(ok({ processed: true, event, is_active: isActive }));

    } catch (e) {
        console.error('[webhook/eduzz] Erro:', e.message);
        return res.status(500).json(err(`Erro ao processar: ${e.message}`));
    }
}
