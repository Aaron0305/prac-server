// Utilidades CORS compartidas
export const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) return true; // Permitir peticiones sin origen (como Postman o server-to-server)
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
    if (origin.endsWith(".vercel.app") || origin.endsWith(".onrender.com")) return true;
    const allowedOrigins = [
        "https://prac-frontend-seven.vercel.app",
        "https://prac-server-z2md.onrender.com",
        "https://ingles-frontend.vercel.app"
    ];
    return allowedOrigins.includes(origin);
};

export const getAllowedOrigin = (origin: string | null): string => {
    if (origin && isOriginAllowed(origin)) {
        return origin;
    }
    return origin || "*";
};

export const getCorsHeaders = (origin: string | null) => ({
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

// Headers por defecto para respuestas sin request
export const defaultCorsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
