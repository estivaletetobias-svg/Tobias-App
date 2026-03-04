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

// ─── Onboarding: primeiro acesso sem perfil ────────────────────────────────
window.startWithAI = async function () {
    const btn = document.getElementById('btn-start-ai');
    if (btn) { btn.disabled = true; btn.textContent = 'Conectando...'; }

    // Usar nome do login — sem perguntar de novo
    const name = currentUser.user_metadata?.full_name?.split(' ')[0]
        || currentUser.email?.split('@')[0]
        || 'Atleta';

    // Criar thread OpenAI e salvar perfil
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

    // Abrir chat com greeting real da IA
    document.getElementById('chat-overlay').style.display = 'block';
    await loadChatHistory();
};


// ─── Treino do Dia ─────────────────────────────────────────────────────────
async function loadTodayWorkout() {
    const result = await apiFetch('/api/workout');
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
    const skippedIndexes = window.skippedIndexes || [];

    // Indicador de exercício atual (com badge se pulado)
    const isSkipped = skippedIndexes.includes(window.currentExIndex);
    document.querySelector('.exercise-count').textContent =
        `Exercício ${window.currentExIndex + 1} de ${total}${isSkipped ? ' ⏩ pulado' : ''}`;
    document.getElementById('ex-name').textContent = ex.name || 'Exercício';
    document.getElementById('ex-desc').textContent = ex.cues || '';

    const stats = document.querySelectorAll('.stat-item .value');
    if (stats[0]) stats[0].textContent = ex.sets || '--';
    if (stats[1]) stats[1].textContent = ex.reps || '--';
    if (stats[2]) stats[2].textContent = ex.rest_sec ? `${ex.rest_sec}s` : '--';

    // Preview do próximo exercício (discreet strip)
    const nextEx = exs[window.currentExIndex + 1];
    const preview = document.getElementById('next-ex-preview');
    if (nextEx && preview) {
        preview.style.display = 'block';
        document.getElementById('next-ex-name').textContent = nextEx.name || '';
        document.getElementById('next-ex-info').textContent =
            nextEx.sets && nextEx.reps ? `${nextEx.sets}×${nextEx.reps}` : '';
    } else if (preview) {
        // Último exercício
        preview.style.display = skippedIndexes.length > 0 ? 'none' : 'none';
    }

    // Banner de pulados
    const banner = document.getElementById('skipped-banner');
    const skippedCount = document.getElementById('skipped-count');
    if (banner) {
        const realSkipped = skippedIndexes.filter(i => i !== window.currentExIndex).length;
        if (realSkipped > 0) {
            banner.style.display = 'block';
            skippedCount.textContent = realSkipped;
        } else {
            banner.style.display = 'none';
        }
    }

    // Botoão Próximo vs Concluir
    const nextBtn = document.getElementById('next-ex');
    if (nextBtn) {
        const allDone = exs.every((_, i) => !skippedIndexes.includes(i) || i === window.currentExIndex);
        const isLast = window.currentExIndex === total - 1;
        if (isLast && skippedIndexes.filter(i => i !== window.currentExIndex).length === 0) {
            nextBtn.textContent = 'Concluir Treino ✓';
        } else {
            nextBtn.textContent = 'Próximo ✔';
        }
    }

    // ― 5: Link YouTube para o exercício atual
    const videoEl = document.querySelector('.video-placeholder');
    if (videoEl && ex.name) {
        const ytQuery = encodeURIComponent(`${ex.name} execução técnica`);
        const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;
        videoEl.innerHTML = `
            <a href="${ytUrl}" target="_blank" rel="noopener"
               style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:inherit;text-decoration:none;gap:12px">
                <span style="font-size:42px">🎬</span>
                <span style="font-size:13px;opacity:.7">Ver execução no YouTube</span>
                <span style="font-size:11px;opacity:.5;max-width:180px;text-align:center">${ex.name}</span>
            </a>`;
    }

    // Reset timer display ao navegar
    const display = document.getElementById('timer');
    if (display) {
        const restSec = ex.rest_sec || 60;
        const m = Math.floor(restSec / 60).toString().padStart(2, '0');
        const s = (restSec % 60).toString().padStart(2, '0');
        display.textContent = `${m}:${s}`;
        display.style.color = '';
    }
    const restBtn = document.getElementById('start-rest');
    if (restBtn) { restBtn.disabled = false; restBtn.textContent = 'Iniciar Descanso'; }
}

// ─── Chat Real com OpenAI ──────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');

