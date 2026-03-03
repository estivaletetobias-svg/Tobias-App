document.addEventListener('DOMContentLoaded', () => {
    const aiTrigger = document.getElementById('ai-trigger');
    const chatOverlay = document.getElementById('chat-overlay');
    const closeChat = document.getElementById('close-chat');

    aiTrigger.addEventListener('click', () => {
        chatOverlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
    });

    closeChat.addEventListener('click', () => {
        chatOverlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    });

    // Simulação de entrada no chat
    const input = document.querySelector('.chat-input-area input');
    const sendBtn = document.querySelector('.chat-input-area button');
    const messages = document.getElementById('chat-messages');

    sendBtn.addEventListener('click', () => {
        if (input.value.trim() !== "") {
            const userMsg = document.createElement('div');
            userMsg.className = 'msg user';
            userMsg.style.alignSelf = 'flex-end';
            userMsg.style.background = '#1d1d1f';
            userMsg.style.color = 'white';
            userMsg.textContent = input.value;
            messages.appendChild(userMsg);

            input.value = "";

            // Logica de resposta Mock da IA
            setTimeout(() => {
                const aiMsg = document.createElement('div');
                aiMsg.className = 'msg ai';
                aiMsg.textContent = "Excelente pergunta. Baseado no seu perfil de Disciplina 85, recomendo que foquemos em consistência hoje.";
                messages.appendChild(aiMsg);
                messages.scrollTop = messages.scrollHeight;
            }, 1000);
        }
    });
});

let currentStep = 1;

function nextStep() {
    const current = document.querySelector(`.onboarding-step[data-step="${currentStep}"]`);
    current.classList.remove('active');

    currentStep++;
    const next = document.querySelector(`.onboarding-step[data-step="${currentStep}"]`);
    if (next) {
        next.classList.add('active');
    }
}

function selectOption(el, category) {
    const cards = el.parentElement.querySelectorAll('.option-card');
    cards.forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
}

function finishOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.classList.remove('active');
        // Aqui simularia o salvamento no banco de dados e ativação do Dashboard
        alert("Sincronização Completa. Bem-vindo ao seu futuro.");
    }, 500);
}
