-- ============================================
-- MIGRACIÓN: PAGOS DE LIBROS
-- ============================================

-- 1. Eliminar el constraint actual de month (que solo permite >= 1 o >= 0 depending on current implementation)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_month_check;

-- 2. Crear nuevo constraint que permita -1 (libro), 0 (inscripción), y 1+ (mensualidades)
ALTER TABLE payments ADD CONSTRAINT payments_month_check CHECK (month >= -1);

-- 3. Agregar columna para descripción del concepto de libro (opcional)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS book_description VARCHAR(255);

-- 4. Índice para filtrar pagos de libros rápidamente
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(payment_type) WHERE payment_type IS NOT NULL;