// ― Detectar se a IA entregou um treino na mensagem
function detectWorkoutInMessage(text) {
    // Detecta qualquer mensagem com treino — formato da IA usa Descanso:, 3x10, séries, etc.
    const lower = text.toLowerCase();
    const patterns = [
        /descanso/i,           // "Descanso: 90s"
        /\d+x\d+/,             // "3x10", "4x12"
        /séries?/i,            // "4 séries"
        /repetições?/i,        // "10 repetições"
        /\breps?\b/i,           // "10 reps"
        /\bsets?\b/i,           // "4 sets"
        /execução/i,           // "técnica de execução"
        /exercício\s+\d/i,     // "Exercício 1:"
        /\d+\s*min.*descanso/i, // "2 min de descanso"
        /supino|agachamento|remada|rosca|press|pull|push|levantamento|desenvolvimento/i
    ];
    const matched = patterns.filter(p => p.test(text)).length;
    return matched >= 2;
}

// ― Injetar botão "Iniciar Sessão" após mensagem de treino
function injectStartSessionButton(msgEl) {
    if (msgEl.querySelector('.start-session-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'start-session-btn';
    btn.innerHTML = '▶ Iniciar Sessão de Treino';
    btn.style.cssText = 'display:block;width:100%;margin-top:14px;padding:12px 16px;background:linear-gradient(135deg,#7c6aff,#4fc8ff);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:Outfit,sans-serif;letter-spacing:.5px;transition:opacity .2s';
    btn.onmouseenter = () => btn.style.opacity = '.85';
    btn.onmouseleave = () => btn.style.opacity = '1';
    btn.addEventListener('click', async () => {
        btn.textContent = 'Carregando treino...';
        btn.disabled = true;
        // Carregar treino estruturado da API (gera JSON com exercícios)
        const result = await apiFetch('/api/workout');
        if (result.success && result.data.exercises?.length) {
            window.todayExercises = result.data.exercises;
            window.currentExIndex = 0;
            // Atualizar card de treino do dashboard
            const h2 = document.querySelector('.next-workout h2');
            const tag = document.querySelector('.next-workout .tag');
            if (h2) h2.textContent = result.data.workout_name || 'Treino do Dia';
            if (tag) tag.textContent = `${result.data.duration_min || 60}min`;
            // Fechar chat, abrir sessão
            document.getElementById('chat-overlay').style.display = 'none';
            document.getElementById('workout-overlay').style.display = 'block';
            updateExerciseDisplay();
        } else {
            btn.textContent = '▶ Iniciar Sessão de Treino';
            btn.disabled = false;
        }
    });
    msgEl.appendChild(btn);
}

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

        const msgEl = appendMessage(result.data.text, 'ai');
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // ― 3: Detectar treino e mostrar botão de sessão
        if (detectWorkoutInMessage(result.data.text)) {
            injectStartSessionButton(msgEl);
        }

    } catch (e) {
        typingEl?.remove();
        appendMessage('Ops! Problema de conexão. Tente novamente.', 'ai');
        console.error('[chat]', e);
    }
}

