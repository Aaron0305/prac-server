import { Resend } from 'resend';

// ============================================
// CONFIGURACIÓN DE RESEND (Lazy initialization)
// ============================================

// Cliente de Resend - se inicializa solo cuando se necesita
let resendClient: Resend | null = null;

function getResendClient(): Resend {
    if (!resendClient) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error("RESEND_API_KEY no está configurada");
        }
        resendClient = new Resend(apiKey);
    }
    return resendClient;
}

function getFromEmail(): string {
    return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

function getFromName(): string {
    return process.env.RESEND_FROM_NAME || "What Time Is It? Idiomas";
}

// Nombre de los meses en español
const MONTHS_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Interfaz para los datos del pago
interface PaymentEmailData {
    studentName: string;
    studentEmail: string;
    studentNumber: string;
    month: number;
    year: number;
    amount: number;
    paidAt: string;
    paymentId: string;
}

// Función para formatear moneda
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
    }).format(amount);
}

// Función para formatear fecha
function formatDate(dateString: string): string {
    // Agregar T12:00:00 para evitar desfasamiento por zona horaria
    const date = new Date(dateString + 'T12:00:00');
    return new Intl.DateTimeFormat("es-MX", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    }).format(date);
}

// Template HTML del correo
function generatePaymentEmailHTML(data: PaymentEmailData): string {
    const monthName = MONTHS_ES[data.month - 1];
    const referenceNumber = `PAY-${data.year}-${data.paymentId.slice(0, 8).toUpperCase()}`;

    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprobante de Pago</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.10); border: 1.5px solid #e0e0e0;">
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">
                                🎓 What Time Is It? Idiomas
                            </h1>
                            <p style="color: rgba(255,255,255,0.92); margin: 10px 0 0 0; font-size: 15px;">
                                Comprobante de Pago
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px 20px 40px; text-align: center;">
                            <div style="display: inline-block; background-color: #d4edda; color: #155724; padding: 12px 24px; border-radius: 50px; font-weight: 600; border: 1.5px solid #b7e4c7;">
                                ✅ Pago Confirmado
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 40px;">
                            <table style="width: 100%; background-color: #f8f9fa; border-radius: 8px; padding: 20px; border: 1.5px solid #e0e0e0;">
                                <tr>
                                    <td style="padding: 15px;">
                                        <p style="margin: 0 0 8px 0; color: #6c757d; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Estudiante</p>
                                        <p style="margin: 0; color: #212529; font-size: 18px; font-weight: 600;">${data.studentName}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 0 15px 15px 15px;">
                                        <p style="margin: 0 0 8px 0; color: #6c757d; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Número de Estudiante</p>
                                        <p style="margin: 0; color: #212529; font-size: 16px;">${data.studentNumber}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px;">
                            <h2 style="color: #212529; font-size: 18px; margin: 0 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e9ecef; letter-spacing: 0.5px;">
                                📋 Detalle del Pago
                            </h2>
                            <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                                <tr>
                                    <td style="padding: 12px 0; color: #6c757d; border-bottom: 1px solid #e9ecef;">Concepto:</td>
                                    <td style="padding: 12px 0; color: #212529; font-weight: 500; text-align: right; border-bottom: 1px solid #e9ecef;">
                                        Mensualidad ${monthName} ${data.year}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; color: #6c757d; border-bottom: 1px solid #e9ecef;">Fecha de Pago:</td>
                                    <td style="padding: 12px 0; color: #212529; font-weight: 500; text-align: right; border-bottom: 1px solid #e9ecef;">
                                        ${formatDate(data.paidAt)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; color: #6c757d; border-bottom: 1px solid #e9ecef;">Referencia:</td>
                                    <td style="padding: 12px 0; color: #212529; font-weight: 500; text-align: right; border-bottom: 1px solid #e9ecef; font-family: monospace;">
                                        ${referenceNumber}
                                    </td>
                                <tr>
                                    <td style="padding: 16px 0; color: #212529; font-size: 18px; font-weight: 600;">Total Pagado:</td>
                                    <td style="padding: 16px 0; color: #28a745; font-size: 24px; font-weight: 700; text-align: right;">
                                        ${formatCurrency(data.amount)}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f8f9fa; padding: 25px 40px; border-radius: 0 0 10px 10px; text-align: center;">
                            <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 14px;">
                                ¡Gracias por tu pago! 🙌
                            </p>
                            <p style="margin: 0; color: #adb5bd; font-size: 12px;">
                                Este es un comprobante automático. Por favor, consérvalo para futuras referencias.
                            </p>
                            <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
                            <p style="margin: 0; color: #adb5bd; font-size: 11px;">
                                What Time Is It? Idiomas © ${new Date().getFullYear()}<br>
                                Este correo fue enviado a ${data.studentEmail}
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

// Función principal para enviar el correo de confirmación de pago
export async function sendPaymentConfirmationEmail(data: PaymentEmailData): Promise<{ success: boolean; error?: string }> {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.warn("⚠️ Resend API Key no configurada - Email no enviado");
            return { success: false, error: "Configuración de Resend no disponible" };
        }

        const monthName = MONTHS_ES[data.month - 1];
        const resend = getResendClient();

        const { data: emailData, error } = await resend.emails.send({
            from: `${getFromName()} <${getFromEmail()}>`,
            to: [data.studentEmail],
            subject: `✅ Pago Confirmado - Mensualidad ${monthName} ${data.year}`,
            html: generatePaymentEmailHTML(data),
        });

        if (error) {
            console.error("❌ Error de Resend:", error);
            return { success: false, error: error.message };
        }

        console.log("✅ Email enviado exitosamente a:", data.studentEmail, "| ID:", emailData?.id);
        return { success: true };
    } catch (error: unknown) {
        console.error("❌ Error al enviar email:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error desconocido"
        };
    }
}

