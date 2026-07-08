import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";

// Manejar preflight requests
export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener un estudiante por ID
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;

        const { data: student, error } = await supabase
            .from("students")
            .select("*")
            .eq("id", id)
            .single();

        if (error || !student) {
            return NextResponse.json(
                { error: "Estudiante no encontrado" },
                { status: 404, headers: corsHeaders }
            );
        }

        const transformedStudent = {
            id: student.id,
            studentNumber: student.student_number,
            name: student.name,
            email: student.email,
            level: student.level,
            monthlyFee: student.monthly_fee,
            status: student.status,
            createdAt: student.enrollment_date,
            lastAccess: student.last_access,
            enrollmentVersion: student.enrollment_version,
            dropoutReason: student.dropout_reason,
            dropoutDate: student.dropout_date,
            studentPhone: student.student_phone,
            teacherId: student.teacher_id,
        };

        return NextResponse.json(transformedStudent, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// PUT: Actualizar estudiante
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;
        const body = await request.json();

        // Obtener el estudiante actual ANTES de actualizar para comparar fechas
        const { data: currentStudent } = await supabase
            .from("students")
            .select("enrollment_date, status, enrollment_version")
            .eq("id", id)
            .single();

        const oldEnrollmentDate = currentStudent?.enrollment_date;
        const oldStatus = currentStudent?.status;
        const oldEnrollmentVersion = currentStudent?.enrollment_version || 1;
        const isReactivating = body.status === "active" && oldStatus !== "active";
        const isChangingEnrollmentDate = body.enrollmentDate && body.enrollmentDate !== oldEnrollmentDate;

        // Preparar campos a actualizar (snake_case)
        const updateData: Record<string, unknown> = {};

        if (body.name) updateData.name = body.name.trim();
        if (body.email) updateData.email = body.email.trim();
        if (body.emergencyPhone !== undefined) updateData.emergency_phone = body.emergencyPhone?.trim() || null;
        if (body.studentPhone !== undefined) updateData.student_phone = body.studentPhone?.trim() || null;
        if (body.level) {
            updateData.level = body.level;
            // Solo actualizar cuota si se especifica monthlyFee, sino mantener la actual
            if (body.monthlyFee) {
                updateData.monthly_fee = body.monthlyFee;
            }
        }
        if (body.status) updateData.status = body.status;
        if (body.status) updateData.status = body.status;
        if (body.paymentScheme) updateData.payment_scheme = body.paymentScheme;
        if (body.classDays !== undefined) updateData.class_days = body.classDays;

        if (body.dropoutReason !== undefined) updateData.dropout_reason = body.dropoutReason;
        if (body.dropoutDate !== undefined) updateData.dropout_date = body.dropoutDate;
        if (body.enrollmentDate) updateData.enrollment_date = body.enrollmentDate;
        if (body.teacherId !== undefined) updateData.teacher_id = body.teacherId;

        // Si se está reactivando, incrementar la versión de inscripción y actualizar fecha si no se provee
        if (isReactivating) {
            updateData.enrollment_version = oldEnrollmentVersion + 1;

            if (!body.enrollmentDate) {
                // Usar fecha actual de México si no se especifica una
                const now = new Date();
                const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
                const year = mexicoDate.getFullYear();
                const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
                const day = String(mexicoDate.getDate()).padStart(2, '0');
                updateData.enrollment_date = `${year}-${month}-${day}`;
            }
        }

        const { data: updatedStudent, error } = await supabase
            .from("students")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Error updating student:", error);
            return NextResponse.json(
                { error: "Error al actualizar estudiante" },
                { status: 500, headers: corsHeaders }
            );
        }

        if (!updatedStudent) {
            return NextResponse.json(
                { error: "Estudiante no encontrado" },
                { status: 404, headers: corsHeaders }
            );
        }

        // Si se está reactivando con una nueva fecha de inscripción, 
        // NO modificamos los pagos históricos para conservarlos en los reportes.
        // El frontend se encargará de filtrar los pagos que no corresponden al schedule actual
        // basándose en la fecha de inscripción y la fecha de pago (paid_at).
        // Esto permite que los reportes históricos sigan funcionando correctamente.
        if ((isReactivating || isChangingEnrollmentDate) && body.enrollmentDate) {
            console.log(`🔄 Reactivando estudiante ${id} con nueva fecha de inscripción: ${body.enrollmentDate}`);
            console.log(`   Fecha anterior: ${oldEnrollmentDate}`);
            console.log(`   Los pagos históricos se conservarán para los reportes.`);
            console.log(`   El frontend filtrará automáticamente los pagos que no corresponden al nuevo schedule.`);
        }

        const transformedStudent = {
            id: updatedStudent.id,
            studentNumber: updatedStudent.student_number,
            name: updatedStudent.name,
            email: updatedStudent.email,
            studentPhone: updatedStudent.student_phone,
            emergencyPhone: updatedStudent.emergency_phone,
            level: updatedStudent.level,
            monthlyFee: updatedStudent.monthly_fee,
            status: updatedStudent.status,
            createdAt: updatedStudent.enrollment_date,
            paymentScheme: updatedStudent.payment_scheme,
            classDays: updatedStudent.class_days,
            enrollmentDate: updatedStudent.enrollment_date,
            enrollmentVersion: updatedStudent.enrollment_version,
            dropoutReason: updatedStudent.dropout_reason,
            dropoutDate: updatedStudent.dropout_date,
            teacherId: updatedStudent.teacher_id,
        };

        return NextResponse.json(transformedStudent, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// DELETE: Eliminar estudiante
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { id } = await params;

        // Primero eliminar pagos asociados
        await supabase.from("payments").delete().eq("student_id", id);

        // Luego eliminar estudiante
        const { error } = await supabase
            .from("students")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Error deleting student:", error);
            return NextResponse.json(
                { error: "Error al eliminar estudiante" },
                { status: 500, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { success: true, message: "Estudiante eliminado correctamente" },
            { headers: corsHeaders }
        );
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
