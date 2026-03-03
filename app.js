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
        alert("Sincronização Completa. Bem-vindo ao seu futuro.");
    }, 500);
}

// Workout Session Management
const startWorkoutBtn = document.querySelector('.next-workout .aura-btn');
const workoutOverlay = document.getElementById('workout-overlay');
const closeWorkout = document.getElementById('close-workout');
const timerDisplay = document.getElementById('timer');
const startRestBtn = document.getElementById('start-rest');

startWorkoutBtn.addEventListener('click', () => {
    workoutOverlay.style.display = 'block';
});

closeWorkout.addEventListener('click', () => {
    workoutOverlay.style.display = 'none';
});

// Timer Logic
let timerInterval;
startRestBtn.addEventListener('click', () => {
    let timeLeft = 45;
    startRestBtn.disabled = true;
    startRestBtn.textContent = "Descansando...";

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            timerDisplay.textContent = "00:45";
            startRestBtn.disabled = false;
            startRestBtn.textContent = "Iniciar Descanso";
            alert("Hora da próxima série!");
        }
    }, 1000);
});

// Quick AI Trigger from Workout
document.getElementById('quick-ai-trigger').addEventListener('click', () => {
    document.getElementById('chat-overlay').style.display = 'block';
});
