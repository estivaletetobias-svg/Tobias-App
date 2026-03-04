// app.js — IA Personal Coach | Lógica Principal
// Conectado ao Backend Vercel + Supabase Auth + OpenAI Assistants

// ─── Configuração Supabase (Frontend) ──────────────────────────────────────
const SUPABASE_URL = 'https://oppuxdchoifqbhcyctzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'COLE_AQUI_SUA_PUBLISHABLE_KEY'; // sb_publishable_...
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

// ─── Onboarding ────────────────────────────────────────────────────────────
let currentStep = 1;
const totalSteps = 5;
const onboardingData = {};

window.nextStep = function () {
    collectStepData(currentStep);
    if (currentStep < totalSteps) {
        document.querySelector(`[data-step="${currentStep}"]`).classList.remove('active');
        currentStep++;
        document.querySelector(`[data-step="${currentStep}"]`).classList.add('active');
    }
};

window.selectOption = function (el, group) {
    document.querySelectorAll(`[onclick*="${group}"]`).forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    onboardingData[group] = el.textContent.trim();
};

function collectStepData(step) {
    if (step === 2) {
        onboardingData.pref_name = document.getElementById('pref-name')?.value;
        onboardingData.age = document.getElementById('age')?.value;
        onboardingData.weight = document.getElementById('weight')?.value;
        onboardingData.injuries = document.getElementById('injuries')?.value;
    }
    if (step === 3) {
        const checked = [...document.querySelectorAll('.check-list input:checked')];
        onboardingData.equipment_tags = checked.map(c => c.parentElement.textContent.trim());
    }
    if (step === 4) {
        onboardingData.incentive_phrase = document.getElementById('incentive')?.value;
    }
}

window.finishOnboarding = async function () {
    collectStepData(currentStep);

    const overlay = document.getElementById('onboarding-overlay');
    overlay.style.opacity = '0.5';

    const result = await apiFetch('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
            pref_name: onboardingData.pref_name || 'Atleta',
            age: parseInt(onboardingData.age) || null,
            weight: parseFloat(onboardingData.weight) || null,
            injuries: onboardingData.injuries || '',
            workout_location: onboardingData.location || 'academia',
            equipment_tags: onboardingData.equipment_tags || [],
            ai_persona_type: onboardingData.persona || 'Direto & Objetivo',
            incentive_phrase: onboardingData.incentive_phrase || '',
        })
    });

    overlay.style.opacity = '1';

    if (result.success) {
        overlay.classList.remove('active');
        await loadTodayWorkout();
        const nameEl = document.querySelector('.user-profile strong');
        if (nameEl) nameEl.textContent = onboardingData.pref_name || 'Atleta';
    } else {
        alert('Erro ao salvar perfil: ' + result.error);
    }
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

    // Mostrar mensagem do usuário
    appendMessage(message, 'user');
    input.value = '';

    // Indicador de typing
    const typingEl = appendMessage('●●●', 'ai typing');

    try {
        // Chamada streaming ao backend
        const response = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ message }),
        });

        typingEl.remove();

        if (!response.ok) {
            const errData = await response.json();
            appendMessage(`Erro: ${errData.error}`, 'ai');
            return;
        }

        // Processar stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const aiEl = appendMessage('', 'ai');
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.text) {
                            fullText += parsed.text;
                            aiEl.textContent = fullText;
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                    } catch { }
                }
            }
        }
    } catch (e) {
        typingEl?.remove();
        appendMessage('Ops! Problema de conexão. Tente novamente.', 'ai');
        console.error('[chat]', e);
    }
}

function appendMessage(text, type) {
    const el = document.createElement('div');
    el.className = `msg ${type}`;
    el.textContent = text;
    chatMessages?.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
}

// ─── Event Listeners ───────────────────────────────────────────────────────
function initEventListeners() {
    // Chat - abrir/fechar
    document.getElementById('ai-trigger')?.addEventListener('click', () => {
        document.getElementById('chat-overlay').style.display = 'block';
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
