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
    try { await checkOnboardingStatus(); } catch (e) { console.error('Onboarding check failed:', e); }

    // Carregar treino do dia
    try { await loadTodayWorkout(); } catch (e) { console.error('Workout load failed:', e); }

    // Inicializar Dashboard (Animações e Score)
    try { await initDashboard(); } catch (e) { console.error('Dashboard init failed:', e); }

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
    const { data: { session } } = await sb.auth.getSession();
    const currentToken = session ? session.access_token : authToken;

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
            ...options.headers,
        },
    });

    // Tratamento robusto para não quebrar JSON em caso de erro no servidor (500 HTML)
    const text = await res.text();
    try {
        const data = JSON.parse(text);
        if (!res.ok) throw new Error(data.error || 'Erro na API');
        return data;
    } catch (e) {
        throw new Error(e.message.includes('Erro na API') ? e.message : 'Falha na conexão com o servidor');
    }
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
async function loadTodayWorkout(hasCompletedToday = false) {
    const result = await apiFetch('/api/workout/today').catch(() => ({ success: false }));
    const titleEl = document.getElementById('workout-title');
    const startBtn = document.getElementById('start-session-btn');

    if (hasCompletedToday) {
        if (titleEl) titleEl.textContent = 'Sessão Cumprida ✅';
        if (startBtn) {
            startBtn.innerHTML = 'Treino Concluído <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            startBtn.classList.add('secondary');
            startBtn.disabled = true;
            startBtn.style.opacity = '0.6';
        }
        return;
    }

    if (!result || !result.success) return;

    const w = result.data;
    if (titleEl) titleEl.textContent = w.workout_name || 'Performance & Power';
    const durationEl = document.getElementById('workout-duration');
    if (durationEl) durationEl.textContent = `${w.duration_min || 60}min`;

    // Armazenar exercícios para a sessão
    window.todayExercises = w.exercises || [];
    window.currentExIndex = 0;
    window.currentSetIndex = 1;
    updateExerciseDisplay();
}

// ─── Execução de Treino ─────────────────────────────────────────────────────
async function updateExerciseDisplay() {
    const container = document.querySelector('.workout-container');
    const exs = window.todayExercises || [];
    if (!exs.length) return;

    // Efeito de Transição Suave
    if (container) {
        container.style.opacity = '0';
        container.style.transform = 'translateX(10px)';
        await new Promise(r => setTimeout(r, 200));
        if (!exs || exs.length === 0) {
            // Se a lista estiver vazia (API falhou e não tem fallback), fechar modal
            if (container) container.closest('.workout-overlay').style.display = 'none';
            return;
        }

        const ex = exs[window.currentExIndex];
        const total = exs.length;
        const skippedIndexes = window.skippedIndexes || [];

        // Indicador de exercício atual (com badge se pulado)
        const isSkipped = skippedIndexes.includes(window.currentExIndex);
        document.querySelector('.exercise-count').textContent =
            `Exercício ${window.currentExIndex + 1} de ${total}${isSkipped ? ' ⏩ pulado' : ''}`;

        document.getElementById('ex-name').textContent = ex.name || 'Exercício';
        document.getElementById('ex-desc').textContent = ex.cues || '';

        // Stats Detalhados (Editáveis) - Mostra qual série estou fazendo
        document.getElementById('stat-sets').textContent = `${window.currentSetIndex || 1}/${ex.sets || '3'}`;
        document.getElementById('stat-reps').textContent = ex.reps || '10-12';
        document.getElementById('stat-weight').textContent = ex.weight || '0kg';
        document.getElementById('stat-rest').textContent = ex.rest_sec ? `${ex.rest_sec}s` : '60s';

        // Preview do próximo
        const nextEx = exs[window.currentExIndex + 1];
        const preview = document.getElementById('next-ex-preview');
        if (nextEx) {
            document.getElementById('next-ex-name').textContent = nextEx.name;
            document.getElementById('next-ex-info').textContent = `${nextEx.sets}x${nextEx.reps}`;
            if (preview) preview.style.display = 'block';
        } else {
            if (preview) preview.style.display = 'none';
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
            const totalSets = parseInt(ex.sets) || 1;
            const currentSet = window.currentSetIndex || 1;

            const isLastEx = window.currentExIndex === total - 1;
            const noSkippedLeft = skippedIndexes.filter(i => i !== window.currentExIndex).length === 0;

            if (currentSet < totalSets) {
                // Modificado para continuar na mesma série e mostrar o check
                nextBtn.innerHTML = `Set ${currentSet}/${totalSets} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:bottom;margin-left:4px"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                nextBtn.classList.add('accent-mode'); // Estilo especial para set
            } else if (isLastEx && noSkippedLeft) {
                nextBtn.innerHTML = 'Concluir Treino <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:bottom;margin-left:4px"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                nextBtn.classList.remove('accent-mode');
            } else {
                nextBtn.innerHTML = 'Próximo <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:bottom;margin-left:4px"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                nextBtn.classList.remove('accent-mode');
            }
        }

        // Guardar nome do exercício para o drawer de vídeo
        window.currentExName = ex.name || '';

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

        // Restaura a visibilidade suavemente (resolve o bug da tela branca)
        if (container) {
            container.style.opacity = '1';
            container.style.transform = 'translateX(0)';
        }
    }
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

// ― Extrair exercícios do texto da IA (para a tela de sessão usar o mesmo treino)
function parseWorkoutFromAIText(text) {
    const exercises = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nameMatch = line.match(/\*\*([^*]{3,40})\*\*/);
        if (!nameMatch) continue;
        const name = nameMatch[1].trim();
        // Ignorar cabeçalhos de seção, emojis de categoria e avisos
        if (/aquecimento|finaliza|visao|seção|semana|dia|treino|importante|dica/i.test(name)) continue;
        if (name.includes('🔷') || name.includes('✨')) continue;
        const combined = line + ' ' + (lines[i + 1] || '');
        const srMatch = combined.match(/(\d+)\s*[xX×]\s*(\d+(?:-\d+)?)/);
        const restMatch = combined.match(/[Dd]escanso[:\s]+(\d+)\s*(min|m|seg|s)?/i);
        let parsedRest = 60;
        if (restMatch) {
            parsedRest = parseInt(restMatch[1]);
            // If the user specified minutes explicitly, or implicitly (like 1, 2, 3 instead of 60, 90)
            if ((restMatch[2] && restMatch[2].toLowerCase().startsWith('m')) || parsedRest < 10) {
                parsedRest *= 60;
            }
        }
        const parts = combined.split('|');
        const cue = parts.length > 2 ? parts[parts.length - 1].replace(/[*_`]/g, '').trim() : '';
        exercises.push({
            name,
            sets: srMatch ? parseInt(srMatch[1]) : 3,
            reps: srMatch ? srMatch[2] : '10-12',
            rest_sec: parsedRest,
            cues: cue
        });
    }
    return exercises.length >= 2 ? exercises : null;
}

