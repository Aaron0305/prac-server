import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export interface TokenPayload {
    id: string;
    email: string;
    role: string;
    name: string;
}

/**
 * Verifica un token JWT y devuelve su contenido.
 */
export function verifyToken(request: NextRequest): TokenPayload {
    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET no configurada en el servidor.");
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("No se proporcionó un token de autorización.");
    }

    const token = authHeader.split(" ")[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
        return decoded;
    } catch (err) {
        throw new Error("Token de autorización inválido o expirado.");
    }
}

/**
 * Helper para validar roles específicos en rutas de API.
 */
export function authorize(request: NextRequest, allowedRoles: string[] = ["superadmin", "admin"]) {
    try {
        const user = verifyToken(request);
        if (!allowedRoles.includes(user.role)) {
            return { authorized: false, error: "No tienes permisos para realizar esta acción.", status: 403 };
        }
        return { authorized: true, user };
    } catch (err: any) {
        return { authorized: false, error: err.message, status: 401 };
    }
}
