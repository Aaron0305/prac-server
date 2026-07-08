
// ============================================
// CÁLCULO DINÁMICO DE DÍAS FESTIVOS MEXICANOS
// ============================================

import { supabase } from "@/lib/supabase";

// ============================================
// CUSTOM HOLIDAYS (DÍAS FESTIVOS PERSONALIZADOS)
// ============================================

// Cache de días festivos personalizados (formato "YYYY-MM-DD")
let customHolidaysCache: Set<string> | null = null;
// Cache de días festivos predefinidos desactivados (formato "YYYY-MM-DD")
let disabledHolidaysCache: Set<string> | null = null;
let customHolidaysLoadPromise: Promise<void> | null = null;

// Cargar días festivos personalizados y desactivados desde la base de datos
async function loadCustomHolidays(): Promise<void> {
    try {
        const { data, error } = await supabase
            .from("custom_holidays")
            .select("date, is_disabled");

        if (error) {
            console.error("Error loading custom holidays:", error);
            customHolidaysCache = new Set();
            disabledHolidaysCache = new Set();
            return;
        }

        const customDates = new Set<string>();
        const disabledDates = new Set<string>();

        (data || []).forEach((h: { date: string; is_disabled: boolean }) => {
            if (h.is_disabled) {
                disabledDates.add(h.date);
            } else {
                customDates.add(h.date);
            }
        });

        customHolidaysCache = customDates;
        disabledHolidaysCache = disabledDates;
        console.log(`✅ Custom holidays loaded: ${customHolidaysCache.size} added, ${disabledHolidaysCache.size} disabled`);
    } catch (err) {
        console.error("Error loading custom holidays:", err);
        customHolidaysCache = new Set();
        disabledHolidaysCache = new Set();
    }
}

// Función para obtener custom holidays (con lazy loading)
async function getCustomHolidays(): Promise<Set<string>> {
    if (customHolidaysCache !== null) return customHolidaysCache;

    if (!customHolidaysLoadPromise) {
        customHolidaysLoadPromise = loadCustomHolidays().finally(() => {
            customHolidaysLoadPromise = null;
        });
    }
    await customHolidaysLoadPromise;
    return customHolidaysCache || new Set();
}

// Versión síncrona (usa cache, retorna vacío si no se ha cargado aún)
function getCustomHolidaysSync(): Set<string> {
    return customHolidaysCache || new Set();
}

// Versión síncrona para días desactivados
function getDisabledHolidaysSync(): Set<string> {
    return disabledHolidaysCache || new Set();
}

// Limpiar cache (llamar cuando se agregan/eliminan custom holidays)
export function clearCustomHolidaysCache(): void {
    customHolidaysCache = null;
    disabledHolidaysCache = null;
}

// Inyectar datos en cache directamente (para tests sin DB)
export function setCustomHolidaysForTest(customs: string[], disabled: string[] = []): void {
    customHolidaysCache = new Set(customs);
    disabledHolidaysCache = new Set(disabled);
}

// Pre-cargar custom holidays (llamar al inicio o antes de cálculos)
export async function preloadCustomHolidays(): Promise<void> {
    await getCustomHolidays();
}

// Verificar si una fecha es un custom holiday
function isCustomHoliday(date: Date): boolean {
    const customs = getCustomHolidaysSync();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return customs.has(`${year}-${month}-${day}`);
}

// Verificar si una fecha predefinida ha sido desactivada
function isDisabledHoliday(date: Date): boolean {
    const disabled = getDisabledHolidaysSync();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return disabled.has(`${year}-${month}-${day}`);
}

// Obtener el N-ésimo día de la semana de un mes (ej: primer lunes, tercer lunes)
function getNthDayOfWeekInMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();

    let daysToAdd = dayOfWeek - firstDayOfWeek;
    if (daysToAdd < 0) daysToAdd += 7;

    daysToAdd += (n - 1) * 7;

    return new Date(year, month, 1 + daysToAdd);
}

// Algoritmo de Computus para calcular la fecha de Pascua
function getEasterSunday(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(year, month, day);
}

