import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { authorize } from "../../../../lib/auth";

function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return "Error desconocido";
}

export async function GET(req: NextRequest) {
    const auth = authorize(req, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const { data, error } = await supabase
            .from("pos_products")
            .select("*")
            .order("name");

        if (error) {
            console.error("Supabase Error GET pos_products:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        
        // Transformar snake_case a camelCase para el frontend
        const formatted = data.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            price: Number(p.price),
            unit: p.unit,
            stock: Number(p.stock),
            iconId: p.image_url || "tb-package", 
            barcode: p.barcode,
            isActive: p.is_active,
            costPrice: Number(p.cost_price ?? 0),
            profitMargin: Number(p.profit_margin ?? 0),
            createdAt: p.created_at,
        }));

        return NextResponse.json(formatted);
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = authorize(req, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        const payload = {
            name: body.name,
            category: body.category,
            price: body.price,
            unit: body.unit,
            stock: body.stock,
            image_url: body.iconId, 
            barcode: body.barcode,
            is_active: body.isActive ?? true,
            cost_price: body.costPrice,
            profit_margin: body.profitMargin,
        };

        const { data, error } = await supabase
            .from("pos_products")
            .insert(payload)
            .select()
            .single();

        if (error) {
            console.error("Supabase Error POST pos_products:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            id: data.id,
            name: data.name,
            category: data.category,
            price: Number(data.price),
            unit: data.unit,
            stock: Number(data.stock),
            iconId: data.image_url,
            barcode: data.barcode,
            isActive: data.is_active,
            costPrice: Number(data.cost_price ?? 0),
            profitMargin: Number(data.profit_margin ?? 0),
            createdAt: data.created_at,
        });
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    const auth = authorize(req, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        const { id, ...updates } = body;
        
        const payload: Record<string, unknown> = {};
        if (updates.name !== undefined) payload.name = updates.name;
        if (updates.category !== undefined) payload.category = updates.category;
        if (updates.price !== undefined) payload.price = updates.price;
        if (updates.unit !== undefined) payload.unit = updates.unit;
        if (updates.stock !== undefined) payload.stock = updates.stock;
        if (updates.iconId !== undefined) payload.image_url = updates.iconId;
        if (updates.barcode !== undefined) payload.barcode = updates.barcode;
        if (updates.isActive !== undefined) payload.is_active = updates.isActive;
        if (updates.costPrice !== undefined) payload.cost_price = updates.costPrice;
        if (updates.profitMargin !== undefined) payload.profit_margin = updates.profitMargin;

        // Auto-activate/deactivate based on stock
        if (updates.stock !== undefined) {
            const newStock = parseFloat(updates.stock);
            if (newStock > 0) {
                payload.is_active = true;
            } else if (newStock <= 0) {
                payload.is_active = false;
            }
        }

        const { data, error } = await supabase
            .from("pos_products")
            .update(payload)
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Supabase Error PUT pos_products:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            id: data.id,
            name: data.name,
            category: data.category,
            price: Number(data.price),
            unit: data.unit,
            stock: Number(data.stock),
            iconId: data.image_url,
            barcode: data.barcode,
            isActive: data.is_active,
            costPrice: Number(data.cost_price ?? 0),
            profitMargin: Number(data.profit_margin ?? 0),
            createdAt: data.created_at,
        });
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}

// PATCH: Actualización atómica de stock
export async function PATCH(req: NextRequest) {
    const auth = authorize(req, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        const { id, quantity, action } = body;

        if (action === "decrement") {
            const { data, error } = await supabase.rpc("decrement_product_stock", {
                p_id: id,
                p_quantity: quantity
            });

            if (error) {
                console.error("Supabase RPC Error decrement_product_stock:", error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            if (!data.success) {
                return NextResponse.json({ error: data.error }, { status: 400 });
            }

            // Auto-deactivate if stock reached 0 after decrement
            if (data.new_stock <= 0) {
                await supabase
                    .from("pos_products")
                    .update({ is_active: false })
                    .eq("id", id);
            }

            return NextResponse.json(data);
        }

        return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}

