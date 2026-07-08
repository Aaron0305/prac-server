import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
    // Determinar el origen permitido
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = [
        "http://localhost:3000",
        "https://ingles-frontend.vercel.app"
    ];
    const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    // Handle preflight requests
    if (request.method === "OPTIONS") {
        const response = new NextResponse(null, { status: 200 });
        response.headers.set("Access-Control-Allow-Origin", allowOrigin);
        response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response.headers.set("Access-Control-Allow-Credentials", "true");
        return response;
    }

    // Handle actual requests
    const response = NextResponse.next();
    response.headers.set("Access-Control-Allow-Origin", allowOrigin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Allow-Credentials", "true");

    return response;
}

// Apply middleware to all API routes
export const config = {
    matcher: "/api/:path*",
};