// Obtener Jueves, Viernes y Sábado Santo basados en Pascua
function getHolyWeekDays(year: number): Date[] {
    const easter = getEasterSunday(year);
    const dates: Date[] = [];

    // Jueves Santo (3 días antes de Pascua)
    const holyThursday = new Date(easter);
    holyThursday.setDate(easter.getDate() - 3);
    dates.push(holyThursday);

    // Viernes Santo (2 días antes de Pascua)
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);
    dates.push(goodFriday);

    // Sábado Santo (1 día antes de Pascua)
    const holySaturday = new Date(easter);
    holySaturday.setDate(easter.getDate() - 1);
    dates.push(holySaturday);

    return dates;
}

// Formato de fecha MM-DD
function formatMonthDay(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
}

// Generar todos los feriados de un año (FECHAS REALES, no lunes cívicos)
function generateHolidaysForYear(year: number): Set<string> {
    const holidays = new Set<string>();

    // Días fijos (fechas reales)

    holidays.add("05-01"); // Día del Trabajo
    holidays.add("09-16"); // Independencia

    // Días oficiales recorridos al lunes (Ley Federal del Trabajo - Puentes)
    // 5 de Febrero (Constitución) -> Primer lunes de febrero
    const constitutionDay = getNthDayOfWeekInMonth(year, 1, 1, 1);
    holidays.add(formatMonthDay(constitutionDay));

    // 21 de Marzo (Juárez) -> Tercer lunes de marzo
    const juarezDay = getNthDayOfWeekInMonth(year, 2, 1, 3);
    holidays.add(formatMonthDay(juarezDay));

    // 20 de Noviembre (Revolución) -> Tercer lunes de noviembre
    const revolutionDay = getNthDayOfWeekInMonth(year, 10, 1, 3);
    holidays.add(formatMonthDay(revolutionDay));

    // Jueves y Viernes Santo (calculados dinámicamente)
    const holyWeek = getHolyWeekDays(year);
    holyWeek.forEach(d => holidays.add(formatMonthDay(d)));

    return holidays;
}

// Cache de feriados por año
const holidaysCache: Map<number, Set<string>> = new Map();

// Obtener festivos por año (con cache)
function getHolidaysForYear(year: number): Set<string> {
    if (!holidaysCache.has(year)) {
        holidaysCache.set(year, generateHolidaysForYear(year));
    }
    return holidaysCache.get(year)!;
}

// Esquemas de pago
export type PaymentScheme = "daily" | "weekly" | "biweekly" | "monthly_28";

// Días entre pagos según el esquema
const SCHEME_DAYS: Record<PaymentScheme, number> = {
    daily: 1,
    weekly: 7,
    biweekly: 14,
    monthly_28: 28,
};

// Periodos por año según frontend
const PERIODS_PER_YEAR: Record<PaymentScheme, number> = {
    daily: 365,
    weekly: 48,
    biweekly: 24,
    monthly_28: 12,
};

// Etiquetas de esquemas
const SCHEME_LABELS: Record<PaymentScheme, string> = {
    daily: "Diario",
    weekly: "Semanal",
    biweekly: "Catorcenal",
    monthly_28: "Mensual (28 días)",
};

// ============================================
// FUNCIONES DE VERIFICACIÓN DE DÍAS
// ============================================

// Verificar si una fecha es día festivo mexicano (incluye personalizados, excluye desactivados)
export function isHoliday(date: Date): boolean {
    // Si el día predefinido fue desactivado por el admin, no es festivo
    if (isDisabledHoliday(date)) return false;

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const holidays = getHolidaysForYear(year);
    return holidays.has(monthDay) || isCustomHoliday(date);
}

// Verificar si es vacaciones de diciembre/enero
export function isVacationPeriod(date: Date): boolean {
    // Si este día de vacaciones fue desactivado por el admin, no es vacación
    if (isDisabledHoliday(date)) return false;

    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed (11 = Diciembre, 0 = Enero)
    const day = date.getDate();

    // ============================================
    // VACACIONES DE INVIERNO (ESPECÍFICAS)
    // ============================================

    // Ciclo 2025-2026: 19 de Dic 2025 al 7 de Ene 2026
    if (year === 2025 && month === 11 && day >= 19) return true;
    if (year === 2026 && month === 0 && day <= 7) return true;

    // Ciclo 2026-2027: 19 de Dic 2026 al 7 de Ene 2027
    if (year === 2026 && month === 11 && day >= 19) return true;
    if (year === 2027 && month === 0 && day <= 7) return true;

    // Ciclo 2027-2028: 18 de Dic 2027 al 6 de Ene 2028
    if (year === 2027 && month === 11 && day >= 18) return true;
    if (year === 2028 && month === 0 && day <= 6) return true;

    // Fallback genérico para años futuros (aprox del 20 de Dic al 6 de Ene)
    if (year > 2028) {
        if (month === 11 && day >= 20) return true;
        if (month === 0 && day <= 6) return true;
    }

    return false;
}