// ― Injetar botão "Iniciar Sessão" após mensagem de treino
function injectStartSessionButton(msgEl) {
    if (msgEl.querySelector('.start-session-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'start-session-btn';
    btn.innerHTML = '▶ Iniciar Sessão de Treino';
    btn.style.cssText = 'display:block;width:100%;margin-top:14px;padding:12px 16px;background:linear-gradient(135deg,#7c6aff,#4fc8ff);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:Outfit,sans-serif;letter-spacing:.5px;transition:opacity .2s;pointer-events:all;position:relative;z-index:10';
    btn.onmouseenter = () => btn.style.opacity = '.85';
    btn.onmouseleave = () => btn.style.opacity = '1';
    btn.addEventListener('click', async () => {
        btn.textContent = '⏳ Carregando treino...';
        btn.disabled = true;
        try {
            // Primeiro: parsear o treino do texto RAW da mensagem (antes do markdown)
            const rawText = btn.closest('.msg')?.dataset.rawText || '';
            const parsed = rawText ? parseWorkoutFromAIText(rawText) : null;

            if (parsed && parsed.length >= 2) {
                // Usar exercícios diretamente do chat (same as IA prescribed)
                window.todayExercises = parsed;
            } else {
                // Fallback: gerar novo treino via API
                const result = await apiFetch('/api/workout/today').catch(() => ({ success: false }));
                if (!result.success || !result.data.exercises?.length) throw new Error(result.error || 'sem dados');
                window.todayExercises = result.data.exercises;
            }

            window.currentExIndex = 0;
            window.skippedIndexes = [];
            const h2 = document.querySelector('.next-workout h2');
            if (h2) h2.textContent = window.todayExercises[0]?.name ? 'Treino do Dia' : 'Treino';
            document.getElementById('chat-overlay').style.display = 'none';
            document.getElementById('workout-overlay').style.display = 'block';
            updateExerciseDisplay();
        } catch (e) {
            btn.textContent = `⚠️ ${e.message || 'Erro — tente novamente'}`;
            btn.disabled = false;
            console.error('[workout]', e);
        }
    });
    msgEl.appendChild(btn);
}

// ─── Type Effect (Luxury Feel) ───────────────────────────────────────────
async function typeEffect(element, html) {
    element.innerHTML = '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = marked.parse(html);
    const nodes = Array.from(tempDiv.childNodes);

    for (const node of nodes) {
        const span = document.createElement('span');
        span.style.opacity = '0';
        span.style.transition = 'opacity 0.5s ease';
        element.appendChild(span);

        if (node.nodeType === Node.TEXT_NODE) {
            const words = node.textContent.split(' ');
            for (const word of words) {
                const wordNode = document.createTextNode(word + ' ');
                span.appendChild(wordNode);
                span.style.opacity = '1';
                await new Promise(r => setTimeout(r, 40));
                autoScrollChat(element);
            }
        } else {
            span.appendChild(node.cloneNode(true));
            span.style.opacity = '1';
            await new Promise(r => setTimeout(r, 100));
            autoScrollChat(element);
        }
    }
}

function autoScrollChat(element) {
    const container = element.closest('.chat-content') || element;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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

        const msgEl = appendMessage('', 'ai shimmer'); // Add shimmer class
        msgEl.dataset.rawText = result.data.text; // Store raw text for parsing
        await typeEffect(msgEl, result.data.text);
        msgEl.classList.remove('shimmer'); // Remove shimmer after typing effect
        autoScrollChat(chatMessages);

        // ― 3: Detectar treino e mostrar botão de sessão
        if (detectWorkoutInMessage(result.data.text)) {
            // Guardar texto RAW antes do markdown ser renderizado, para o parser funcionar
            msgEl.dataset.rawText = result.data.text;
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
    document.getElementById('start-session-btn')?.addEventListener('click', async () => {
        const overlay = document.getElementById('workout-overlay');
        overlay.style.display = 'block';
        window.skippedIndexes = [];

        // Se já tem exercícios carregados, só abre
        if (window.todayExercises && window.todayExercises.length > 0) {
            window.currentExIndex = 0;
            updateExerciseDisplay();
            return;
        }

        // Senão, carregar da API
        const btn = document.getElementById('start-session-btn');
        const oldText = btn.textContent;
        btn.textContent = 'Carregando...';

        const result = await apiFetch('/api/workout/today').catch(() => ({ success: false }));

        btn.textContent = oldText; // Restore

        if (result && result.success && result.data && result.data.exercises?.length > 0) {
            window.todayExercises = result.data.exercises;
            const h2 = document.querySelector('.next-workout h2');
            const tag = document.querySelector('.next-workout .tag');
            if (h2) h2.textContent = result.data.workout_name || 'Treino do Dia';
            if (tag) tag.textContent = `${result.data.duration_min || 60}min`;
        } else {
            // Em caso de falha completa da IA ou banco vazio, injetar um treino de fallback para não quebrar a UI
            window.todayExercises = [
                { name: "Aquecimento Geral", sets: 1, reps: "5-10 min", cues: "Prepare o corpo. Este é um treino de fallback de segurança.", weight: "0kg", rest_sec: 0 }
            ];
        }

        window.currentExIndex = 0;
        updateExerciseDisplay();
    });
    document.getElementById('close-workout')?.addEventListener('click', () => {
        // Sair sem registrar (botao Concluir e quem registra)
        document.getElementById('workout-overlay').style.display = 'none';
    });

    // Workout ― navegação e pular
    document.getElementById('next-ex')?.addEventListener('click', () => {
        const exs = window.todayExercises || [];
        if (!exs.length) return;

        const currentEx = exs[window.currentExIndex];
        const totalSets = parseInt(currentEx.sets) || 1;

        // Se ainda tem séries no exercício atual, apenas avançar a série
        if ((window.currentSetIndex || 1) < totalSets) {
            window.currentSetIndex++;
            updateExerciseDisplay();
            return;
        }

        const skipped = window.skippedIndexes || [];
        const isLastEx = window.currentExIndex === exs.length - 1;
        const hasRemainingSkipped = skipped.filter(i => i !== window.currentExIndex).length > 0;

        if (isLastEx && !hasRemainingSkipped) {
            // Concluir treino
            document.getElementById('workout-overlay').style.display = 'none';
            finishWorkoutSession();
            return;
        }

        // Remover do skipped se estava pulado e agora foi feito
        window.skippedIndexes = skipped.filter(i => i !== window.currentExIndex);

        if (window.currentExIndex < exs.length - 1) {
            window.currentExIndex++;
            window.currentSetIndex = 1;
            updateExerciseDisplay();
        } else if (hasRemainingSkipped) {
            // Volta para o primeiro exercício que foi pulado
            window.currentExIndex = window.skippedIndexes[0];
            window.currentSetIndex = 1;
            updateExerciseDisplay();
        }
    });

    document.getElementById('prev-ex')?.addEventListener('click', () => {
        if (window.currentExIndex > 0) {
            window.currentExIndex--;
            window.currentSetIndex = 1;
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
        window.currentSetIndex = 1;
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


    // Ajuste dinâmico do tempo de descanso se o usuário digitar no #stat-rest
    document.getElementById('stat-rest')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.textContent);
        if (!isNaN(val) && window.todayExercises) {
            window.todayExercises[window.currentExIndex].rest_sec = val;
            const display = document.getElementById('timer');
            const restBtn = document.getElementById('start-rest');
            // Só atualiza o contador se o timer não estiver rodando
            if (display && restBtn && restBtn.textContent !== 'Descansando...') {
                const m = Math.floor(val / 60).toString().padStart(2, '0');
                const s = (val % 60).toString().padStart(2, '0');
                display.textContent = `${m}:${s}`;
            }
        }
    });

    // Quick AI do Workout — abre o mini drawer da IA sem conflitos
    document.getElementById('quick-ai-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.openMiniAI) window.openMiniAI();
    });
}

// ─── Drawer Management ───────────────────────────────────────────────────
function toggleBodyScroll(lock) {
    document.body.style.overflow = lock ? 'hidden' : '';
}

// Global Dialog Listeners
document.querySelectorAll('dialog').forEach(d => {
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.onclose = () => toggleBodyScroll(false);
});

// ─── YouTube Drawer ────────────────────────────────────────────────────────
window.openVideoDrawer = function () {
    const name = window.currentExName || 'exercício';
    const query = encodeURIComponent(`${name} execução técnica`);
    const ytUrl = `https://www.youtube.com/results?search_query=${query}`;
    const dialog = document.getElementById('yt-dialog');
    const nameEl = document.getElementById('yt-exercise-name');
    const link = document.getElementById('yt-link');
    if (nameEl) nameEl.textContent = name;
    if (link) link.href = ytUrl;
    if (dialog) {
        dialog.showModal();
        toggleBodyScroll(true);
    }
};

// ─── Mini-IA Dialog (nativo) ──────────────────────────────────────────────────
window.openMiniAI = function () {
    const dialog = document.getElementById('mini-ai-dialog');
    const input = document.getElementById('mini-ai-input');
    const response = document.getElementById('mini-ai-response');
    if (dialog) {
        const ex = (window.todayExercises || [])[window.currentExIndex];
        if (input) input.value = ex ? `Dúvida sobre ${ex.name}: ` : '';
        if (response) { response.textContent = ''; response.style.display = 'none'; }
        dialog.showModal();
        toggleBodyScroll(true);
        setTimeout(() => input?.focus(), 150);
    }
};

// Alias para compatibilidade
window.toggleMiniAI = window.openMiniAI;

window.sendMiniAI = async function () {
    const input = document.getElementById('mini-ai-input');
    const responseEl = document.getElementById('mini-ai-response');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    responseEl.style.display = 'block';
    responseEl.innerHTML = '<div class="shimmer" style="height:20px; width:150px; border-radius:10px; margin: 10px 0;"></div>';

    try {
        const res = await apiFetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify({ message: text })
        });

        if (res.success) {
            // Efeito gradual de surgimento
            await typeEffect(responseEl, res.data.text.substring(0, 500));
        } else {
            responseEl.textContent = 'Erro ao conectar com o Coach.';
        }
    } catch (e) {
        responseEl.textContent = 'Erro de rede. Tente novamente.';
    }
};

