-- ============================================
-- ENGLISH LEARNING ACADEMY - DATABASE SCHEMA
-- ============================================
-- Ejecutar este script en el SQL Editor de Supabase
-- https://supabase.com/dashboard/project/TU_PROYECTO/sql

-- ============================================
-- 1. TABLA: ADMINISTRADORES
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para búsquedas por email
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

-- ============================================
-- 2. TABLA: ESTUDIANTES
-- ============================================
CREATE TABLE IF NOT EXISTS students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    emergency_phone VARCHAR(20),
    level VARCHAR(20) NOT NULL CHECK (level IN ('Beginner 1', 'Beginner 2', 'Intermediate 1', 'Intermediate 2', 'Advanced 1', 'Advanced 2')),
    monthly_fee DECIMAL(10, 2) NOT NULL DEFAULT 500.00,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at DATE,
    last_access TIMESTAMP WITH TIME ZONE
);

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
CREATE INDEX IF NOT EXISTS idx_students_student_number ON students(student_number);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- ============================================
-- 3. TABLA: PAGOS
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'overdue')),
    paid_at DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, month, year)
);

-- Índice para búsquedas por estudiante
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ============================================
-- 4. DATOS INICIALES - SUPER ADMIN
-- ============================================
-- Password: super123 (hash generado con bcrypt)
INSERT INTO admins (name, email, password_hash, role, status)
VALUES (
    'Super Administrador',
    'superadmin@test.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.h1uDv/rxKrWGdO',
    'superadmin',
    'active'
) ON CONFLICT (email) DO NOTHING;

-- Password: admin123 (hash generado con bcrypt)
INSERT INTO admins (name, email, password_hash, role, status)
VALUES (
    'Administrador',
    'admin@test.com',
    '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'admin',
    'active'
) ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 5. DATOS DE EJEMPLO - ESTUDIANTES
-- ============================================
INSERT INTO students (student_number, name, email, level, monthly_fee, status, expires_at)
VALUES 
    ('2024001', 'María García López', 'maria@email.com', 'Intermediate 1', 600, 'active', '2025-01-15'),
    ('2024002', 'Juan Pérez Rodríguez', 'juan@email.com', 'Beginner 1', 500, 'active', '2025-02-20'),
    ('2024003', 'Ana Martínez Silva', 'ana@email.com', 'Advanced 1', 700, 'active', '2025-03-10')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 6. DATOS DE EJEMPLO - PAGOS
-- ============================================
-- Nota: Primero necesitamos obtener los IDs de los estudiantes
DO $$
DECLARE
    maria_id UUID;
    juan_id UUID;
    ana_id UUID;
BEGIN
    SELECT id INTO maria_id FROM students WHERE email = 'maria@email.com';
    SELECT id INTO juan_id FROM students WHERE email = 'juan@email.com';
    SELECT id INTO ana_id FROM students WHERE email = 'ana@email.com';
    
    -- Pagos de María
    INSERT INTO payments (student_id, month, year, amount, status, paid_at)
    VALUES (maria_id, 1, 2025, 600, 'paid', '2025-01-05')
    ON CONFLICT (student_id, month, year) DO NOTHING;
    
    INSERT INTO payments (student_id, month, year, amount, status, paid_at)
    VALUES (maria_id, 2, 2025, 600, 'paid', '2025-02-03')
    ON CONFLICT (student_id, month, year) DO NOTHING;
    
    -- Pagos de Juan
    INSERT INTO payments (student_id, month, year, amount, status, paid_at)
    VALUES (juan_id, 1, 2025, 500, 'paid', '2025-01-10')
    ON CONFLICT (student_id, month, year) DO NOTHING;
    
    -- Pagos de Ana
    INSERT INTO payments (student_id, month, year, amount, status, paid_at)
    VALUES (ana_id, 1, 2025, 700, 'paid', '2025-01-08')
    ON CONFLICT (student_id, month, year) DO NOTHING;
    
    INSERT INTO payments (student_id, month, year, amount, status, paid_at)
    VALUES (ana_id, 2, 2025, 700, 'paid', '2025-02-06')
    ON CONFLICT (student_id, month, year) DO NOTHING;
END $$;

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS) - Opcional pero recomendado
-- ============================================
-- Habilitar RLS en las tablas
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir todas las operaciones desde el service_role
CREATE POLICY "Service role can do everything on admins" ON admins
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything on students" ON students
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything on payments" ON payments
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- ¡LISTO! Tu base de datos está configurada
-- ============================================

-- ============================================
-- AGREGAR TELÉFONO DE EMERGENCIA
-- ============================================
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(20);

-- ============================================
-- QUITAR EXPIRACIÓN (hacer opcional)
-- ============================================
ALTER TABLE students 
ALTER COLUMN expires_at DROP NOT NULL;

-- ============================================
-- 8. SISTEMA DE PAGOS AVANZADO
-- ============================================
-- Múltiples esquemas de pago, pagos parciales, días festivos

-- Esquema de pago del estudiante (diario, semanal, catorcenal, 28 días)
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS payment_scheme VARCHAR(20) NOT NULL DEFAULT 'monthly_28' 
CHECK (payment_scheme IN ('daily', 'weekly', 'biweekly', 'monthly_28'));

-- Fecha de inscripción (para calcular ciclos de pago)
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- ============================================
-- 9. TABLA: PERIODOS DE PAGO
-- ============================================
-- Soporta pagos parciales y tracking de adeudos

