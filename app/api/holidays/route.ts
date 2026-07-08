import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";
import { clearCustomHolidaysCache, preloadCustomHolidays } from "@/lib/paymentDates";

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener todos los días festivos personalizados
export async function GET(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { data: holidays, error } = await supabase
            .from("custom_holidays")
            .select("id, date, name, is_disabled, created_by, created_at")
            .order("date", { ascending: true });

        if (error) {
            console.error("Error fetching custom holidays:", error);
            return NextResponse.json(
                { error: "Error al obtener días festivos personalizados" },
                { status: 500, headers: corsHeaders }
            );
        }

        const transformed = holidays?.map((h) => ({
            id: h.id,
            date: h.date,
            name: h.name,
            isDisabled: h.is_disabled || false,
            createdBy: h.created_by,
            createdAt: h.created_at,
        }));

        return NextResponse.json(transformed, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST: Crear (activar) un día festivo personalizado
export async function POST(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const body = await request.json();
        const { date, name = "Día festivo personalizado", isDisabled = false } = body;

        if (!date) {
            return NextResponse.json(
                { error: "La fecha es requerida" },
                { status: 400, headers: corsHeaders }
            );
        }

        const { data: holiday, error } = await supabase
            .from("custom_holidays")
            .insert({ date, name, is_disabled: isDisabled })
            .select()
            .single();

        if (error) {
            // Si ya existe, retornar conflicto
            if (error.code === "23505") {
                return NextResponse.json(
                    { error: "Este día ya está marcado como festivo" },
                    { status: 409, headers: corsHeaders }
                );
            }
            console.error("Error creating custom holiday:", error);
            return NextResponse.json(
                { error: "Error al crear día festivo" },
                { status: 500, headers: corsHeaders }
            );
        }

        // Limpiar cache de días festivos y recargar
        clearCustomHolidaysCache();
        await preloadCustomHolidays();

        return NextResponse.json({
            id: holiday.id,
            date: holiday.date,
            name: holiday.name,
            isDisabled: holiday.is_disabled || false,
            createdBy: holiday.created_by,
            createdAt: holiday.created_at,
        }, { status: 201, headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// DELETE: Eliminar (desactivar) un día festivo personalizado por fecha
export async function DELETE(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { searchParams } = new URL(request.url);
        const date = searchParams.get("date");

        if (!date) {
            return NextResponse.json(
                { error: "La fecha es requerida" },
                { status: 400, headers: corsHeaders }
            );
        }

        const { error } = await supabase
            .from("custom_holidays")
            .delete()
            .eq("date", date);

        if (error) {
            console.error("Error deleting custom holiday:", error);
            return NextResponse.json(
                { error: "Error al eliminar día festivo" },
                { status: 500, headers: corsHeaders }
            );
        }

        // Limpiar cache de días festivos y recargar
        clearCustomHolidaysCache();
        await preloadCustomHolidays();

        return NextResponse.json(
            { success: true, message: "Día festivo eliminado" },
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
