import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendPersonalizedPaymentEmail } from "@/lib/email";
import { getCorsHeaders } from "@/lib/cors";
import {
    calculateNextPaymentDateFromSchedule,
    formatDateSpanish,
    getPeriodDescription,
    getSchemeLabel,
    getAmountPerPeriod,
    calculateOverduePeriods,
    generateDebtMessage,
    preloadCustomHolidays,
    PaymentScheme
} from "@/lib/paymentDates";
import { authorize, TokenPayload } from "@/lib/auth";

// Función para obtener la fecha local de México en formato YYYY-MM-DD
function getLocalDateString(): string {
    const now = new Date();
    const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const year = mexicoDate.getFullYear();
    const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
    const day = String(mexicoDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Función para obtener la fecha y hora local de México en formato ISO con offset
function getLocalDateTimeISO(): string {
    const now = new Date();
    const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const year = mexicoDate.getFullYear();
    const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
    const day = String(mexicoDate.getDate()).padStart(2, '0');
    const hours = String(mexicoDate.getHours()).padStart(2, '0');
    const minutes = String(mexicoDate.getMinutes()).padStart(2, '0');
    const seconds = String(mexicoDate.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}-06:00`;
}

// Función para calcular el siguiente folio de ticket del día
async function getNextTicketFolio(): Promise<number | null> {
    try {
        const todayStr = getLocalDateString();
        const { data, error } = await supabase
            .from("payments")
            .select("ticket_folio")
            .eq("is_active", true) // Solo folios de pagos activos
            .gte("paid_at", `${todayStr}T00:00:00-06:00`)
            .lte("paid_at", `${todayStr}T23:59:59-06:00`)
            .not("ticket_folio", "is", null)
            .order("ticket_folio", { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) {
            return 1;
        }
        return (data[0].ticket_folio || 0) + 1;
    } catch (err) {
        console.error("⚠️ Error calculando folio de ticket:", err);
        return null;
    }
}

export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener todos los pagos (consolidados por período)
export async function GET(request: NextRequest) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    
    // Solo admins pueden ver historial de pagos
    const auth = authorize(request, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders });
    }

    try {
        const { searchParams } = new URL(request.url);
        const studentId = searchParams.get("studentId");
        const studentIds = searchParams.get("studentIds");
        const yearParam = searchParams.get("year");
        const raw = searchParams.get("raw"); 
        const includeVoided = searchParams.get("includeVoided") === "true";
        const includeAllVersions = searchParams.get("includeAllVersions") === "true";

        // IMPORTANTE: Supabase/PostgREST tiene un límite de servidor (api.max_rows) de 1000 filas.
        // Como hay más de 1200 pagos activos en total, cualquier consulta simple nos truncará los datos
        // silenciosamente a 1000 filas, causando que los alumnos con mes=1 queden fuera.
        // Para resolverlo de forma robusta, cargamos los datos por lotes (chunks) de 1000 usando .range()
        let payments: any[] = [];
        let hasMore = true;
        let page = 0;
        const pageSize = 1000;

        while (hasMore) {
            let query = supabase
                .from("payments")
                .select("*")
                .order("year", { ascending: false })
                .order("month", { ascending: false })
                .order("paid_at", { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (studentId) {
                query = query.eq("student_id", studentId);
            } else if (studentIds) {
                query = query.in("student_id", studentIds.split(","));
            }

            if (yearParam) {
                query = query.eq("year", parseInt(yearParam, 10));
            }

            if (!includeVoided) {
                query = query.eq("is_active", true);
            }

            const { data, error } = await query;

            if (error) {
                console.error("Error fetching payments chunk:", error);
                return NextResponse.json(
                    { error: "Error al obtener pagos" },
                    { status: 500, headers: corsHeaders }
                );
            }

            if (data && data.length > 0) {
                payments = [...payments, ...data];
                if (data.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        // Si no se incluyen todas las versiones, filtramos por la versión actual del estudiante
        if (!includeAllVersions && payments && payments.length > 0) {
            // Obtener las versiones actuales de todos los estudiantes (o solo del solicitado para optimizar)
            let studentsQuery = supabase.from("students").select("id, enrollment_version");
            if (studentId) {
                studentsQuery = studentsQuery.eq("id", studentId);
            } else if (studentIds) {
                studentsQuery = studentsQuery.in("id", studentIds.split(","));
            }
            
            const { data: studentsData } = await studentsQuery;
            
            if (studentsData) {
                const studentVersionMap = new Map(
                    studentsData.map((s) => [s.id, s.enrollment_version || 1])
                );

                payments = payments.filter((payment) => {
                    const currentVersion = studentVersionMap.get(payment.student_id) || 1;
                    const paymentVersion = payment.enrollment_version || 1;
                    return paymentVersion === currentVersion;
                });
            }
        }

        // Si se pide raw, devolver los pagos individuales sin consolidar (para reportes)
        if (raw === "true") {
            const transformedPayments = payments?.map((payment) => ({
                id: payment.id,
                studentId: payment.student_id,
                month: payment.month,
                year: payment.year,
                amount: payment.amount,
                amountExpected: payment.amount_expected,
                amountPending: payment.amount_pending,
                paymentPercentage: payment.payment_percentage,
                status: payment.status,
                paidAt: payment.paid_at,
                confirmedBy: payment.confirmed_by,
                createdAt: payment.created_at,
                paymentMethod: payment.payment_method || "efectivo",
                ticketFolio: payment.ticket_folio,
                enrollmentVersion: payment.enrollment_version,
                paymentType: payment.payment_type,
                bookDescription: payment.book_description,
            }));
            return NextResponse.json(transformedPayments, { headers: corsHeaders });
        }

        type ConsolidatedPayment = {
            id: string;
            studentId: string;
            month: number;
            year: number;
            amount: number;
            amountExpected: number | string | null;
            amountPending: number;
            paymentPercentage: number;
            status: string;
            paidAt: string;
            confirmedBy: string | null;
            paymentMethod: string;
            enrollmentVersion: number;
            individualPayments: Array<{
                id: string;
                amount: number;
                paidAt: string;
                confirmedBy: string | null;
                isActive: boolean;
            }>;
        };

        const consolidatedMap = new Map<string, ConsolidatedPayment>();

        for (const payment of payments || []) {
            const key = `${payment.student_id}-${payment.month}-${payment.year}`;

            if (!consolidatedMap.has(key)) {
                consolidatedMap.set(key, {
                    id: payment.id,
                    studentId: payment.student_id,
                    month: payment.month,
                    year: payment.year,
                    amount: 0,
                    amountExpected: payment.amount_expected,
                    amountPending: 0,
                    paymentPercentage: 0,
                    status: payment.status,
                    paidAt: payment.paid_at,
                    confirmedBy: payment.confirmed_by,
                    paymentMethod: payment.payment_method || "efectivo",
                    enrollmentVersion: payment.enrollment_version,
                    // Array de pagos individuales para referencia
                    individualPayments: []
                });
            }

            const consolidated = consolidatedMap.get(key);
            if (!consolidated) {
                continue;
            }

            const paymentAmount = parseFloat(String(payment.amount || "0"));
            consolidated.amount += paymentAmount;
            consolidated.individualPayments.push({
                id: payment.id,
                amount: paymentAmount,
                paidAt: payment.paid_at,
                confirmedBy: payment.confirmed_by,
                isActive: payment.is_active
            });

            if (payment.paid_at > consolidated.paidAt) {
                consolidated.paidAt = payment.paid_at;
            }
        }

        const consolidatedPayments = Array.from(consolidatedMap.values()).map(p => {
            const expected = parseFloat(String(p.amountExpected || "0"));
            const pending = Math.max(expected - p.amount, 0);
            const percentage = expected > 0 ? Math.min(Math.round((p.amount / expected) * 100), 100) : 100;

            return {
                ...p,
                amountPending: pending,
                paymentPercentage: percentage,
                status: percentage >= 100 ? "paid" : "paid"
            };
        });

        return NextResponse.json(consolidatedPayments, { headers: corsHeaders });
    } catch {
        return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
    }
}

// POST: Registrar nuevo pago
export async function POST(request: NextRequest) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    
    // Solo admins pueden registrar pagos
    const auth = authorize(request, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders });
    }

    await preloadCustomHolidays();
    const body = await request.json();
    const { studentId, month, year, amount, amountExpected, payment_type, paymentMethod } = body;

    const authUser = auth.user as TokenPayload;

    if (payment_type === "enrollment") {
        try {
            const enrollmentAmount = parseFloat(amount) || 0;
            const { data: studentData, error: studentError } = await supabase
                .from("students")
                .select("name, student_number, enrollment_version")
                .eq("id", studentId)
                .single();

            if (studentError || !studentData) {
                return NextResponse.json({ error: "Estudiante no encontrado" }, { status: 404, headers: corsHeaders });
            }

            const ticketFolio = await getNextTicketFolio();

            const paymentToInsert = {
                student_id: studentId,
                month: 0, 
                year: year || new Date().getFullYear(),
                amount: enrollmentAmount,
                amount_expected: enrollmentAmount,
                amount_pending: 0,
                payment_percentage: 100,
                status: "paid",
                paid_at: getLocalDateTimeISO(),
                confirmed_by: authUser.name,
                enrollment_version: studentData.enrollment_version || 1,
                payment_type: "enrollment",
                payment_method: paymentMethod || "efectivo",
                ticket_folio: ticketFolio,
                is_active: true,
            };

            const { data: newPayment, error } = await supabase
                .from("payments")
                .insert(paymentToInsert)
                .select()
                .single();

            if (error) {
                return NextResponse.json({ error: "Error al registrar pago: " + error.message }, { status: 500, headers: corsHeaders });
            }

            return NextResponse.json(newPayment, { status: 201, headers: corsHeaders });

        } catch {
            return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
        }
    }

    if (payment_type === "book") {
        try {
            const bookAmount = parseFloat(amount) || 0;
            const { data: studentData, error: studentError } = await supabase
                .from("students")
                .select("name, student_number, enrollment_version")
                .eq("id", studentId)
                .single();

            if (studentError || !studentData) {
                return NextResponse.json({ error: "Estudiante no encontrado" }, { status: 404, headers: corsHeaders });
            }

            const ticketFolio = await getNextTicketFolio();

            const paymentToInsert = {
                student_id: studentId,
                month: -1, // -1 representa pago de libro
                year: year || new Date().getFullYear(),
                amount: bookAmount,
                amount_expected: bookAmount,
                amount_pending: 0,
                payment_percentage: 100,
                status: "paid",
                paid_at: getLocalDateTimeISO(),
                confirmed_by: authUser.name,
                enrollment_version: studentData.enrollment_version || 1,
                payment_type: "book",
                payment_method: paymentMethod || "efectivo",
                ticket_folio: ticketFolio,
                book_description: body.bookDescription || null,
                is_active: true,
            };

            const { data: newPayment, error } = await supabase
                .from("payments")
                .insert(paymentToInsert)
                .select()
                .single();

            if (error) {
                return NextResponse.json({ error: "Error al registrar pago de libro: " + error.message }, { status: 500, headers: corsHeaders });
            }

            return NextResponse.json({
                id: newPayment.id,
                studentId: newPayment.student_id,
                month: newPayment.month,
                year: newPayment.year,
                amount: newPayment.amount,
                amountExpected: newPayment.amount_expected,
                amountPending: newPayment.amount_pending,
                paymentPercentage: newPayment.payment_percentage,
                status: newPayment.status,
                paidAt: newPayment.paid_at,
                confirmedBy: newPayment.confirmed_by,
                paymentMethod: newPayment.payment_method || "efectivo",
                ticketFolio: newPayment.ticket_folio,
                enrollmentVersion: newPayment.enrollment_version,
                paymentType: newPayment.payment_type,
                bookDescription: newPayment.book_description,
            }, { status: 201, headers: corsHeaders });

        } catch (err) {
            console.error("Error en pago de libro:", err);
            return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
        }
    }

    try {
        if (!studentId || !month || !year || !amount) {
            return NextResponse.json({ error: "Campos requeridos vacíos" }, { status: 400, headers: corsHeaders });
        }

        const { data: studentData, error: studentError } = await supabase
            .from("students")
            .select("*")
            .eq("id", studentId)
            .single();

        if (studentError || !studentData) {
            return NextResponse.json({ error: "Estudiante no encontrado" }, { status: 404, headers: corsHeaders });
        }

        const currentEnrollmentVersion = studentData.enrollment_version || 1;
        const realExpectedAmount = parseFloat(amountExpected) || parseFloat(studentData.monthly_fee) || 0;

        if (realExpectedAmount <= 0) {
            return NextResponse.json({ error: "Monto esperado inválido" }, { status: 400, headers: corsHeaders });
        }

        // Obtener historial de pagos activos del mismo periodo y versión actual
        const { data: allPeriodPayments, error: allPeriodPaymentsError } = await supabase
            .from("payments")
            .select("id, amount")
            .eq("student_id", studentId)
            .eq("month", month)
            .eq("year", year)
            .eq("enrollment_version", currentEnrollmentVersion)
            .eq("is_active", true)
            .eq("status", "paid");

        if (allPeriodPaymentsError) {
            console.error("Error fetching period payments:", allPeriodPaymentsError);
            return NextResponse.json(
                { error: "Error al consultar pagos del periodo" },
                { status: 500, headers: corsHeaders }
            );
        }

        // Calcular montos acumulados para este periodo
        const previousTotal = (allPeriodPayments || []).reduce(
            (sum: number, p: { amount: string | number | null }) => sum + parseFloat(String(p.amount || "0")),
            0
        );
        const newTotalAmount = previousTotal + parseFloat(amount);
        const finalAmountPending = Math.max(realExpectedAmount - newTotalAmount, 0);
        const finalPaymentPercentage = Math.min(Math.round((newTotalAmount / realExpectedAmount) * 100), 100);

        const ticketFolio = await getNextTicketFolio();

        const paymentToInsert = {
            student_id: studentId,
            month,
            year,
            amount,
            amount_expected: realExpectedAmount,
            amount_pending: finalAmountPending,
            payment_percentage: finalPaymentPercentage,
            status: "paid",
            paid_at: getLocalDateTimeISO(),
            confirmed_by: authUser.name,
            enrollment_version: currentEnrollmentVersion,
            payment_method: paymentMethod || "efectivo",
            ticket_folio: ticketFolio,
            is_active: true,
        };

        const { data: newPayment, error } = await supabase
            .from("payments")
            .insert(paymentToInsert)
            .select()
            .single();

        if (error) {
            console.error("Error creating payment:", error);
            return NextResponse.json(
                { error: "Error al registrar pago" },
                { status: 500, headers: corsHeaders }
            );
        }
        const finalPaymentRecord = newPayment;

        console.log(`✅ Nuevo registro de pago creado con ID: ${newPayment.id}`);


        // --- ENVIAR CORREO (Lógica común) ---
        // Enviar correo de confirmación (no bloqueante)
        if (studentData && finalPaymentRecord) {
            const paymentScheme = (studentData.payment_scheme || "monthly_28") as PaymentScheme;

            // Definir fecha de inscripción para cálculos
            const enrollmentDate = studentData.enrollment_date || new Date().toISOString().split("T")[0];
            const classDays = studentData.class_days;

            const amountPerPeriod = getAmountPerPeriod(studentData.monthly_fee, paymentScheme);
            const periodDescription = getPeriodDescription(paymentScheme, finalPaymentRecord.month, finalPaymentRecord.year, enrollmentDate, classDays);

            // CÁLCULO DE ADEUDOS
            // NOTA: Para esquemas continuos (weekly/biweekly/monthly_28) el "period" (month) es secuencial
            // desde la inscripción y NO se reinicia por año. Por eso NO debemos filtrar por year;
            // si filtramos, se generan adeudos falsos al cruzar de 2025 -> 2026 (caso alumno #120).
            // Para esquema daily sí se requiere filtrar por year porque el "period" es día del año.

            type PaidMonthRow = { month: number | null };
            let paidPeriods: number[] = [];
            let debtMessage = "";
            let paidPeriodsLoaded = false;

            if (paymentScheme === "daily") {
                const { data: paidThisYear, error: paidThisYearError } = await supabase
                    .from("payments")
                    .select("month")
                    .eq("student_id", studentId)
                    .eq("year", finalPaymentRecord.year)
                    .eq("enrollment_version", currentEnrollmentVersion)
                    .eq("status", "paid");

                if (paidThisYearError) {
                    console.error("Error obteniendo periodos pagados (daily):", paidThisYearError);
                } else {
                    paidPeriodsLoaded = true;
                    paidPeriods = ((paidThisYear || []) as PaidMonthRow[])
                        .map((p) => p.month)
                        .filter((m): m is number => typeof m === "number");
                }
            } else {
                const { data: paidAll, error: paidAllError } = await supabase
                    .from("payments")
                    .select("month")
                    .eq("student_id", studentId)
                    .eq("enrollment_version", currentEnrollmentVersion)
                    .eq("status", "paid");

                if (paidAllError) {
                    console.error("Error obteniendo periodos pagados (continuo):", paidAllError);
                } else {
                    paidPeriodsLoaded = true;
                    paidPeriods = ((paidAll || []) as PaidMonthRow[])
                        .map((p) => p.month)
                        .filter((m): m is number => typeof m === "number");
                }
            }

            // Remover inscripción (month=0) y deduplicar
            paidPeriods = Array.from(new Set(paidPeriods.filter((m) => m > 0)));

            // Asegurar el periodo recién pagado
            if (finalPaymentRecord.month > 0 && !paidPeriods.includes(finalPaymentRecord.month)) {
                paidPeriods.push(finalPaymentRecord.month);
            }

            const nextPaymentDate = calculateNextPaymentDateFromSchedule(
                enrollmentDate,
                paymentScheme,
                finalPaymentRecord.month,
                finalPaymentRecord.year,
                classDays
            );
            const nextPaymentDateStr = formatDateSpanish(nextPaymentDate);

            // Si no se pudieron cargar periodos pagados, evitamos enviar adeudos potencialmente falsos.
            if (paidPeriodsLoaded) {
                const overduePeriods = calculateOverduePeriods(enrollmentDate, paymentScheme, paidPeriods, classDays);
                debtMessage = generateDebtMessage(overduePeriods, paymentScheme, finalPaymentRecord.year, enrollmentDate, classDays);
            }

            // USAR EL TOTAL ACUMULADO para el correo, no solo el pago actual
            // - newTotalAmount: Total pagado del período (incluye pagos anteriores)
            // - finalAmountPending: Lo que falta por pagar (puede ser 0 si ya pagó todo)
            // - finalPaymentPercentage: Porcentaje basado en el total acumulado
            const isPartial = finalPaymentPercentage < 100;

            console.log(`📧 Enviando correo con: Total acumulado=$${newTotalAmount}, Pendiente=$${finalAmountPending}, Porcentaje=${finalPaymentPercentage}%`);

            sendPersonalizedPaymentEmail({
                studentName: studentData.name,
                studentEmail: studentData.email,
                studentNumber: studentData.student_number,
                periodDescription: periodDescription,
                amount: newTotalAmount, // TOTAL ACUMULADO, no solo este pago
                amountExpected: finalPaymentRecord.amount_expected,
                amountPending: finalAmountPending, // Pendiente basado en el total
                paymentPercentage: finalPaymentPercentage, // Porcentaje del total
                isPartialPayment: isPartial,
                paidAt: finalPaymentRecord.paid_at,
                paymentId: finalPaymentRecord.id,
                paymentScheme: paymentScheme,
                schemeLabel: getSchemeLabel(paymentScheme),
                nextPaymentDate: nextPaymentDateStr,
                nextAmount: amountPerPeriod,
                debtMessage: debtMessage,
                // Info adicional para el correo
                currentPaymentAmount: amount, // Lo que pagó AHORA (ej: $560)
                previousPaymentsTotal: previousTotal, // Lo que había pagado antes (ej: $200)
            }).catch((err) => console.error("Error enviando email:", err));
        }

        return NextResponse.json({
            id: finalPaymentRecord.id,
            studentId: finalPaymentRecord.student_id,
            month: finalPaymentRecord.month,
            year: finalPaymentRecord.year,
            amount: finalPaymentRecord.amount,
            amountExpected: finalPaymentRecord.amount_expected,
            amountPending: finalPaymentRecord.amount_pending,
            paymentPercentage: finalPaymentRecord.payment_percentage,
            status: finalPaymentRecord.status,
            paidAt: finalPaymentRecord.paid_at,
            confirmedBy: finalPaymentRecord.confirmed_by,
            paymentMethod: finalPaymentRecord.payment_method || "efectivo",
            ticketFolio: finalPaymentRecord.ticket_folio,
            enrollmentVersion: finalPaymentRecord.enrollment_version,
        }, { status: 201, headers: corsHeaders });

    } catch {
        return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
    }
}

// PUT: Revocar pago (SOFT DELETE)
export async function PUT(request: NextRequest) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));

    // Solo superadmin puede revocar pagos por seguridad contable
    const auth = authorize(request, ["superadmin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders });
    }

    try {
        const body = await request.json();
        const { studentId, month, year, action, paymentId } = body;
        const authUser = auth.user as TokenPayload;

        if (action !== "revoke") {
            return NextResponse.json({ error: "Acción no válida" }, { status: 400, headers: corsHeaders });
        }

        const voidData = {
            is_active: false,
            voided_at: getLocalDateTimeISO(),
            voided_by: authUser.name
        };

        let query = supabase.from("payments").update(voidData);

        if (paymentId) {
            query = query.eq("id", paymentId).eq("is_active", true);
        } else {
            if (!studentId || month === undefined || year === undefined) {
                return NextResponse.json(
                    { error: "Faltan datos para anular el pago" },
                    { status: 400, headers: corsHeaders }
                );
            }

            const { data: studentData, error: studentError } = await supabase
                .from("students")
                .select("enrollment_version")
                .eq("id", studentId)
                .single();

            if (studentError || !studentData) {
                return NextResponse.json(
                    { error: "Estudiante no encontrado" },
                    { status: 404, headers: corsHeaders }
                );
            }

            const currentVersion = studentData.enrollment_version || 1;
            query = query
                .eq("student_id", studentId)
                .eq("month", month)
                .eq("year", year)
                .eq("enrollment_version", currentVersion)
                .eq("is_active", true);
        }

        const { data, error } = await query.select();

        if (error) {
            console.error("Error revoking payment:", error);
            return NextResponse.json(
                { error: "Error al anular pago: " + error.message },
                { status: 500, headers: corsHeaders }
            );
        }

        if (!data || data.length === 0) {
            return NextResponse.json(
                { error: "No se encontró el pago a anular" },
                { status: 404, headers: corsHeaders }
            );
        }

        return NextResponse.json({
            success: true,
            message: `Se anularon ${data.length} registros de pago correctamente.`,
            voidedCount: data.length
        }, { headers: corsHeaders });

    } catch {
        return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
    }
}

// PATCH: Actualizar método de pago
export async function PATCH(request: NextRequest) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    
    const auth = authorize(request, ["superadmin", "admin"]);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders });
    }

    try {
        const body = await request.json();
        const { paymentId, paymentMethod } = body;

        if (!paymentId || !paymentMethod) {
            return NextResponse.json({ error: "Faltan datos" }, { status: 400, headers: corsHeaders });
        }

        const { data, error } = await supabase
            .from("payments")
            .update({ payment_method: paymentMethod })
            .eq("id", paymentId)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
        }

        return NextResponse.json({ success: true, id: data.id, paymentMethod: data.payment_method }, { headers: corsHeaders });

    } catch {
        return NextResponse.json({ error: "Error interno" }, { status: 500, headers: corsHeaders });
    }
}

