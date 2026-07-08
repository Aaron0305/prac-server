import { NextRequest, NextResponse } from "next/server";

// Este endpoint se usa para verificar el estado del socket
export async function GET() {
    return NextResponse.json({
        status: "ok",
        message: "Socket.io server running on /api/socket",
        timestamp: new Date().toISOString(),
    });
}
