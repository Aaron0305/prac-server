import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json({
        name: "English Learning Academy API",
        version: "1.0.0",
        status: "running",
        endpoints: {
            auth: "/api/auth/login",
            students: "/api/students",
            admins: "/api/admins",
            payments: "/api/payments",
        },
        documentation: "Ver SETUP_GUIDE.md para más información",
    });
}
