import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener todos los maestros
export async function GET(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { data: teachers, error } = await supabase
            .from("teachers")
            .select("id, name, email, status, created_at, schedule")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching teachers:", error);
            return NextResponse.json(
                { error: "Error al obtener maestros" },
                { status: 500, headers: corsHeaders }
            );
        }

        const transformedTeachers = teachers?.map((teacher) => ({
            id: teacher.id,
            name: teacher.name,
            email: teacher.email,
            status: teacher.status,
            schedule: teacher.schedule || [],
            createdAt: teacher.created_at,
        }));

        return NextResponse.json(transformedTeachers, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST: Crear nuevo maestro
export async function POST(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const body = await request.json();
        const { name, email, password } = body;

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

        // Verificar si el email ya existe en teachers
        const { data: existingTeacher } = await supabase
            .from("teachers")
            .select("id")
            .eq("email", email.toLowerCase())
            .single();

        if (existingTeacher) {
            return NextResponse.json(
                { error: "El email ya está registrado en maestros" },
                { status: 409, headers: corsHeaders }
            );
        }

        // Verificar si el email existe en admins (opcional, pero buena idea para evitar choques en login)
        const { data: existingAdmin } = await supabase
            .from("admins")
            .select("id")
            .eq("email", email.toLowerCase())
            .single();

        if (existingAdmin) {
            return NextResponse.json(
                { error: "El email ya está registrado como administrador" },
                { status: 409, headers: corsHeaders }
            );
        }

        // Hash de la contraseña
        const passwordHash = await bcrypt.hash(password, 12);

        // Insertar maestro
        const { data: newTeacher, error } = await supabase
            .from("teachers")
            .insert({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password_hash: passwordHash,
                status: "active",
            })
            .select("id, name, email, status, created_at, schedule")
            .single();

        if (error) {
            console.error("Error creating teacher:", error);
            return NextResponse.json(
                { error: "Error al crear maestro" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json({
            id: newTeacher.id,
            name: newTeacher.name,
            email: newTeacher.email,
            status: newTeacher.status,
            schedule: newTeacher.schedule || [],
            createdAt: newTeacher.created_at,
        }, { status: 201, headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
