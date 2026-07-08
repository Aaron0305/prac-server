import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { emitToAdmins } from "../../../../lib/socket";
import { authorize } from "../../../../lib/auth";

export async function GET(req: NextRequest) {
    const auth = authorize(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const { data, error } = await supabase
            .from("pos_sales")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        
        const formatted = data.map(s => ({
            id: s.id,
            items: s.items || [],
            total: Number(s.total),
            amountPaid: Number(s.amount_paid),
            change: Number(s.change),
            paymentMethod: s.payment_method,
            cashierName: s.cashier_name || "Cajero",
            createdAt: s.created_at,
            folio: s.folio,
        }));

        return NextResponse.json(formatted);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = authorize(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        
        // Obtener la cantidad de ventas del día actual para generar el folio
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        const { count } = await supabase
            .from("pos_sales")
            .select("*", { count: "exact", head: true })
            .gte("created_at", startOfDay.toISOString());
            
        const dailyNum = (count || 0) + 1;
        const folioStr = `TKT-${String(dailyNum).padStart(4, '0')}`;

        const payload = {
            folio: folioStr,
            items: body.items,
            total: body.total,
            amount_paid: body.amountPaid,
            change: body.change,
            payment_method: body.paymentMethod,
            cashier_name: body.cashierName,
        };

        const { data, error } = await supabase
            .from("pos_sales")
            .insert(payload)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const saleData = {
            id: data.id,
            items: data.items,
            total: Number(data.total),
            amountPaid: Number(data.amount_paid),
            change: Number(data.change),
            paymentMethod: data.payment_method,
            cashierName: data.cashier_name,
            createdAt: data.created_at,
            folio: data.folio,
        };

        // Notificar a todos los administradores/cajeros conectados via Socket.io
        emitToAdmins("sale-created", saleData);

        return NextResponse.json(saleData);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

