// GET /api/health
// Health check — confirma que o sistema está online
export default function handler(req, res) {
    res.status(200).json({
        status: 'Aura Master Brain Online',
        version: '2.0.0',
        timestamp: new Date().toISOString()
    });
}
