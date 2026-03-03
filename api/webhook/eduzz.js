// POST /api/webhook/eduzz
// Controle de acesso via pagamento — ativa ou bloqueia alunos automaticamente
import crypto from 'crypto';
import { supabase, ok, err } from '../../_lib/clients.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json(err('Método não permitido.'));

    // Validação HMAC de segurança
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
        const { data: { users } } = await supabase.auth.admin.listUsers();
        let user = users.find(u => u.email === customer_email);

        // Se aluno ainda não existe, criar conta e enviar Magic Link
        if (!user) {
            const { data: newUser } = await supabase.auth.admin.createUser({
                email: customer_email,
                email_confirm: true,
            });
            user = newUser.user;
        }

        const activeStatuses = ['paid', 'approved', 'active'];
        const isActive = activeStatuses.includes(status?.toLowerCase());

        await supabase
            .from('profiles')
            .upsert({ id: user.id, is_active: isActive });

        if (isActive && user) {
            // Enviar Magic Link por e-mail para o novo aluno
            await supabase.auth.admin.generateLink({
                type: 'magiclink',
                email: customer_email,
            });
        }

        console.log(`[eduzz] ${customer_email} → is_active: ${isActive}`);
        return res.status(200).json(ok({ processed: true, is_active: isActive }));
    } catch (e) {
        console.error('[webhook/eduzz]', e);
        return res.status(500).json(err('Erro ao processar webhook.'));
    }
}