// ─── Registrar Treino Concluído ─────────────────────────────────────────────
// Ir para o primeiro exercício pulado
window.goToSkipped = function () {
    const skippedIndexes = window.skippedIndexes || [];
    if (skippedIndexes.length > 0) {
        window.currentExIndex = skippedIndexes[0];
        window.currentSetIndex = 1;
        updateExerciseDisplay();
    }
};

async function finishWorkoutSession() {
    const workoutName = document.querySelector('.next-workout h2')?.textContent || 'Treino do Dia';

    // Montar resumo completo para a IA
    const exercises = window.todayExercises || [];
    const exercisesSummary = exercises.length
        ? exercises.map(e => `${e.name} ${e.sets}x${e.reps}`).join(' | ')
        : '';

    // 1. Mostrar modal IMEDIATAMENTE
    document.getElementById('workout-overlay').style.display = 'none';
    const modal = document.getElementById('workout-complete-modal');
    const msgEl = document.getElementById('complete-msg');
    const scoreDisplay = document.getElementById('complete-score');
    if (modal) modal.style.display = 'flex';
    if (msgEl) msgEl.textContent = 'Registrando seu treino...';
    if (scoreDisplay) scoreDisplay.textContent = '';

    // 2. Registrar no banco com todos os dados
    try {
        const result = await apiFetch('/api/workout/log', {
            method: 'POST',
            body: JSON.stringify({
                workout_name: workoutName,
                exercises_summary: exercisesSummary,
                perceived_effort: 7
            })
        });
        if (result && result.success) {
            const newScore = result.data?.discipline_score;
            if (msgEl) msgEl.textContent = '🔥 Excelente foco! Missão Cumprida.';
            if (scoreDisplay) scoreDisplay.textContent = newScore || '--';

            // 3. Atualizar Dashboard Global (Forçar Refresh dos dados)
            await initDashboard();
        } else {
            throw new Error(result?.error || 'Erro inesperado da API.');
        }
    } catch (e) {
        if (msgEl) msgEl.textContent = `Erro: ${e.message}`;
        console.error('[finishWorkoutSession]', e);
    }
    window.skippedIndexes = [];
}