// Función para verificar la configuración de email
export function isEmailConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
}

// Función para probar el envío de correo (envía un correo de prueba)
export async function testEmailConnection(): Promise<{ success: boolean; error?: string }> {
    try {
        if (!process.env.RESEND_API_KEY) {
            return { success: false, error: "RESEND_API_KEY no configurada" };
        }

        // Resend no tiene un método "verify", así que simplemente verificamos que la API key existe
        console.log("✅ Resend API Key configurada correctamente");
        return { success: true };
    } catch (error) {
        console.error("❌ Error al verificar configuración de Resend:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error desconocido"
        };
    }
}

// ============================================
// CORREO CON PRÓXIMO PAGO PERSONALIZADO
// ============================================

interface PersonalizedPaymentEmailData {
    studentName: string;
    studentEmail: string;
    studentNumber: string;
    periodDescription: string;
    amount: number;              // TOTAL ACUMULADO del período (suma de todos los pagos)
    amountExpected?: number;     // Monto que debía pagar (colegiatura)
    amountPending?: number;      // Monto que le falta
    paymentPercentage?: number;  // Porcentaje pagado (0-100) basado en el total acumulado
    paidAt: string;
    paymentId: string;
    paymentScheme: string;
    schemeLabel: string;
    nextPaymentDate: string;
    nextAmount: number;
    debtMessage?: string;
    isPartialPayment?: boolean;  // Flag para saber si es pago parcial
    // NUEVOS CAMPOS para pagos múltiples
    currentPaymentAmount?: number;   // Lo que pagó AHORA (ej: $560)
    previousPaymentsTotal?: number;  // Lo que había pagado antes (ej: $200)
}

