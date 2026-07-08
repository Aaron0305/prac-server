import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { supabase } from "@/lib/supabase";
import { sendPaymentConfirmationEmail, sendPersonalizedPaymentEmail } from "@/lib/email";
import {
    calculateNextPaymentDate,
    calculateNextPaymentDateFromSchedule,
    generatePaymentSchedule,
    formatDateSpanish,
    getPeriodDescription,
    getSchemeLabel,
    getAmountPerPeriod,
    calculateOverduePeriods,
    generateDebtMessage,
    preloadCustomHolidays,
    PaymentScheme
} from "@/lib/paymentDates";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-in-production";

// Función para obtener la fecha local de México en formato YYYY-MM-DD
function getLocalDateString(): string {
    // Usar zona horaria de México (America/Mexico_City)
    const now = new Date();
    const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const year = mexicoDate.getFullYear();
    const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
    const day = String(mexicoDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Tipos para los eventos
export interface PaymentScanEvent {
    studentId: string;
    studentName: string;
    studentNumber: string;
    pendingMonth: number;
    pendingYear: number;
    monthlyFee: number;
}

export interface PaymentConfirmedEvent {
    studentId: string;
    month: number;
    year: number;
    success: boolean;
    message: string;
}

// Interfaz para el token decodificado
interface DecodedToken {
    id: string;
    email: string;
    role: "admin" | "superadmin";
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

// Almacenar conexiones de admins y estudiantes esperando
const adminSockets = new Map<string, AuthenticatedSocket>();
const waitingStudents = new Map<string, AuthenticatedSocket>();

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
            origin: [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "https://ingles-frontend.vercel.app",
                "https://ingles-backend-bk4n.onrender.com"
            ],
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

            if (decoded && (decoded.role === "admin" || decoded.role === "superadmin")) {
                socket.user = decoded;
                socket.isAuthenticated = true;
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

        // Registro de admin (ahora requiere autenticación previa)
        socket.on("register-admin", () => {
            if (!socket.isAuthenticated) {
                socket.emit("error", { message: "No autenticado. Inicia sesión primero." });
                console.log(`🚫 Intento de registro de admin sin autenticación: ${socket.id}`);
                return;
            }

            adminSockets.set(socket.id, socket);
            console.log(`👤 Admin registrado: ${socket.id} (${socket.user?.name})`);
            console.log(`📊 Total admins conectados: ${adminSockets.size}`);

            // Listar todos los admins conectados
            const adminList = Array.from(adminSockets.entries()).map(([id, s]) => ({
                id,
                name: s.user?.name || 'Unknown'
            }));
            console.log(`📋 Lista de admins:`, adminList);

            socket.emit("registered", {
                type: "admin",
                id: socket.id,
                totalAdmins: adminSockets.size
            });
        });

        // Registro de estudiante escaneando QR (NO requiere autenticación)
        // Cualquiera puede escanear el QR, la notificación llega a los admins conectados
        socket.on("student-scan", async (data: PaymentScanEvent) => {
            console.log(`📱 Escaneo de estudiante: ${data.studentName} (desde ${socket.id})`);
            waitingStudents.set(data.studentId, socket);

            // Notificar a todos los admins conectados para que autoricen el pago
            console.log(`🔔 Enviando notificación a ${adminSockets.size} admin(s) conectados...`);

            let notifiedCount = 0;
            adminSockets.forEach((adminSocket, adminId) => {
                console.log(`   → Notificando a: ${adminSocket.user?.name} (${adminId})`);
                adminSocket.emit("payment-request", data);
                notifiedCount++;
            });

            console.log(`✅ Notificación enviada a ${notifiedCount} dispositivos`);

            // Confirmar al estudiante que está esperando autorización del admin
            socket.emit("scan-received", {
                message: `Solicitud enviada a ${notifiedCount} dispositivo(s). Esperando autorización...`,
                studentId: data.studentId,
            });

            // NO se procesa el pago automáticamente
            // El pago solo se procesa cuando el admin presiona "Confirmar Pago"
            console.log(`⏳ Esperando autorización del admin para: ${data.studentName}`);
        });

        // Admin confirma el pago - AQUÍ ES DONDE SE PROCESA EL PAGO
        socket.on("payment-confirmed", async (data: PaymentConfirmedEvent) => {
            // ⚠️ SEGURIDAD: Solo admins autenticados pueden confirmar pagos
            if (!socket.isAuthenticated) {
                socket.emit("error", { message: "No autorizado para confirmar pagos" });
                console.log(`🚫 Intento de confirmar pago sin autenticación: ${socket.id}`);
                return;
            }

            console.log(`✅ Admin ${socket.user?.name} autorizó pago para: ${data.studentId}`);

            const studentSocket = waitingStudents.get(data.studentId);

            try {
                // Obtener datos del estudiante incluyendo esquema de pago y fecha de inscripción
                const { data: studentData } = await supabase
                    .from("students")
                    .select("email, name, student_number, monthly_fee, payment_scheme, enrollment_date, class_days")
                    .eq("id", data.studentId)
                    .single();

                if (!studentData) throw new Error("Estudiante no encontrado");

                // Pre-cargar días festivos personalizados antes de calcular fechas
                await preloadCustomHolidays();

                // Obtener esquema de pago (default: monthly_28)
                const paymentScheme = (studentData.payment_scheme || "monthly_28") as PaymentScheme;
                const enrollmentDate = studentData.enrollment_date || new Date().toISOString().split("T")[0];

                // Verificar si existe pago para mes/año
                const { data: existingPayment } = await supabase
                    .from("payments")
                    .select("id, month, year, amount, status")
                    .eq("student_id", data.studentId)
                    .eq("month", data.month)
                    .eq("year", data.year)
                    .single();

                let paymentId: string | null = null;

                let shouldSendEmail = true;

                if (existingPayment) {
                    // Si ya está pagado, evitar enviar correo duplicado
                    if (existingPayment.status === "paid") {
                        shouldSendEmail = false;
                        console.log("⚠️ Pago ya registrado como pagado. Se omitirá el envío de correo duplicado.");
                    }

                    // Actualizar a 'paid' si no lo está
                    const { data: updatedPayment, error: updateError } = await supabase
                        .from("payments")
                        .update({
                            status: "paid",
                            paid_at: getLocalDateString(),
                            amount: existingPayment.amount ?? studentData.monthly_fee,
                        })
                        .eq("id", existingPayment.id)
                        .select()
                        .single();

                    if (updateError) throw updateError;
                    paymentId = updatedPayment?.id ?? existingPayment.id;
                } else {
                    // Insertar nuevo pago marcado como 'paid'
                    const { data: newPayment, error: insertError } = await supabase
                        .from("payments")
                        .insert({
                            student_id: data.studentId,
                            month: data.month,
                            year: data.year,
                            amount: studentData.monthly_fee,
                            status: "paid",
                            paid_at: getLocalDateString(),
                        })
                        .select()
                        .single();

                    if (insertError) throw insertError;
                    paymentId = newPayment.id;
                }

                // (Cálculo de próximo pago se realiza más abajo, después de obtener `paidPeriods`)

                // Calcular monto por periodo
                const amountPerPeriod = getAmountPerPeriod(studentData.monthly_fee, paymentScheme);

                // Generar descripción del periodo pagado
                const classDays = studentData.class_days;
                const periodDescription = getPeriodDescription(paymentScheme, data.month, data.year, enrollmentDate, classDays);

                // ============================================
                // CÁLCULO DE ADEUDOS
                // ============================================

                // Obtener todos los pagos del año para verificar adeudos
                const { data: yearlyPayments } = await supabase
                    .from("payments")
                    .select("month") // En realidad son periodos (1-12, 1-52, etc)
                    .eq("student_id", data.studentId)
                    .eq("year", data.year)
                    .eq("status", "paid");

                const paidPeriods = yearlyPayments?.map(p => p.month) || [];
                // Asegurar que el pago actual se considere pagado
                if (!paidPeriods.includes(data.month)) {
                    paidPeriods.push(data.month);
                }

                // Calcular próxima fecha de pago considerando calendario basado en inscripción
                // y días de clase del estudiante para compensación correcta de festivos.
                const nextPaymentDate = calculateNextPaymentDateFromSchedule(enrollmentDate, paymentScheme, data.month, data.year, classDays);
                const nextPaymentDateStr = formatDateSpanish(nextPaymentDate);

                // Calcular periodos vencidos
                const overduePeriods = calculateOverduePeriods(enrollmentDate, paymentScheme, paidPeriods, classDays);
                const debtMessage = generateDebtMessage(overduePeriods, paymentScheme, data.year, enrollmentDate, classDays);

                // Enviar correo personalizado con ticket de pago
                if (shouldSendEmail && studentData.email && paymentId) {
                    sendPersonalizedPaymentEmail({
                        studentName: studentData.name,
                        studentEmail: studentData.email,
                        studentNumber: studentData.student_number,
                        periodDescription: periodDescription,
                        amount: studentData.monthly_fee,
                        paidAt: getLocalDateString(),
                        paymentId: paymentId,
                        paymentScheme: paymentScheme,
                        schemeLabel: getSchemeLabel(paymentScheme),
                        nextPaymentDate: nextPaymentDateStr,
                        nextAmount: amountPerPeriod,
                        debtMessage: debtMessage,
                    }).then(result => {
                        if (result.success) {
                            console.log(`📧 Ticket personalizado enviado a ${studentData.email}`);
                            console.log(`   📅 Próximo pago: ${nextPaymentDateStr}`);
                            if (debtMessage) {
                                console.log(`   ⚠️ Adeudos notificados: ${overduePeriods.length}`);
                            }
                        } else {
                            console.warn(`⚠️ No se pudo enviar ticket: ${result.error}`);
                        }
                    }).catch(err => console.error("Error enviando ticket:", err));
                }

                // Notificar resultado al estudiante que está esperando
                if (studentSocket) {
                    studentSocket.emit("payment-result", {
                        studentId: data.studentId,
                        month: data.month,
                        year: data.year,
                        success: true,
                        message: `¡Pago autorizado! Se envió el comprobante a tu correo.`,
                    });
                    waitingStudents.delete(data.studentId);
                }

                // Notificar a otros admins para actualizar UI
                adminSockets.forEach((adminSocket) => {
                    if (adminSocket.id !== socket.id) {
                        adminSocket.emit("payment-updated", {
                            studentId: data.studentId,
                            month: data.month,
                            year: data.year,
                            success: true,
                            message: "Pago autorizado por administrador",
                            paymentId,
                        });
                    }
                });

                console.log(`💰 Pago procesado exitosamente para: ${data.studentId}`);
            } catch (err) {
                console.error("Error procesando pago autorizado:", err);

                // Notificar error al estudiante
                if (studentSocket) {
                    studentSocket.emit("payment-result", {
                        studentId: data.studentId,
                        month: data.month,
                        year: data.year,
                        success: false,
                        message: "Error al procesar el pago. Intenta de nuevo.",
                    });
                }
            }
        });

        // Admin notifica éxito manualmente (sin procesar pago de nuevo)
        socket.on("notify-payment-success", (data: { studentId: string }) => {
            if (!socket.isAuthenticated) return;

            console.log(`📱 Notificando éxito al estudiante (procesado via API): ${data.studentId}`);
            const studentSocket = waitingStudents.get(data.studentId);

            if (studentSocket) {
                studentSocket.emit("payment-result", {
                    studentId: data.studentId,
                    success: true,
                    message: "¡Pago autorizado! Se envió el comprobante a tu correo.",
                });
                waitingStudents.delete(data.studentId);
            }
        });

        // Admin rechaza/cancela el pago
        socket.on("payment-rejected", (data: { studentId: string; reason: string }) => {
            // ⚠️ SEGURIDAD: Solo admins autenticados pueden rechazar pagos
            if (!socket.isAuthenticated) {
                socket.emit("error", { message: "No autorizado para rechazar pagos" });
                console.log(`🚫 Intento de rechazar pago sin autenticación: ${socket.id}`);
                return;
            }

            console.log(`❌ Pago rechazado por ${socket.user?.name} para: ${data.studentId}`);

            const studentSocket = waitingStudents.get(data.studentId);
            if (studentSocket) {
                studentSocket.emit("payment-result", {
                    studentId: data.studentId,
                    success: false,
                    message: data.reason || "Pago rechazado por el administrador",
                });
                waitingStudents.delete(data.studentId);
            }
        });

        // Desconexión
        socket.on("disconnect", () => {
            console.log(`🔌 Desconexión: ${socket.id}`);

            // Limpiar de las listas
            adminSockets.forEach((adminSocket, adminId) => {
                if (adminSocket.id === socket.id) {
                    adminSockets.delete(adminId);
                    console.log(`👤 Admin desconectado: ${adminId}`);
                }
            });

            waitingStudents.forEach((studentSocket, studentId) => {
                if (studentSocket.id === socket.id) {
                    waitingStudents.delete(studentId);
                    console.log(`📱 Estudiante desconectado: ${studentId}`);
                }
            });
        });
    });

    console.log("🚀 Servidor Socket.io iniciado");
    return io;
}

export function getIO(): SocketIOServer | null {
    return io;
}

// Función para emitir a todos los admins
export function emitToAdmins(event: string, data: unknown): void {
    adminSockets.forEach((socket) => {
        socket.emit(event, data);
    });
}
