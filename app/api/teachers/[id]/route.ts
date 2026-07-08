import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener maestro por ID
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;

        const { data: teacher, error } = await supabase
            .from("teachers")
            .select("id, name, email, status, created_at, schedule")
            .eq("id", id)
            .single();

        if (error) {
            if ((error as { code?: string }).code === "PGRST116") {
                return NextResponse.json(
                    { error: "Maestro no encontrado" },
                    { status: 404, headers: corsHeaders }
                );
            }

            console.error("Error fetching teacher by id:", error);
            return NextResponse.json(
                { error: "Error al obtener maestro" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            {
                id: teacher.id,
                name: teacher.name,
                email: teacher.email,
                status: teacher.status,
                schedule: teacher.schedule || [],
                createdAt: teacher.created_at,
            },
            { headers: corsHeaders }
        );
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// DELETE: Eliminar maestro
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Cambio: Await params
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;

        const { error } = await supabase
            .from("teachers")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Error deleting teacher:", error);
            return NextResponse.json(
                { error: "Error al eliminar maestro" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { success: true, message: "Maestro eliminado correctamente" },
            { headers: corsHeaders }
        );
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// PUT: Actualizar maestro (estado, etc.)
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Cambio: Await params
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;
        const body = await request.json();

        const updateData: Record<string, unknown> = {};
        
        if (body.name) updateData.name = body.name.trim();
        if (body.email) updateData.email = body.email.toLowerCase().trim();
        if (body.status) updateData.status = body.status;
        if (body.schedule !== undefined) updateData.schedule = body.schedule;

        const { data: updatedTeacher, error } = await supabase
            .from("teachers")
            .update(updateData)
            .eq("id", id)
            .select("id, name, email, status, created_at, schedule")
            .single();

        if (error) {
            console.error("Error updating teacher:", error);
            return NextResponse.json(
                { error: "Error al actualizar maestro" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json({
            id: updatedTeacher.id,
            name: updatedTeacher.name,
            email: updatedTeacher.email,
            status: updatedTeacher.status,
            schedule: updatedTeacher.schedule || [],
            createdAt: updatedTeacher.created_at,
        }, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
