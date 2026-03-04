// app.js — IA Personal Coach | Lógica Principal
// Conectado ao Backend Vercel + Supabase Auth + OpenAI Assistants

// ─── Configuração Supabase (Frontend) ──────────────────────────────────────
const SUPABASE_URL = 'https://oppuxdchoifqbhcyctzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h8BlFlakeHSoks6e_w46GA_Q7S5KBup';
const API_BASE = ''; // Em produção é relativo ao domínio Vercel

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ─── Estado Global ─────────────────────────────────────────────────────────
let currentUser = null;
let authToken = null;

// ─── Inicialização ─────────────────────────────────────────────────────────
(async () => {
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
        // Não logado → redireciona para Login
        window.location.href = '/login.html';
        return;
    }

    currentUser = session.user;
    authToken = session.access_token;

    // Atualizar nome no header
    const nameEl = document.querySelector('.user-profile strong');
    if (nameEl) nameEl.textContent = currentUser.user_metadata?.full_name?.split(' ')[0] || 'Atleta';

    // Verificar se onboarding foi concluído
    await checkOnboardingStatus();

    // Carregar treino do dia
    await loadTodayWorkout();

    // Montar listeners
    initEventListeners();
})();

// ─── Auth: Verificar Onboarding ────────────────────────────────────────────
async function checkOnboardingStatus() {
    const { data: profile } = await sb
        .from('profiles')
        .select('pref_name, openai_thread_id')
        .eq('id', currentUser.id)
        .single();

    if (!profile?.openai_thread_id) {
        // Onboarding não concluído → mostra overlay
        document.getElementById('onboarding-overlay').classList.add('active');
    } else {
        // Ajustar nome preferido
        const nameEl = document.querySelector('.user-profile strong');
        if (nameEl && profile.pref_name) nameEl.textContent = profile.pref_name;
    }
}

// ─── API Helper ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            ...options.headers,
        },
    });
    return res.json();
}

// ─── Onboarding via IA ────────────────────────────────────────────────────
window.startWithAI = async function () {
    const name = document.getElementById('pref-name')?.value?.trim();
    if (!name) {
        document.getElementById('pref-name').style.borderColor = 'red';
        return;
    }

    const btn = document.getElementById('btn-start-ai');
    if (btn) { btn.disabled = true; btn.textContent = 'Conectando...'; }

    // Salvar nome + criar thread OpenAI
    const result = await apiFetch('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({ pref_name: name })
    });

    if (!result.success) {
        if (btn) { btn.disabled = false; btn.textContent = 'Iniciar com o Coach ✶'; }
        alert('Erro ao conectar com o Coach: ' + result.error);
        return;
    }

    // Fechar onboarding overlay
    document.getElementById('onboarding-overlay').classList.remove('active');

    // Atualizar nome no header
    const nameEl = document.querySelector('.user-profile strong');
    if (nameEl) nameEl.textContent = name;

    // Abrir chat e limpar mensagem genérica
    const chatOverlay = document.getElementById('chat-overlay');
    chatOverlay.style.display = 'block';
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.innerHTML = '';

    // IA inicia o diagnóstico conversacional
    appendMessage(
        `Olá, ${name}! Sou seu Master Coach IA.\n\nA partir de agora, vou criar um programa 100% personalizado pra você. Para isso, quero te conhecer de verdade.\n\nMe conta: qual é o seu principal objetivo hoje? Perder gordura, ganhar massa, melhorar condicionamento… ou tem outro foco?`,
        'ai'
    );
};

// ─── (mantida para compatibilidade — não é mais usada no fluxo principal)
window.finishOnboarding = async function () {
    const pref_name = document.getElementById('pref-name')?.value || 'Atleta';
    await startWithAI();
};


// ─── Treino do Dia ─────────────────────────────────────────────────────────
async function loadTodayWorkout() {
    const result = await apiFetch('/api/workout/today');
    if (!result.success) return;

    const w = result.data;
    const card = document.querySelector('.next-workout');
    if (card) {
        card.querySelector('h2').textContent = w.workout_name || 'Performance & Power';
        card.querySelector('p').textContent = `Foco: ${w.focus || 'Membros superiores'} · ${w.duration_min || 60}min`;
    }

    // Armazenar exercícios para a sessão
    window.todayExercises = w.exercises || [];
    window.currentExIndex = 0;
    updateExerciseDisplay();
}

// ─── Execução de Treino ─────────────────────────────────────────────────────
function updateExerciseDisplay() {
    const exs = window.todayExercises || [];
    if (!exs.length) return;

    const ex = exs[window.currentExIndex];
    const total = exs.length;

    document.querySelector('.exercise-count').textContent = `Exercício ${window.currentExIndex + 1} de ${total}`;
    document.getElementById('ex-name').textContent = ex.name || 'Exercício';
    document.getElementById('ex-desc').textContent = ex.cues || '';

    const stats = document.querySelectorAll('.stat-item .value');
    if (stats[0]) stats[0].textContent = ex.sets || '--';
    if (stats[1]) stats[1].textContent = ex.reps || '--';
    if (stats[2]) stats[2].textContent = ex.rest_sec ? `${ex.rest_sec}s` : '--';
}

// ─── Chat Real com OpenAI ──────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');

