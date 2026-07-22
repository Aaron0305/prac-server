import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
    const origin = request.headers.get("origin") || "";
    const isAllowed = !origin || 
        origin.startsWith("http://localhost:") || 
        origin.startsWith("http://127.0.0.1:") || 
        origin.endsWith(".vercel.app") || 
        origin.endsWith(".onrender.com");
    
    const allowOrigin = isAllowed ? (origin || "*") : "*";

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
