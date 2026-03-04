// login.js — Autenticação Supabase para o IA Personal Coach

// ─── Configuração Supabase (Frontend usa Publishable Key) ──────────────────
const SUPABASE_URL = 'https://oppuxdchoifqbhcyctzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h8BlFlakeHSoks6e_w46GA_Q7S5KBup';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ─── Redireciona se já estiver logado ──────────────────────────────────────
(async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) window.location.href = '/';
})();

// ─── Utilitários de UI ─────────────────────────────────────────────────────
function setLoading(formId, isLoading) {
    const btn = document.querySelector(`#form-${formId} .aura-btn`);
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    btn.disabled = isLoading;
    text.style.display = isLoading ? 'none' : 'inline';
    loader.style.display = isLoading ? 'inline' : 'none';
}

function showFeedback(msg, type = 'error') {
    const el = document.getElementById('feedback');
    el.textContent = msg;
    el.className = `feedback-msg ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function switchTab(tab) {
    // Esconder todos os forms
    ['login', 'signup', 'forgot'].forEach(t => {
        const f = document.getElementById(`form-${t}`);
        if (f) f.classList.add('hidden');
    });

    // Resetar tabs
    document.getElementById('tab-login')?.classList.remove('active');
    document.getElementById('tab-signup')?.classList.remove('active');

    // Mostrar form ativo
    document.getElementById(`form-${tab}`)?.classList.remove('hidden');
    document.getElementById(`tab-${tab}`)?.classList.add('active');

    // Limpar feedback
    document.getElementById('feedback').style.display = 'none';
}

function togglePass(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁';
    }
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────
async function handleLogin(e) {
    e.preventDefault();
    setLoading('login', true);

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        setLoading('login', false);
        const msg = error.message.includes('Invalid')
            ? 'E-mail ou senha incorretos. Verifique seus dados.'
            : error.message;
        return showFeedback(msg, 'error');
    }

    // Login bem-sucedido → redireciona para o Dashboard
    window.location.href = '/';
}

// ─── CADASTRO ──────────────────────────────────────────────────────────────
async function handleSignup(e) {
    e.preventDefault();
    setLoading('signup', true);

    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    const { error } = await sb.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: name }
        }
    });

    setLoading('signup', false);

    if (error) {
        const msg = error.message.includes('already registered')
            ? 'Este e-mail já está cadastrado. Tente fazer login.'
            : error.message;
        return showFeedback(msg, 'error');
    }

    showFeedback('Conta criada! Verifique seu e-mail para ativar o acesso.', 'success');
}

// ─── ESQUECI SENHA ─────────────────────────────────────────────────────────
async function handleForgot(e) {
    e.preventDefault();
    setLoading('forgot', true);

    const email = document.getElementById('forgot-email').value.trim();

    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`
    });

    setLoading('forgot', false);

    if (error) return showFeedback(error.message, 'error');

    showFeedback('Link enviado! Verifique sua caixa de entrada.', 'success');
}