function animateValue(selector, start, end, duration) {
    const obj = document.querySelector(selector);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

window.dismissWorkout = function () {
    if (confirm('Deseja encerrar o treino sem salvar?')) {
        document.getElementById('workout-overlay').style.display = 'none';
    }
};

// ─── Dashboard Management (Global Lifecycle) ───────────────────────────────
async function initDashboard() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // 1. Carregar perfil para pegar o score real
    const profileResponse = await apiFetch(`/api/profile?email=${user.email}`).catch(() => null);

    // 2. Animação de Emergência (Sequential Fade In)
    const cards = document.querySelectorAll('.app-container > .glass-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(24px)';
        setTimeout(() => {
            card.style.transition = 'all 0.8s cubic-bezier(0.23, 1, 0.32, 1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 * index);
    });

    if (profileResponse && profileResponse.success) {
        const data = profileResponse.data;
        const score = data.discipline_score || 0;

        // Atualizar Status Bar
        document.getElementById('stat-energy').textContent = data.daily_energy || 'Alta';
        document.getElementById('stat-sleep').textContent = data.daily_sleep || '7.5h';

        // Verifica se completou treino hoje para avisar app
        if (data.workout_completed_today) {
            loadTodayWorkout(true);
        }
        document.getElementById('stat-stress').textContent = data.daily_focus || 'Focado';

        // Atualizar Score
        animateValue('.percentage', 0, score, 2000);
        const circle = document.getElementById('discipline-circle');
        if (circle) {
            setTimeout(() => {
                circle.style.strokeDasharray = `${score}, 100`;
            }, 600);
        }

        // Renderizar Consistência Semanal
        renderWeeklyConsistency(3); // Mock: 3 treinos concluídos
    }

    // Atualizar Preview de Treino no Dashboard
    const workout = await apiFetch('/api/workout/today');
    if (workout.success) {
        const w = workout.data;
        document.getElementById('workout-title').textContent = w.workout_name || 'Performance';
        document.getElementById('workout-duration').textContent = `${w.duration_min || 45}min`;

        const focusArea = document.getElementById('workout-focus');
        if (focusArea && w.focus) {
            focusArea.innerHTML = '';
            w.focus.split(' e ').forEach(muscle => {
                const chip = document.createElement('span');
                chip.className = 'muscle-chip';
                chip.textContent = muscle.trim();
                focusArea.appendChild(chip);
            });
        }
    }
}

function renderWeeklyConsistency(completed) {
    const dotsContainer = document.getElementById('weekly-dots');
    const countEl = document.getElementById('weekly-count');
    if (!dotsContainer) return;

    dotsContainer.innerHTML = '';
    countEl.textContent = `${completed}/5 treinos`;

    for (let i = 0; i < 7; i++) {
        const dot = document.createElement('div');
        dot.className = `dot ${i < completed ? 'active' : ''}`;
        dotsContainer.appendChild(dot);
    }
}

function animateValue(selector, start, end, duration) {
    const obj = document.querySelector(selector);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease Out Cubic
        obj.innerHTML = Math.floor(easeProgress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

window.dismissCompleteModal = function () {
    const modal = document.getElementById('workout-complete-modal');
    if (modal) modal.style.display = 'none';
};

// ─── Logout (disponível globalmente) ──────────────────────────────────────
window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '/login.html';
};
