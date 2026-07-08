import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// DELETE: Eliminar administrador
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;

        const { error } = await supabase
            .from("admins")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Error deleting admin:", error);
            return NextResponse.json(
                { error: "Error al eliminar administrador" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { success: true, message: "Administrador eliminado correctamente" },
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

// PUT: Actualizar administrador
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;
        const body = await request.json();

        const updateData: Record<string, unknown> = {};
        
        if (body.name) updateData.name = body.name.trim();
        if (body.email) updateData.email = body.email.toLowerCase().trim();
        if (body.status) updateData.status = body.status;
        if (body.role) updateData.role = body.role;

        const { data: updatedAdmin, error } = await supabase
            .from("admins")
            .update(updateData)
            .eq("id", id)
            .select("id, name, email, role, status, created_at")
            .single();

        if (error) {
            console.error("Error updating admin:", error);
            return NextResponse.json(
                { error: "Error al actualizar administrador" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json({
            id: updatedAdmin.id,
            name: updatedAdmin.name,
            email: updatedAdmin.email,
            role: updatedAdmin.role,
            status: updatedAdmin.status,
            createdAt: updatedAdmin.created_at,
        }, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