CREATE TABLE IF NOT EXISTS payment_periods (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    
    -- Fechas del periodo
    period_start DATE NOT NULL,           -- Inicio del periodo
    period_end DATE NOT NULL,             -- Fin del periodo
    due_date DATE NOT NULL,               -- Fecha límite de pago
    
    -- Montos
    expected_amount DECIMAL(10,2) NOT NULL,  -- Monto que debería pagar
    paid_amount DECIMAL(10,2) DEFAULT 0,     -- Monto que ha pagado
    remaining_amount DECIMAL(10,2) GENERATED ALWAYS AS (expected_amount - paid_amount) STORED,
    
    -- Estado del pago
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('paid', 'partial', 'pending', 'overdue')),
    
    -- Fechas de registro
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Un estudiante no puede tener dos periodos con la misma fecha de inicio
    UNIQUE(student_id, period_start)
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_payment_periods_student_id ON payment_periods(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_periods_status ON payment_periods(status);
CREATE INDEX IF NOT EXISTS idx_payment_periods_due_date ON payment_periods(due_date);

-- ============================================
-- 10. TABLA: DÍAS FESTIVOS DE MÉXICO
-- ============================================

CREATE TABLE IF NOT EXISTS holidays (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);

-- Días festivos oficiales 2025
INSERT INTO holidays (holiday_date, name, year) VALUES
    ('2025-01-01', 'Año Nuevo', 2025),
    ('2025-02-03', 'Día de la Constitución', 2025),
    ('2025-03-17', 'Natalicio de Benito Juárez', 2025),
    ('2025-04-17', 'Jueves Santo', 2025),
    ('2025-04-18', 'Viernes Santo', 2025),
    ('2025-05-01', 'Día del Trabajo', 2025),
    ('2025-09-16', 'Día de la Independencia', 2025),
    ('2025-11-17', 'Revolución Mexicana', 2025),
    ('2025-12-25', 'Navidad', 2025)
ON CONFLICT (holiday_date) DO NOTHING;

-- Días festivos oficiales 2026
INSERT INTO holidays (holiday_date, name, year) VALUES
    ('2026-01-01', 'Año Nuevo', 2026),
    ('2026-02-02', 'Día de la Constitución', 2026),
    ('2026-03-16', 'Natalicio de Benito Juárez', 2026),
    ('2026-04-02', 'Jueves Santo', 2026),
    ('2026-04-03', 'Viernes Santo', 2026),
    ('2026-05-01', 'Día del Trabajo', 2026),
    ('2026-09-16', 'Día de la Independencia', 2026),
    ('2026-11-16', 'Revolución Mexicana', 2026),
    ('2026-12-25', 'Navidad', 2026)
ON CONFLICT (holiday_date) DO NOTHING;

-- Días festivos oficiales 2027
INSERT INTO holidays (holiday_date, name, year) VALUES
    ('2027-01-01', 'Año Nuevo', 2027),
    ('2027-02-01', 'Día de la Constitución', 2027),
    ('2027-03-15', 'Natalicio de Benito Juárez', 2027),
    ('2027-03-25', 'Jueves Santo', 2027),
    ('2027-03-26', 'Viernes Santo', 2027),
    ('2027-05-01', 'Día del Trabajo', 2027),
    ('2027-09-16', 'Día de la Independencia', 2027),
    ('2027-11-15', 'Revolución Mexicana', 2027),
    ('2027-12-25', 'Navidad', 2027)
ON CONFLICT (holiday_date) DO NOTHING;

-- Vacaciones de diciembre (16-31) - 2025
INSERT INTO holidays (holiday_date, name, year) 
SELECT date::date, 'Vacaciones de Diciembre', 2025
FROM generate_series('2025-12-16'::date, '2025-12-31'::date, '1 day'::interval) AS date
ON CONFLICT (holiday_date) DO NOTHING;

-- Vacaciones de diciembre (16-31) - 2026
INSERT INTO holidays (holiday_date, name, year) 
SELECT date::date, 'Vacaciones de Diciembre', 2026
FROM generate_series('2026-12-16'::date, '2026-12-31'::date, '1 day'::interval) AS date
ON CONFLICT (holiday_date) DO NOTHING;

-- Vacaciones de diciembre (16-31) - 2027
INSERT INTO holidays (holiday_date, name, year) 
SELECT date::date, 'Vacaciones de Diciembre', 2027
FROM generate_series('2027-12-16'::date, '2027-12-31'::date, '1 day'::interval) AS date
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================
-- 11. RLS PARA NUEVAS TABLAS
-- ============================================

ALTER TABLE payment_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can do everything on payment_periods" ON payment_periods
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything on holidays" ON holidays
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 12. FUNCIÓN: ACTUALIZAR STATUS AUTOMÁTICO
-- ============================================

CREATE OR REPLACE FUNCTION update_payment_period_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.paid_amount >= NEW.expected_amount THEN
        NEW.status := 'paid';
    ELSIF NEW.paid_amount > 0 AND NEW.paid_amount < NEW.expected_amount THEN
        NEW.status := 'partial';
    ELSIF NEW.due_date < CURRENT_DATE AND NEW.paid_amount = 0 THEN
        NEW.status := 'overdue';
    ELSE
        NEW.status := 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_payment_status ON payment_periods;
CREATE TRIGGER trigger_update_payment_status
    BEFORE INSERT OR UPDATE ON payment_periods
    FOR EACH ROW
    EXECUTE FUNCTION update_payment_period_status();

-- ============================================
-- ¡MIGRACIÓN COMPLETA!
-- ============================================