// Template HTML del correo personalizado
function generatePersonalizedPaymentEmailHTML(data: PersonalizedPaymentEmailData): string {
    const referenceNumber = `PAY-${data.paymentId.slice(0, 8).toUpperCase()}`;

    // Determinar si es pago parcial
    const isPartial = data.isPartialPayment || (data.paymentPercentage !== undefined && data.paymentPercentage < 100);
    const percentage = data.paymentPercentage ?? 100;
    const amountPending = data.amountPending ?? 0;
    const amountExpected = data.amountExpected ?? data.amount;

    // Información de pagos múltiples
    const currentPayment = data.currentPaymentAmount ?? data.amount;
    const previousPayments = data.previousPaymentsTotal ?? 0;
    const hasMultiplePayments = previousPayments > 0;

    // Sección cuando hay pago completo con pagos previos (ej: pagó $200 antes, ahora pagó $560, total $760 = 100%)
    const completedPaymentWithPrevious = !isPartial && hasMultiplePayments ? `
        <tr>
            <td style="padding: 0 30px 20px;">
                <table width="100%" style="background-color: #d1fae5; border: 2px solid #22c55e; border-radius: 12px; padding: 20px;">
                    <tr>
                        <td>
                            <p style="margin: 0 0 12px 0; color: #166534; font-size: 14px; font-weight: bold; text-transform: uppercase;">
                                ✅ Pago Completo (100%)
                            </p>
                            <div style="background-color: #bbf7d0; border-radius: 10px; height: 20px; overflow: hidden; margin-bottom: 12px;">
                                <div style="background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%); height: 100%; width: 100%; border-radius: 10px;"></div>
                            </div>
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="color: #166534; font-size: 14px;">
                                        <strong>Colegiatura del período:</strong> ${formatCurrency(amountExpected)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #166534; font-size: 14px; padding-top: 5px;">
                                        <strong>✓ Pago anterior:</strong> ${formatCurrency(previousPayments)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #22c55e; font-size: 14px; padding-top: 5px;">
                                        <strong>✓ Pago de hoy:</strong> ${formatCurrency(currentPayment)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #166534; font-size: 18px; font-weight: bold; padding-top: 15px; border-top: 1px solid #bbf7d0; margin-top: 10px;">
                                        ✅ Total pagado: ${formatCurrency(data.amount)}
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 15px 0 0 0; color: #166534; font-size: 13px; background-color: #ecfdf5; padding: 10px; border-radius: 8px;">
                                🎉 <strong>¡Felicidades!</strong> Has completado el pago de este período.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    ` : '';

    // Sección de pago parcial (si aplica)
    const partialPaymentSection = isPartial ? `
        <tr>
            <td style="padding: 0 30px 20px;">
                <table width="100%" style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 20px;">
                    <tr>
                        <td>
                            <p style="margin: 0 0 12px 0; color: #92400e; font-size: 14px; font-weight: bold; text-transform: uppercase;">
                                ⚠️ Pago Parcial (${percentage}%)
                            </p>
                            <div style="background-color: #fed7aa; border-radius: 10px; height: 20px; overflow: hidden; margin-bottom: 12px;">
                                <div style="background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%); height: 100%; width: ${percentage}%; border-radius: 10px;"></div>
                            </div>
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="color: #78350f; font-size: 14px;">
                                        <strong>Monto esperado:</strong> ${formatCurrency(amountExpected)}
                                    </td>
                                </tr>
                                ${hasMultiplePayments ? `
                                <tr>
                                    <td style="color: #78350f; font-size: 14px; padding-top: 5px;">
                                        <strong>Pagos anteriores:</strong> ${formatCurrency(previousPayments)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #22c55e; font-size: 14px; padding-top: 5px;">
                                        <strong>✓ Pago de hoy:</strong> ${formatCurrency(currentPayment)}
                                    </td>
                                </tr>
                                ` : ''}
                                <tr>
                                    <td style="color: #22c55e; font-size: 14px; padding-top: 5px;">
                                        <strong>✓ Total pagado:</strong> ${formatCurrency(data.amount)}
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #dc2626; font-size: 16px; font-weight: bold; padding-top: 10px;">
                                        ⚠️ Por pagar: ${formatCurrency(amountPending)}
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 15px 0 0 0; color: #92400e; font-size: 13px; background-color: #fef9c3; padding: 10px; border-radius: 8px;">
                                📝 ${hasMultiplePayments ? `Has pagado un total de <strong>${formatCurrency(data.amount)}</strong>` : `Pagaste <strong>${formatCurrency(currentPayment)}</strong>`}, te restan <strong>${formatCurrency(amountPending)}</strong> y el próximo pago es el día <strong>${data.nextPaymentDate}</strong>.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    ` : '';

    const debtSection = data.debtMessage ? `
        <tr>
            <td style="padding: 0 30px 20px;">
                <table width="100%" style="background-color: #fee2e2; border: 1px solid #ef4444; border-radius: 12px; padding: 15px;">
                    <tr>
                        <td>
                            <p style="margin: 0 0 8px 0; color: #b91c1c; font-size: 14px; font-weight: bold; text-transform: uppercase;">
                                ⚠️ Adeudos Vencidos
                            </p>
                            <p style="margin: 0; color: #7f1d1d; font-size: 14px; white-space: pre-line; line-height: 1.5;">
                                ${data.debtMessage}
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    ` : '';

    // Determinar el título según si es pago parcial o completo
    const headerTitle = isPartial ? '⚠️ Pago Parcial Registrado' : '✅ Pago Confirmado';
    const headerColor = isPartial
        ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
        : 'linear-gradient(135deg, #014287 0%, #2176c1 50%, #c1121f 100%)';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isPartial ? 'Pago Parcial' : 'Pago Confirmado'}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <tr>
                        <td style="background: ${headerColor}; padding: 40px 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">
                                ${headerTitle}
                            </h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
                                ${data.periodDescription}
                            </p>
                            <p style="color: rgba(255,255,255,0.7); margin: 5px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                Pago ${data.schemeLabel}
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <table width="100%" style="background-color: #f8fafc; border-radius: 12px; padding: 20px;">
                                <tr>
                                    <td>
                                        <p style="margin: 0 0 5px 0; color: #64748b; font-size: 12px;">ESTUDIANTE</p>
                                        <p style="margin: 0 0 15px 0; color: #1e293b; font-size: 18px; font-weight: bold;">
                                            ${data.studentName}
                                        </p>
                                        <p style="margin: 0 0 5px 0; color: #64748b; font-size: 12px;">NO. ESTUDIANTE</p>
                                        <p style="margin: 0; color: #1e293b; font-size: 16px; font-family: monospace;">
                                            #${data.studentNumber}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    ${completedPaymentWithPrevious}
                    ${partialPaymentSection}
                    ${debtSection}
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="padding: 15px 0; border-bottom: 1px solid #e2e8f0;">
                                        <span style="color: #64748b; font-size: 14px;">Monto pagado</span>
                                        <span style="float: right; color: #22c55e; font-size: 18px; font-weight: bold;">
                                            ${formatCurrency(data.amount)}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 0; border-bottom: 1px solid #e2e8f0;">
                                        <span style="color: #64748b; font-size: 14px;">Fecha de pago</span>
                                        <span style="float: right; color: #1e293b; font-size: 14px;">
                                            ${formatDate(data.paidAt)}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 0; border-bottom: 1px solid #e2e8f0;">
                                        <span style="color: #64748b; font-size: 14px;">Referencia</span>
                                        <span style="float: right; color: #1e293b; font-size: 14px; font-family: monospace;">
                                            ${referenceNumber}
                                        </span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <table width="100%" style="background: linear-gradient(135deg, #014287 0%, #2176c1 100%); border-radius: 12px; padding: 25px;">
                                <tr>
                                    <td style="text-align: center;">
                                        <p style="margin: 0 0 5px 0; color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                            Próximo pago
                                        </p>
                                        <p style="margin: 0 0 10px 0; color: #ffffff; font-size: 22px; font-weight: bold;">
                                            📅 ${data.nextPaymentDate}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0 0 10px 0; color: #64748b; font-size: 14px;">
                                <strong>What Time Is It? Idiomas</strong>
                            </p>
                            <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                                Este es un correo automático. Por favor no responder.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

// Función para enviar correo de pago personalizado
export async function sendPersonalizedPaymentEmail(
    data: PersonalizedPaymentEmailData
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.warn("⚠️ Resend API Key no configurada - Email no enviado");
            return { success: false, error: "Configuración de Resend no disponible" };
        }

        const resend = getResendClient();

        const { data: emailData, error } = await resend.emails.send({
            from: `${getFromName()} <${getFromEmail()}>`,
            to: [data.studentEmail],
            subject: `✅ Pago Confirmado - ${data.periodDescription} | Próximo: ${data.nextPaymentDate}`,
            html: generatePersonalizedPaymentEmailHTML(data),
        });

        if (error) {
            console.error("❌ Error de Resend:", error);
            return { success: false, error: error.message };
        }

        console.log("✅ Email personalizado enviado a:", data.studentEmail, "| ID:", emailData?.id);
        return { success: true };

    } catch (error: unknown) {
        console.error("❌ Error al enviar email personalizado:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error desconocido"
        };
    }
}