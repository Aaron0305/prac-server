import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================
// SUPABASE CLIENT (Lazy initialization para evitar errores en build)
// ============================================

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
    if (!supabaseClient) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Missing Supabase environment variables");
        }

        supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
            global: {
                // Usar fetch personalizado que maneja errores de certificado SSL en desarrollo
                fetch: async (url, options = {}) => {
                    try {
                        return await fetch(url, options);
                    } catch (error: any) {
                        // Si hay error de certificado SSL en desarrollo, intentar con verificación deshabilitada
                        if (process.env.NODE_ENV === 'development' && error?.message?.includes('certificate')) {
                            console.warn('⚠️ Advertencia: Certificado SSL expirado detectado. Usando modo inseguro solo para desarrollo.');
                            // @ts-ignore - Solo para desarrollo
                            const https = require('https');
                            const agent = new https.Agent({ rejectUnauthorized: false });
                            return await fetch(url, { ...options, agent } as any);
                        }
                        throw error;
                    }
                },
            }
        });
    }
    return supabaseClient;
}

// Exportar un proxy que usa lazy initialization
export const supabase = new Proxy({} as SupabaseClient, {
    get(_, prop) {
        return (getSupabaseClient() as any)[prop];
    }
});

// Tipos de la base de datos
export interface Database {
    students: Student;
    admins: Admin;
    payments: Payment;
}

export interface Student {
    id: string;
    student_number: string;
    name: string;
    email: string;
    level: "Beginner 1" | "Beginner 2" | "Intermediate 1" | "Intermediate 2" | "Advanced 1" | "Advanced 2";
    monthly_fee: number;
    status: "active" | "inactive";
    created_at?: string;
    last_access?: string;
}

export interface Admin {
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: "admin" | "superadmin";
    status: "active" | "inactive";
    created_at: string;
}

export interface Payment {
    id: string;
    student_id: string;
    month: number;
    year: number;
    amount: number;
    status: "paid" | "pending" | "overdue";
    paid_at?: string;
    created_at: string;
}