async function sendChatMessage() {
    const input = document.querySelector('.chat-input-area input');
    const message = input?.value?.trim();
    if (!message) return;

    appendMessage(message, 'user');
    input.value = '';

    const typingEl = appendMessage('●●●', 'ai typing');

    try {
        const result = await apiFetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify({ message }),
        });

        typingEl.remove();

        if (!result.success) {
            appendMessage(`Erro: ${result.error}`, 'ai');
            return;
        }

        appendMessage(result.data.text, 'ai');
        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (e) {
        typingEl?.remove();
        appendMessage('Ops! Problema de conexão. Tente novamente.', 'ai');
        console.error('[chat]', e);
    }
}

// ─── Carregar Histórico do Chat ───────────────────────────────────────────
async function loadChatHistory() {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    // Limpar mensagem genérica do HTML
    msgs.innerHTML = '<div class="msg ai typing">Carregando histórico...</div>';

    try {
        const result = await apiFetch('/api/chat/history');
        msgs.innerHTML = '';

        if (result.success && result.data.messages.length > 0) {
            for (const m of result.data.messages) {
                const type = m.role === 'assistant' ? 'ai' : 'user';
                appendMessage(m.text, type);
            }
        } else {
            // Primeira vez abrindo o chat — mostrar saudação
            const name = document.querySelector('.user-profile strong')?.textContent || 'Atleta';
            appendMessage(
                `Olá, ${name}! Sou seu Master Coach IA. Como posso te ajudar hoje?`,
                'ai'
            );
        }
    } catch (e) {
        msgs.innerHTML = '';
        appendMessage('Não foi possível carregar o histórico. Pode falar normalmente!', 'ai');
    }
}

function appendMessage(text, type) {
    const el = document.createElement('div');
    el.className = `msg ${type}`;
    if (type === 'ai' && typeof marked !== 'undefined') {
        // Renderiza Markdown nas mensagens da IA
        el.innerHTML = marked.parse(text);
    } else {
        el.textContent = text;
    }
    chatMessages?.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
}

// ─── Event Listeners ───────────────────────────────────────────────────────
function initEventListeners() {
    // Chat - abrir/fechar
    document.getElementById('ai-trigger')?.addEventListener('click', async () => {
        const chatOverlay = document.getElementById('chat-overlay');
        chatOverlay.style.display = 'block';
        await loadChatHistory();
    });
    document.getElementById('close-chat')?.addEventListener('click', () => {
        document.getElementById('chat-overlay').style.display = 'none';
    });

    // Chat - enviar mensagem
    const chatInput = document.querySelector('.chat-input-area input');
    const chatBtn = document.querySelector('.chat-input-area button');

    chatBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Workout - abrir/fechar
    document.querySelector('.next-workout .aura-btn')?.addEventListener('click', () => {
        document.getElementById('workout-overlay').style.display = 'block';
    });
    document.getElementById('close-workout')?.addEventListener('click', () => {
        document.getElementById('workout-overlay').style.display = 'none';
        finishWorkoutSession();
    });

    // Workout - navegação
    document.getElementById('next-ex')?.addEventListener('click', () => {
        const exs = window.todayExercises || [];
        if (window.currentExIndex < exs.length - 1) {
            window.currentExIndex++;
            updateExerciseDisplay();
        }
    });
    document.getElementById('prev-ex')?.addEventListener('click', () => {
        if (window.currentExIndex > 0) {
            window.currentExIndex--;
            updateExerciseDisplay();
        }
    });

    // Timer de descanso
    let timerInterval;
    document.getElementById('start-rest')?.addEventListener('click', () => {
        const ex = (window.todayExercises || [])[window.currentExIndex];
        let timeLeft = ex?.rest_sec || 45;
        const btn = document.getElementById('start-rest');
        const display = document.getElementById('timer');

        btn.disabled = true;
        btn.textContent = 'Descansando...';
        clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            timeLeft--;
            const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
            const s = (timeLeft % 60).toString().padStart(2, '0');
            display.textContent = `${m}:${s}`;

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                display.textContent = '00:00';
                btn.disabled = false;
                btn.textContent = 'Iniciar Descanso';

                // Vibração (mobile)
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            }
        }, 1000);
    });

    // Quick AI do Workout
    document.getElementById('quick-ai-trigger')?.addEventListener('click', () => {
        const ex = (window.todayExercises || [])[window.currentExIndex];
        if (ex) {
            const input = document.querySelector('.chat-input-area input');
            if (input) {
                input.value = `Tenho uma dúvida sobre o exercício ${ex.name}. `;
                input.focus();
            }
        }
        document.getElementById('chat-overlay').style.display = 'block';
    });
}

// ─── Registrar Treino Concluído ─────────────────────────────────────────────
async function finishWorkoutSession() {
    const ex = window.todayExercises?.[0];
    if (!ex) return;

    await apiFetch('/api/workout/log', {
        method: 'POST',
        body: JSON.stringify({
            workout_name: document.querySelector('.next-workout h2')?.textContent,
            perceived_effort: 7
        })
    });

    // Recarregar Score atualizado
    const { data: profile } = await sb
        .from('profiles')
        .select('discipline_score')
        .eq('id', currentUser.id)
        .single();

    if (profile?.discipline_score != null) {
        const scoreEl = document.querySelector('.percentage');
        const circleEl = document.querySelector('.circle');
        if (scoreEl) scoreEl.textContent = profile.discipline_score;
        if (circleEl) circleEl.setAttribute('stroke-dasharray', `${profile.discipline_score}, 100`);
    }
}

// ─── Logout (disponível globalmente) ──────────────────────────────────────
window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '/login.html';
};