// Verificar si es día NO hábil para pagos
export function isNonPaymentDay(date: Date): boolean {
    return isHoliday(date) || isVacationPeriod(date);
}

// Verificar si es día válido para pago
export function isPaymentDay(date: Date): boolean {
    return !isNonPaymentDay(date);
}

// ============================================
// CÁLCULO DE FECHAS DE PAGO
// ============================================

// Obtener el siguiente día hábil para pago
export function getNextPaymentDay(date: Date, classDays?: number[]): Date {
    const result = new Date(date);

    while (!isPaymentDay(result) || (classDays && classDays.length > 0 && !classDays.includes(result.getDay()))) {
        result.setDate(result.getDate() + 1);
    }

    return result;
}

export function calculateNextPaymentDate(
    baseDate: Date | string,
    paymentScheme: PaymentScheme,
    classDays?: number[]
): Date {
    const base = typeof baseDate === 'string' ? new Date(baseDate) : new Date(baseDate);
    const days = SCHEME_DAYS[paymentScheme];

    // Sumar los días del esquema
    const nextDate = new Date(base);
    nextDate.setDate(nextDate.getDate() + days);

    // Si cae en día no válido, mover al siguiente día válido
    return getNextPaymentDay(nextDate, classDays);
}

// Generar secuencia de fechas de pago para un estudiante
export function generatePaymentSchedule(
    enrollmentDate: Date | string,
    paymentScheme: PaymentScheme,
    numberOfPeriods: number = 12,
    classDays?: number[]
): Date[] {
    const schedule: Date[] = [];

    // ✅ Parsear correctamente la fecha para evitar problemas de zona horaria
    let enrollment: Date;
    if (typeof enrollmentDate === 'string') {
        enrollment = new Date(enrollmentDate + 'T12:00:00');
    } else {
        enrollment = new Date(enrollmentDate);
    }
    enrollment.setHours(12, 0, 0, 0);

    const cycleDays = SCHEME_DAYS[paymentScheme];

    // El punto de partida es la fecha de inscripción
    let lastPaymentDate = new Date(enrollment);

    // El primer pago es el día de inscripción (ciclo 1)
    schedule.push(new Date(enrollment));

    for (let i = 0; i < numberOfPeriods - 1; i++) {
        // Paso 1: Calcular fecha base (último pago + N días calendario según esquema)
        const baseDate = new Date(lastPaymentDate);
        baseDate.setDate(lastPaymentDate.getDate() + cycleDays);

        // Paso 2: Contar cuántos feriados hay DENTRO de este período que caen en días de clase
        // Por cada día de clase perdido por festivo, se extiende el período sumando
        // días de clase hábiles después de la fecha base.
        // Ejemplo: Alumno Lun+Mar, inscrito Feb 16. Base = Mar 16.
        //   Festivos: Mar 10 (martes) + Mar 16 (lunes) = 2 días de clase perdidos.
        //   Avanzar 2 días de clase hábiles desde Mar 16:
        //     1) Mar 17 (martes, hábil) ✓
        //     2) Mar 23 (lunes, hábil) ✓
        //   Siguiente día de clase hábil = Mar 24 (martes) → fecha de pago.
        let holidaysInPeriod = 0;
        const checkDate = new Date(lastPaymentDate);

        // Array para guardar los feriados encontrados y mostrarlos en el log
        const foundHolidays: string[] = [];

        for (let d = 0; d < cycleDays; d++) {
            checkDate.setDate(checkDate.getDate() + 1);

            // Solo contar el día inhábil si cae en un día que el estudiante tiene clase
            // IMPORTANTE: usar isNonPaymentDay para incluir festivos Y vacaciones
            if (isNonPaymentDay(checkDate)) {
                const dayOfWeek = checkDate.getDay();
                if (!classDays || classDays.length === 0 || classDays.includes(dayOfWeek)) {
                    holidaysInPeriod++;
                    foundHolidays.push(checkDate.toISOString().split('T')[0]);
                }
            }
        }

        // Paso 3: Compensar días de clase perdidos.
        // Se buscan N días de clase hábiles después de la fecha base, donde N = festivos en el ciclo.
        // Los festivos encontrados DURANTE la búsqueda se SALTAN (no agregan más compensación).
        // Esos festivos se compensarán en el SIGUIENTE ciclo de pago.
        // Ejemplo: Alumno Lun+Jue, inscrito Feb 16. Base = Mar 16.
        //   Mar 16 (Lun, Natalicio) + Mar 12 (Jue, personalizado) = 2 días perdidos.
        //   Caminando: Mar 19 (Jue, hábil) = reposición 1, cuenta 2→1.
        //   Mar 23 (Lun, hábil) = reposición 2, cuenta 1→0 → PAGO = Mar 23. ✅
        let effectiveDate = new Date(baseDate);

        if (holidaysInPeriod > 0) {
            let compensationCount = holidaysInPeriod;
            const cursor = new Date(baseDate);

            // Caminar día a día buscando días de clase hábiles para compensar:
            //   - Si es festivo/vacaciones → saltar (se compensará en el siguiente ciclo)
            //   - Si es hábil y compensationCount > 0 → compensationCount--
            //   - Cuando compensationCount llega a 0 → ESE DÍA es la fecha de pago
            while (true) {
                cursor.setDate(cursor.getDate() + 1);
                const dow = cursor.getDay();
                const isClassDayCheck = !classDays || classDays.length === 0 || classDays.includes(dow);

                if (!isClassDayCheck) continue; // No es día de clase, saltar

                // Saltar días festivos/vacaciones (no cuentan ni agregan más compensación)
                if (!isPaymentDay(cursor)) continue;

                // Día de clase hábil: cuenta como compensación
                if (compensationCount > 0) {
                    compensationCount--;
                    if (compensationCount === 0) {
                        // La compensación se completó: ESTE día es la nueva fecha de pago
                        effectiveDate = new Date(cursor);
                        break;
                    }
                } else {
                    effectiveDate = new Date(cursor); // ¡PAGO!
                    break;
                }
            }
        }

        // Paso 4: Para el caso sin festivos: si la fecha base cae en vacaciones, feriado,
        // o no es día de clase, moverla al siguiente día válido
        const beforeShift = effectiveDate.getTime();
        effectiveDate = getNextPaymentDay(effectiveDate, classDays);
        const shifted = effectiveDate.getTime() !== beforeShift;

        // LOG PARA DEPURACIÓN
        console.log(`[Ciclo ${i + 1}] Del ${lastPaymentDate.toISOString().split('T')[0]} al ${baseDate.toISOString().split('T')[0]}`);
        if (foundHolidays.length > 0) {
            console.log(`   ⚠️ Feriados en días de clase: ${foundHolidays.join(', ')}`);
            console.log(`   🔄 Compensación encadenada aplicada`);
        } else {
            console.log(`   (Sin feriados en días de clase)`);
        }
        console.log(`   📅 Fecha Pago: ${effectiveDate.toISOString().split('T')[0]} ${shifted ? '(Desplazada por día inhábil)' : ''}`);
        console.log('-----------------------------------');

        schedule.push(effectiveDate);

        // El próximo ciclo empieza desde esta fecha efectiva
        lastPaymentDate = new Date(effectiveDate);
    }

    return schedule;
}

