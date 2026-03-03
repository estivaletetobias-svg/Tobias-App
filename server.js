const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rota de Health Check
app.get('/', (req, res) => {
    res.json({ status: "Aura System Online", version: "1.0.0" });
});

/* 
  TODOS para o Claude Sonnet:
  1. Implementar POST /api/chat (Integração OpenAI Assistants)
  2. Implementar POST /api/onboarding (Integração Supabase)
  3. Implementar POST /api/webhook/eduzz (Integração Pagamentos)
*/

app.listen(PORT, () => {
    console.log(`Master Brain rodando na porta ${PORT}`);
});
