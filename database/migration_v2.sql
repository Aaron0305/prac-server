-- ============================================
-- MIGRACIÓN V2: SOPORTE PARA PAGOS DIARIOS Y DÍAS DE CLASE
-- ============================================

-- 1. Agregar columna class_days a la tabla students
-- Almacena un array de enteros (0=Dom, 1=Lun, etc.)
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS class_days INTEGER[];

-- 2. Modificar constraint de la tabla payments
-- El esquema diario usa el día del año (1-366) como "mes", por lo que
-- necesitamos ampliar el rango permitido en la columna 'month'.

-- Intentar eliminar la constraint existente (el nombre puede variar, verifica en tu DB si falla)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_month_check;

-- Agregar la nueva constraint con rango ampliado
ALTER TABLE payments 
ADD CONSTRAINT payments_month_check CHECK (month >= 1 AND month <= 366);
