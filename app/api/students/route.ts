import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";

function transformStudent(student: any) {
    return {
        id: student.id,
        studentNumber: student.student_number,
        name: student.name,
        email: student.email,
        studentPhone: student.student_phone,
        emergencyPhone: student.emergency_phone,
        level: student.level,
        monthlyFee: student.monthly_fee,
        status: student.status,
        teacherId: student.teacher_id,
        createdAt: student.enrollment_date,
        lastAccess: student.last_access,
        paymentScheme: student.payment_scheme,
        classDays: student.class_days,
        enrollmentDate: student.enrollment_date,
        enrollmentVersion: student.enrollment_version,
        dropoutReason: student.dropout_reason,
        dropoutDate: student.dropout_date,
    };
}

// Utilidad para obtener la fecha local de México en formato YYYY-MM-DD
function getMexicoLocalDateString() {
    const now = new Date();
    // Obtener la fecha en la zona horaria de México
    const mx = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const year = mx.getFullYear();
    const month = String(mx.getMonth() + 1).padStart(2, '0');
    const day = String(mx.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Manejar preflight requests
export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

// GET: Obtener todos los estudiantes
export async function GET(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const { searchParams } = new URL(request.url);
        const studentNumber = searchParams.get("studentNumber");
        const teacherId = searchParams.get("teacherId");
        const assignableForTeacherId = searchParams.get("assignableForTeacherId");
        const search = searchParams.get("search")?.trim();
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "10");
        const hasPagination = searchParams.has("page") || searchParams.has("limit");

        if (studentNumber) {
            // Buscar por número de estudiante
            const { data: student, error } = await supabase
                .from("students")
                .select("*")
                .eq("student_number", studentNumber)
                .single();

            if (error) {
                if ((error as any).code === "PGRST116") {
                    // No encontrado
                    return NextResponse.json(
                        { error: "Estudiante no encontrado" },
                        { status: 404, headers: corsHeaders }
                    );
                }
                console.error("Error fetching student by number:", error);
                return NextResponse.json(
                    { error: "Error al buscar estudiante" },
                    { status: 500, headers: corsHeaders }
                );
            }

            const transformedStudent = {
                id: student.id,
                studentNumber: student.student_number,
                name: student.name,
                email: student.email,
                studentPhone: student.student_phone,
                emergencyPhone: student.emergency_phone,
                level: student.level,
                monthlyFee: student.monthly_fee,
                status: student.status,
                createdAt: student.enrollment_date,
                lastAccess: student.last_access,
                paymentScheme: student.payment_scheme,
                classDays: student.class_days,
                enrollmentDate: student.enrollment_date,
                enrollmentVersion: student.enrollment_version,
                dropoutReason: student.dropout_reason,
                dropoutDate: student.dropout_date,
            };

            return NextResponse.json(transformedStudent, { headers: corsHeaders });
        }

        let students: any[] = [];
        let count: number | null = null;

        if (hasPagination) {
            let query = supabase
                .from("students")
                .select("*", { count: "exact" });

            if (teacherId) {
                query = query.eq("teacher_id", teacherId);
            }

            if (assignableForTeacherId) {
                query = query.or(`status.eq.active,teacher_id.eq.${assignableForTeacherId}`);
            }

            if (search) {
                query = query.or(`name.ilike.%${search}%,student_number.ilike.%${search}%,level.ilike.%${search}%`);
            }

            query = query.order("student_number", { ascending: true });

            const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;
            const from = (safePage - 1) * safeLimit;
            const to = from + safeLimit - 1;
            query = query.range(from, to);

            const { data, error, count: totalCount } = await query;

            if (error) {
                console.error("Error fetching paginated students:", error);
                return NextResponse.json(
                    { error: "Error al obtener estudiantes" },
                    { status: 500, headers: corsHeaders }
                );
            }
            students = data || [];
            count = totalCount;
        } else {
            // Cargar todos los estudiantes por lotes (chunks) de 1000 usando .range()
            // para saltar el límite silencioso de PostgREST
            let hasMore = true;
            let chunkPage = 0;
            const pageSize = 1000;

            while (hasMore) {
                let query = supabase
                    .from("students")
                    .select("*");

                if (teacherId) {
                    query = query.eq("teacher_id", teacherId);
                }

                if (assignableForTeacherId) {
                    query = query.or(`status.eq.active,teacher_id.eq.${assignableForTeacherId}`);
                }

                if (search) {
                    query = query.or(`name.ilike.%${search}%,student_number.ilike.%${search}%,level.ilike.%${search}%`);
                }

                query = query
                    .order("student_number", { ascending: true })
                    .range(chunkPage * pageSize, (chunkPage + 1) * pageSize - 1);

                const { data, error } = await query;

                if (error) {
                    console.error("Error fetching students chunk:", error);
                    return NextResponse.json(
                        { error: "Error al obtener estudiantes" },
                        { status: 500, headers: corsHeaders }
                    );
                }

                if (data && data.length > 0) {
                    students = [...students, ...data];
                    if (data.length < pageSize) {
                        hasMore = false;
                    } else {
                        chunkPage++;
                    }
                } else {
                    hasMore = false;
                }
            }
        }


        // Transformar y ordenar numéricamente por studentNumber
        const transformedStudents = (students || [])
            .map((student) => ({
                id: student.id,
                studentNumber: student.student_number,
                name: student.name,
                email: student.email,
                studentPhone: student.student_phone,
                emergencyPhone: student.emergency_phone,
                level: student.level,
                monthlyFee: student.monthly_fee,
                status: student.status,
                createdAt: student.enrollment_date,
                lastAccess: student.last_access,
                paymentScheme: student.payment_scheme,
                classDays: student.class_days,
                enrollmentDate: student.enrollment_date,
                enrollmentVersion: student.enrollment_version,
                dropoutReason: student.dropout_reason,
                dropoutDate: student.dropout_date,
            }))
            .sort((a, b) => parseInt(a.studentNumber, 10) - parseInt(b.studentNumber, 10));

        if (hasPagination) {
            const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;
            const total = count ?? 0;
            const totalPages = Math.max(1, Math.ceil(total / safeLimit));

            return NextResponse.json(
                {
                    items: transformedStudents,
                    total,
                    page: safePage,
                    limit: safeLimit,
                    totalPages,
                },
                { headers: corsHeaders }
            );
        }

        return NextResponse.json(transformedStudents, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST: Crear nuevo estudiante
export async function POST(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    try {
        const body = await request.json();
        const { name, email, level, monthlyFee: customMonthlyFee, studentPhone, emergencyPhone, paymentScheme, classDays, enrollmentDate } = body;

        // Validaciones básicas
        if (!name || !email || !level) {
            return NextResponse.json(
                { error: "Nombre, email y nivel son requeridos" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validar formato de email
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email.trim())) {
            return NextResponse.json(
                { error: "El formato del email no es válido" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validar que el nombre solo contenga letras, espacios y acentos
        const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/;
        if (!nameRegex.test(name.trim())) {
            return NextResponse.json(
                { error: "El nombre solo puede contener letras y espacios" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validar longitud mínima del nombre (al menos 2 caracteres)
        if (name.trim().length < 2) {
            return NextResponse.json(
                { error: "El nombre debe tener al menos 2 caracteres" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Formatear nombre: Primera letra mayúscula, resto minúsculas para cada palabra
        const formatName = (fullName: string): string => {
            return fullName
                .trim()
                .toLowerCase()
                .split(/\s+/) // Dividir por espacios (uno o más)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        };

        const formattedName = formatName(name);
        const formattedEmail = email.trim();

        // Generar número de estudiante único (1, 2, 3, 4...)
        // Obtener todos los student_numbers existentes por lotes (chunks) de 1000 para evitar límites
        let allStudentNumbers: string[] = [];
        let hasMoreNumbers = true;
        let numbersPage = 0;
        const numbersPageSize = 1000;

        while (hasMoreNumbers) {
            const { data, error } = await supabase
                .from("students")
                .select("student_number")
                .range(numbersPage * numbersPageSize, (numbersPage + 1) * numbersPageSize - 1);

            if (error) {
                console.error("Error fetching student numbers for auto-increment:", error);
                return NextResponse.json(
                    { error: "Error al generar matrícula de estudiante" },
                    { status: 500, headers: corsHeaders }
                );
            }

            if (data && data.length > 0) {
                allStudentNumbers = [...allStudentNumbers, ...data.map(s => s.student_number)];
                if (data.length < numbersPageSize) {
                    hasMoreNumbers = false;
                } else {
                    numbersPage++;
                }
            } else {
                hasMoreNumbers = false;
            }
        }

        // Extraer los números usados
        const usedNumbers = new Set(
            allStudentNumbers.map(s => parseInt(s, 10)).filter(n => !isNaN(n))
        );

        // Buscar el primer número disponible (1, 2, 3...)
        let nextNumber = 1;
        while (usedNumbers.has(nextNumber)) {
            nextNumber++;
        }

        const studentNumber = String(nextNumber);

        // Usar cuota personalizada si se envía, sino calcular según nivel
        let monthlyFee: number;
        if (customMonthlyFee && customMonthlyFee > 0) {
            monthlyFee = customMonthlyFee;
        } else {
            const priceByLevel: Record<string, number> = {
                "Beginner 1": 500,
                "Beginner 2": 550,
                "Intermediate 1": 600,
                "Intermediate 2": 650,
                "Advanced 1": 700,
                "Advanced 2": 750,
            };
            monthlyFee = priceByLevel[level] || 500;
        }

        // Insertar estudiante (sin fecha de expiración)
        const { data: newStudent, error } = await supabase
            .from("students")
            .insert({
                student_number: studentNumber,
                name: formattedName,
                email: formattedEmail,
                level,
                monthly_fee: monthlyFee,
                status: "active",
                student_phone: studentPhone || null,
                emergency_phone: emergencyPhone || null,
                payment_scheme: paymentScheme || "monthly_28",
                class_days: classDays || null,
                teacher_id: body.teacherId || null,
                enrollment_date: enrollmentDate || getMexicoLocalDateString(),
            })
            .select()
            .single();

        if (error) {
            console.error("Error creating student:", error);
            return NextResponse.json(
                { error: "Error al crear estudiante" },
                { status: 500, headers: corsHeaders }
            );
        }

        // Transformar respuesta
        const transformedStudent = {
            id: newStudent.id,
            studentNumber: newStudent.student_number,
            name: newStudent.name,
            email: newStudent.email,
            studentPhone: newStudent.student_phone,
            emergencyPhone: newStudent.emergency_phone,
            level: newStudent.level,
            monthlyFee: newStudent.monthly_fee,
            status: newStudent.status,
            teacherId: newStudent.teacher_id,
            createdAt: newStudent.enrollment_date,
            paymentScheme: newStudent.payment_scheme,
            classDays: newStudent.class_days,
            enrollmentDate: newStudent.enrollment_date,
            enrollmentVersion: newStudent.enrollment_version,
        };

        return NextResponse.json(transformedStudent, {
            status: 201,
            headers: corsHeaders
        });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500, headers: corsHeaders }
        );
    }
}