async function loadChatHistory() {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    msgs.innerHTML = '<div class="msg ai typing">...</div>';

    try {
        const result = await apiFetch('/api/chat');
        msgs.innerHTML = '';

        if (result.success && result.data.messages.length > 0) {
            // Usuário recorrente: mostrar as últimas mensagens reais
            // Filtrar __init__ e respostas de diagnóstico inicial
            const allMessages = result.data.messages.filter(m => {
                if (m.role === 'user' && m.text.trim() === '__init__') return false;
                if (m.role === 'assistant' && /seção 1|diagnóstico para que|vamos começar com o diagnóstico/i.test(m.text)) return false;
                return true;
            });
            const recent = allMessages.slice(-8);
            for (const m of recent) {
                const type = m.role === 'assistant' ? 'ai' : 'user';
                appendMessage(m.text, type);
            }
            if (recent.length === 0) {
                appendMessage(`Olá, ${document.querySelector('.user-profile strong')?.textContent || 'Tobias'}! Pode falar — estou aqui.`, 'ai');
            }

        } else {
            // Primeiro acesso: IA inicia o diagnóstico
            const typing = appendMessage('●●●', 'ai typing');
            const greeting = await apiFetch('/api/chat', {
                method: 'POST',
                body: JSON.stringify({ message: '__init__' }),
            });
            typing.remove();
            if (greeting.success) {
                appendMessage(greeting.data.text, 'ai');
            } else {
                appendMessage('Olá! Pronto para começar? Me conta um pouco sobre você.', 'ai');
            }
        }
    } catch (e) {
        msgs.innerHTML = '';
        appendMessage('Pronto! Pode falar.', 'ai');
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

    // Workout - abrir (via dashboard card — carrega exercícios da API)
    document.querySelector('.next-workout .aura-btn')?.addEventListener('click', async () => {
        const overlay = document.getElementById('workout-overlay');
        overlay.style.display = 'block';
        window.skippedIndexes = [];
        // Se já tem exercícios carregados, só abre
        if (window.todayExercises?.length) {
            window.currentExIndex = 0;
            updateExerciseDisplay();
            return;
        }
        // Senão, carregar da API
        const result = await apiFetch('/api/workout');
        if (result.success && result.data.exercises?.length) {
            window.todayExercises = result.data.exercises;
            window.currentExIndex = 0;
            const h2 = document.querySelector('.next-workout h2');
            const tag = document.querySelector('.next-workout .tag');
            if (h2) h2.textContent = result.data.workout_name || 'Treino do Dia';
            if (tag) tag.textContent = `${result.data.duration_min || 60}min`;
            updateExerciseDisplay();
        }
    });
    document.getElementById('close-workout')?.addEventListener('click', () => {
        document.getElementById('workout-overlay').style.display = 'none';
        finishWorkoutSession();
    });

    // Workout ― navegação e pular
    document.getElementById('next-ex')?.addEventListener('click', () => {
        const exs = window.todayExercises || [];
        const skipped = window.skippedIndexes || [];
        const isLast = window.currentExIndex === exs.length - 1;
        const hasRemainingSkipped = skipped.filter(i => i !== window.currentExIndex).length > 0;

        if (isLast && !hasRemainingSkipped) {
            // Concluir treino
            document.getElementById('workout-overlay').style.display = 'none';
            finishWorkoutSession();
            return;
        }
        if (window.currentExIndex < exs.length - 1) {
            // Remover do skipped se estava pulado e agora foi feito
            window.skippedIndexes = skipped.filter(i => i !== window.currentExIndex);
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
    document.getElementById('skip-ex')?.addEventListener('click', () => {
        const exs = window.todayExercises || [];
        if (!window.skippedIndexes) window.skippedIndexes = [];
        // Marcar como pulado
        if (!window.skippedIndexes.includes(window.currentExIndex)) {
            window.skippedIndexes.push(window.currentExIndex);
        }
        // Avançar para o próximo
        if (window.currentExIndex < exs.length - 1) {
            window.currentExIndex++;
        } else {
            // Já no último — ir para o primeiro pulado
            window.currentExIndex = window.skippedIndexes[0];
        }
        updateExerciseDisplay();
    });

    // Timer de descanso ― 2: cores de alerta
    let timerInterval;
    document.getElementById('start-rest')?.addEventListener('click', () => {
        const ex = (window.todayExercises || [])[window.currentExIndex];
        let timeLeft = ex?.rest_sec || 60;
        const btn = document.getElementById('start-rest');
        const display = document.getElementById('timer');

        btn.disabled = true;
        btn.textContent = 'Descansando...';
        display.style.color = '';
        clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            timeLeft--;
            const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
            const s = (timeLeft % 60).toString().padStart(2, '0');
            display.textContent = `${m}:${s}`;

            // Cores de alerta
            if (timeLeft <= 0) {
                display.style.color = '#ef4444'; // vermelho
            } else if (timeLeft <= 10) {
                display.style.color = '#f59e0b'; // laranja
            } else {
                display.style.color = '';
            }

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                display.textContent = 'VÁ!';
                btn.disabled = false;
                btn.textContent = 'Iniciar Descanso';
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                setTimeout(() => {
                    if (display.textContent === 'VÁ!') {
                        display.style.color = '';
                        const restSec = ex?.rest_sec || 60;
                        display.textContent = `${Math.floor(restSec / 60).toString().padStart(2, '0')}:${(restSec % 60).toString().padStart(2, '0')}`;
                    }
                }, 2000);
            }
        }, 1000);
    });

    // Quick AI do Workout ― 4: abre chat com contexto do exercício atual
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
// Ir para o primeiro exercício pulado
window.goToSkipped = function () {
    const skipped = window.skippedIndexes || [];
    if (skipped.length > 0) {
        window.currentExIndex = skipped[0];
        updateExerciseDisplay();
    }
};

async function finishWorkoutSession() {
    const ex = window.todayExercises?.[0];
    if (!ex) return;

    await apiFetch('/api/workout', {
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
