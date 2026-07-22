import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-in-production";

// Interfaz para el token decodificado
interface DecodedToken {
    id: string;
    email: string;
    role: "admin" | "superadmin" | "teacher";
    name: string;
    iat: number;
    exp: number;
}

// Extender Socket para incluir datos de autenticación
interface AuthenticatedSocket extends Socket {
    user?: DecodedToken;
    isAuthenticated?: boolean;
}

// Singleton del servidor Socket.io
let io: SocketIOServer | null = null;

// Almacenar conexiones de usuarios autenticados
const activeSockets = new Map<string, AuthenticatedSocket>();

// Función para verificar token JWT
function verifyToken(token: string): DecodedToken | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
        return decoded;
    } catch (error) {
        console.log("❌ Token inválido:", error instanceof Error ? error.message : "Unknown error");
        return null;
    }
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
    if (io) return io;

    io = new SocketIOServer(httpServer, {
        cors: {
            origin: (requestOrigin, callback) => {
                if (!requestOrigin || 
                    requestOrigin.startsWith("http://localhost:") || 
                    requestOrigin.startsWith("http://127.0.0.1:") || 
                    requestOrigin.endsWith(".vercel.app") || 
                    requestOrigin.endsWith(".onrender.com")) {
                    callback(null, true);
                } else {
                    callback(null, true);
                }
            },
            methods: ["GET", "POST"],
            credentials: true,
        },
        path: "/api/socket",
        transports: ["websocket", "polling"],
    });

    io.on("connection", (socket: AuthenticatedSocket) => {
        console.log(`🔌 Nueva conexión: ${socket.id}`);

        // Autenticación del socket con token JWT
        socket.on("authenticate", (data: { token: string }) => {
            const decoded = verifyToken(data.token);

            if (decoded) {
                socket.user = decoded;
                socket.isAuthenticated = true;
                activeSockets.set(socket.id, socket);
                socket.emit("auth-success", {
                    message: "Autenticación exitosa",
                    user: { name: decoded.name, role: decoded.role }
                });
                console.log(`🔐 Socket autenticado: ${socket.id} (${decoded.name})`);
            } else {
                socket.isAuthenticated = false;
                socket.emit("auth-failed", { message: "Token inválido o expirado" });
                console.log(`🚫 Autenticación fallida para socket: ${socket.id}`);
            }
        });

        // Desconexión
        socket.on("disconnect", () => {
            console.log(`🔌 Desconexión: ${socket.id}`);
            activeSockets.delete(socket.id);
        });
    });

    console.log("🚀 Servidor Socket.io iniciado");
    return io;
}

export function getIO(): SocketIOServer | null {
    return io;
}
