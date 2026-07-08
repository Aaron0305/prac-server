import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";

export async function GET() {
    try {
        // Generar hashes correctos
        const superAdminHash = await bcrypt.hash("super123", 12);
        const adminHash = await bcrypt.hash("admin123", 12);

        // Eliminar usuarios existentes con estos emails
        await supabase
            .from("admins")
            .delete()
            .in("email", ["superadmin@test.com", "admin@test.com"]);

        // Insertar super admin
        const { data: superAdmin, error: error1 } = await supabase
            .from("admins")
            .insert({
                name: "Super Administrador",
                email: "superadmin@test.com",
                password_hash: superAdminHash,
                role: "superadmin",
                status: "active"
            })
            .select()
            .single();

        if (error1) {
            console.error("Error creando superadmin:", error1);
        }

        // Insertar admin
        const { data: admin, error: error2 } = await supabase
            .from("admins")
            .insert({
                name: "Administrador",
                email: "admin@test.com",
                password_hash: adminHash,
                role: "admin",
                status: "active"
            })
            .select()
            .single();

        if (error2) {
            console.error("Error creando admin:", error2);
        }

        return NextResponse.json({
            success: true,
            message: "Usuarios de prueba creados correctamente",
            superAdmin: superAdmin ? { email: superAdmin.email, role: superAdmin.role } : null,
            admin: admin ? { email: admin.email, role: admin.role } : null,
            credentials: {
                superAdmin: { email: "superadmin@test.com", password: "super123" },
                admin: { email: "admin@test.com", password: "admin123" }
            }
        });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error creando usuarios de prueba", details: String(error) },
            { status: 500 }
        );
    }
}