// ============================================
// FORMATEO DE FECHAS
// ============================================

const MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const MONTHS_ES_CAPS = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Formatear fecha en español
export function formatDateSpanish(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;
    return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Obtener nombre del mes
export function getMonthName(month: number, capitalize: boolean = true): string {
    const months = capitalize ? MONTHS_ES_CAPS : MONTHS_ES;
    return months[month - 1] || "";
}

// Helper para obtener la fecha exacta de un pago diario
function getDateForDailyPeriod(year: number, periodIndex: number): Date {
    return new Date(year, 0, periodIndex);
}

// Generar descripción del periodo según el esquema
export function getPeriodDescription(
    paymentScheme: PaymentScheme,
    periodNumber: number,
    year: number,
    enrollmentDate?: Date | string,
    classDays?: number[]
): string {
    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    // Esquemas continuos (usar fechas reales)
    if (['monthly_28', 'weekly', 'biweekly'].includes(paymentScheme) && enrollmentDate) {
        // Generar suficientes ciclos para encontrar el actual y el siguiente
        // periodNumber es base-1. Queremos el rango [periodNumber-1] a [periodNumber].
        const schedule = generatePaymentSchedule(enrollmentDate, paymentScheme, periodNumber + 2, classDays);

        const startDate = schedule[periodNumber - 1];
        const nextDate = schedule[periodNumber]; // Fecha del próximo pago

        if (startDate && nextDate) {
            const d1 = startDate.getDate();
            const m1 = MONTHS_ES_CAPS[startDate.getMonth()];

            const d2 = nextDate.getDate();
            const m2 = MONTHS_ES_CAPS[nextDate.getMonth()];

            const typeLabel = paymentScheme === 'weekly' ? 'semanal' : (paymentScheme === 'biweekly' ? 'catorcenal' : 'mensual');

            return `Pago ${typeLabel} del ${d1} de ${m1} al ${d2} de ${m2}. Próximo pago el ${d2} de ${m2}.`;
        }
    }

    switch (paymentScheme) {
        case "daily": {
            const date = getDateForDailyPeriod(year, periodNumber);
            const dayName = days[date.getDay()];
            const dayNum = date.getDate();
            const monthName = MONTHS_ES_CAPS[date.getMonth()];

            return `Pago del día ${dayName} ${dayNum} de ${monthName}`;
        }

        // Fallback para casos legacy sin enrollmentDate o errores
        case "weekly":
            return `Semana ${periodNumber} de ${year}`;

        case "biweekly": {
            const monthIndex = Math.floor((periodNumber - 1) / 2);
            const isFirstFortnight = (periodNumber % 2) !== 0;
            const monthName = MONTHS_ES_CAPS[monthIndex % 12];
            return isFirstFortnight
                ? `Pago catorcenal del día 1 al 14 de ${monthName}`
                : `Pago catorcenal del día 15 al final de ${monthName}`;
        }

        case "monthly_28":
        default:
            return `Mes de ${getMonthName(periodNumber)} ${year}`;
    }
}

// Calcular la próxima fecha de pago BASADA EN EL CALENDARIO REAL
export function calculateNextPaymentDateFromSchedule(
    enrollmentDate: Date | string,
    paymentScheme: PaymentScheme,
    paymentPeriod: number,
    paymentYear: number,
    classDays?: number[]
): Date {
    // Manejo especial para diario
    if (paymentScheme === 'daily') {
        const paidDate = getDateForDailyPeriod(paymentYear, paymentPeriod);
        const nextDay = new Date(paidDate);
        nextDay.setDate(nextDay.getDate() + 1);
        return getNextPaymentDay(nextDay, classDays);
    }

    // ✅ Parsear correctamente la fecha para evitar problemas de zona horaria
    let enrollment: Date;
    if (typeof enrollmentDate === 'string') {
        enrollment = new Date(enrollmentDate + 'T12:00:00');
    } else {
        enrollment = new Date(enrollmentDate);
    }

    // Lógica UNIFICADA para esquemas continuos (monthly_28, weekly, biweekly)
    if (['monthly_28', 'weekly', 'biweekly'].includes(paymentScheme)) {
        // paymentPeriod es el número de pago realizado (1 = inscripción, 2 = siguiente, ...)
        // El siguiente pago corresponde al índice `paymentPeriod` dentro del schedule (0-based).
        const cyclesPaid = Math.max(paymentPeriod, 0);

        // Generar schedule con un pequeño buffer para garantizar que exista el siguiente pago
        const schedule = generatePaymentSchedule(enrollment, paymentScheme, cyclesPaid + 5, classDays);

        const nextIndex = Math.min(cyclesPaid, schedule.length - 1);
        return schedule[nextIndex];
    }

    // Fallback para otros casos (no debería ocurrir con los tipos actuales)
    return new Date();
}

// ============================================
// CÁLCULO DE MONTOS
// ============================================

// Calcular el monto por periodo
export function getAmountPerPeriod(monthlyFee: number, paymentScheme: PaymentScheme): number {
    switch (paymentScheme) {
        case "daily":
            return Math.round((monthlyFee / 28) * 100) / 100;
        case "weekly":
            return Math.round((monthlyFee / 4) * 100) / 100;
        case "biweekly":
            return Math.round((monthlyFee / 2) * 100) / 100;
        case "monthly_28":
        default:
            return monthlyFee;
    }
}

// Obtener etiqueta del esquema
export function getSchemeLabel(paymentScheme: PaymentScheme): string {
    return SCHEME_LABELS[paymentScheme] || "Mensual";
}

// ============================================
// VERIFICACIÓN DE ADEUDOS
// ============================================

// Calcular cuántos periodos de adeudo tiene un estudiante
// SOLO devuelve periodos cuya fecha YA PASÓ (vencidos), NO los pendientes futuros
export function calculateOverduePeriods(
    enrollmentDate: Date | string,
    paymentScheme: PaymentScheme,
    paidPeriods: number[],
    classDays?: number[]
): { period: number; dueDate: Date }[] {
    // Usar zona horaria de México para determinar "hoy"
    const nowMexico = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    // Normalizar "hoy" a inicio del día para comparar solo fechas (sin hora)
    const todayStart = new Date(nowMexico.getFullYear(), nowMexico.getMonth(), nowMexico.getDate(), 0, 0, 0, 0);
    const overdue: { period: number; dueDate: Date }[] = [];

    if (paymentScheme === 'daily') {
        // ✅ Parsear correctamente la fecha
        let start: Date;
        if (typeof enrollmentDate === 'string') {
            start = new Date(enrollmentDate + 'T12:00:00');
        } else {
            start = new Date(enrollmentDate);
        }
        start.setHours(12, 0, 0, 0);

        let current = new Date(start);

        // Solo considerar adeudos de días que YA PASARON (estrictamente antes de hoy)
        while (current < todayStart) {
            if (classDays && classDays.includes(current.getDay()) && isPaymentDay(current)) {
                const startYear = new Date(current.getFullYear(), 0, 0);
                const diff = current.getTime() - startYear.getTime();
                const oneDay = 1000 * 60 * 60 * 24;
                const dayOfYear = Math.floor(diff / oneDay);

                if (!paidPeriods.includes(dayOfYear) && dayOfYear > 0) {
                    overdue.push({ period: dayOfYear, dueDate: new Date(current) });
                }
            }
            current.setDate(current.getDate() + 1);
        }
        return overdue;

    } else {
        // ✅ Parsear correctamente la fecha
        let enrollment: Date;
        if (typeof enrollmentDate === 'string') {
            enrollment = new Date(enrollmentDate + 'T12:00:00');
        } else {
            enrollment = new Date(enrollmentDate);
        }
        enrollment.setHours(12, 0, 0, 0);

        const schedule = generatePaymentSchedule(enrollment, paymentScheme, 24, classDays);

        schedule.forEach((dueDate, index) => {
            let periodNumber = index + 1;

            // Normalizar dueDate a solo fecha (sin hora) para comparación justa
            const dueDateNormalized = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), 0, 0, 0, 0);

            // Solo marcar como adeudo si la fecha de vencimiento YA PASÓ
            // (estrictamente antes de hoy, NO incluye el día de hoy ni futuros)
            if (dueDateNormalized < todayStart && !paidPeriods.includes(periodNumber)) {
                overdue.push({ period: periodNumber, dueDate });
            }
        });
        return overdue;
    }
}

// Generar mensaje de adeudos para el correo
export function generateDebtMessage(
    overduePeriods: { period: number; dueDate: Date }[],
    paymentScheme: PaymentScheme,
    year: number,
    enrollmentDate?: Date | string,
    classDays?: number[]
): string {
    if (overduePeriods.length === 0) {
        return "";
    }

    const descriptions = overduePeriods.map(p => {
        const periodDescription = getPeriodDescription(paymentScheme, p.period, year, enrollmentDate, classDays);
        const dueDateStr = formatDateSpanish(p.dueDate);
        return `• ${periodDescription} (vencido el ${dueDateStr})`;
    });

    return `Tienes ${overduePeriods.length} adeudo(s) vencido(s):\n${descriptions.join('\n')}`;
}