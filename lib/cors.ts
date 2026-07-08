// Utilidades CORS compartidas
export const getAllowedOrigin = (origin: string | null): string => {
    const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://ingles-frontend.vercel.app"
    ];
    return allowedOrigins.includes(origin || "") ? (origin || allowedOrigins[0]) : allowedOrigins[0];
};

export const getCorsHeaders = (origin: string | null) => ({
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

// Headers por defecto para respuestas sin request
export const defaultCorsHeaders = {
    "Access-Control-Allow-Origin": "https://ingles-frontend.vercel.app",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
