import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getCorsHeaders } from "@/lib/cors";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
        throw new Error("FATAL: JWT_SECRET no configurada en producción.");
    }
    console.warn("ADVERTENCIA: Usando secreto JWT por defecto para desarrollo.");
}

const ACTUAL_SECRET = JWT_SECRET || "dev-secret-only";


export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

export async function POST(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { email, password } = await request.json();

        // Validar campos
        if (!email || !password) {
            return NextResponse.json(
                { error: "Email y contraseña son requeridos" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validación y búsqueda de usuario
        let userToAuth = null;
        let role = "";
        
        // 1. Buscar en tabla de administradores
        const { data: admin, error: adminError } = await supabase
            .from("admins")
            .select("*")
            .eq("email", email.toLowerCase())
            .eq("status", "active")
            .single();

        if (admin) {
            userToAuth = admin;
            role = admin.role;
        } else {
            // 2. Si no es admin, buscar en la tabla de teachers
            const { data: teacher, error: teacherError } = await supabase
                .from("teachers")
                .select("*")
                .eq("email", email.toLowerCase())
                .eq("status", "active")
                .single();
                
            if (teacher) {
                userToAuth = teacher;
                role = "teacher";
            }
        }

        if (!userToAuth) {
            return NextResponse.json(
                { error: "Credenciales inválidas" },
                { status: 401, headers: corsHeaders }
            );
        }

        // Verificar contraseña
        const isValidPassword = await bcrypt.compare(password, userToAuth.password_hash);

        if (!isValidPassword) {
            return NextResponse.json(
                { error: "Credenciales inválidas" },
                { status: 401, headers: corsHeaders }
            );
        }

        // Generar JWT token
        const token = jwt.sign(
            {
                id: userToAuth.id,
                email: userToAuth.email,
                role: role,
                name: userToAuth.name,
            },
            ACTUAL_SECRET,
            { expiresIn: "30d" }
        );

        // Respuesta exitosa
        return NextResponse.json({
            success: true,
            user: {
                id: userToAuth.id,
                name: userToAuth.name,
                email: userToAuth.email,
                role: role,
            },
            token,
        }, { headers: corsHeaders });
    } catch (error) {
        console.error("Login error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
