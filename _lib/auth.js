// Middleware de autenticação e verificação de assinatura
import { supabase, err } from './clients.js';

export async function getAuthUser(req) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return { user: null, error: 'Token ausente.' };

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { user: null, error: 'Token inválido.' };
    return { user, error: null };
}

export async function getUserProfile(userId) {
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    return { profile, error };
}

export async function checkSubscription(userId) {
    const { profile } = await getUserProfile(userId);
    return profile?.is_active === true;
}
