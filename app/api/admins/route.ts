import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener todos los administradores
export async function GET(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { data: admins, error } = await supabase
            .from("admins")
            .select("id, name, email, role, status, created_at")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching admins:", error);
            return NextResponse.json(
                { error: "Error al obtener administradores" },
                { status: 500, headers: corsHeaders }
            );
        }

        const transformedAdmins = admins?.map((admin) => ({
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            status: admin.status,
            createdAt: admin.created_at,
        }));

        return NextResponse.json(transformedAdmins, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST: Crear nuevo administrador
export async function POST(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const body = await request.json();
        const { name, email, password, role = "admin" } = body;

        // Validaciones
        if (!name || !email || !password) {
            return NextResponse.json(
                { error: "Nombre, email y contraseña son requeridos" },
                { status: 400, headers: corsHeaders }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { error: "La contraseña debe tener al menos 6 caracteres" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Verificar si el email ya existe
        const { data: existingAdmin } = await supabase
            .from("admins")
            .select("id")
            .eq("email", email.toLowerCase())
            .single();

        if (existingAdmin) {
            return NextResponse.json(
                { error: "El email ya está registrado" },
                { status: 409, headers: corsHeaders }
            );
        }

        // Hash de la contraseña
        const passwordHash = await bcrypt.hash(password, 12);

        // Insertar administrador
        const { data: newAdmin, error } = await supabase
            .from("admins")
            .insert({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password_hash: passwordHash,
                role: role,
                status: "active",
            })
            .select("id, name, email, role, status, created_at")
            .single();

        if (error) {
            console.error("Error creating admin:", error);
            return NextResponse.json(
                { error: "Error al crear administrador" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json({
            id: newAdmin.id,
            name: newAdmin.name,
            email: newAdmin.email,
            role: newAdmin.role,
            status: newAdmin.status,
            createdAt: newAdmin.created_at,
        }, { status: 201, headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
