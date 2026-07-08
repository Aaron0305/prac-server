import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { authorize } from "../../../../../lib/auth";

// DELETE /api/pos/sales/:id — Solo superadmin puede invocar esto
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = authorize(req, ["superadmin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const { error } = await supabase
        .from("pos_sales")
        .delete()
        .eq("id", id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: id });
}

