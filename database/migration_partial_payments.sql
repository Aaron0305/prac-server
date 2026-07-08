-- ============================================
-- MIGRACIÓN: SISTEMA DE PAGOS PARCIALES
-- ============================================
-- Ejecutar este script en el SQL Editor de Supabase
-- https://supabase.com/dashboard/project/TU_PROYECTO/sql

-- ============================================
-- 1. AGREGAR CAMPOS PARA PAGOS PARCIALES
-- ============================================

-- Monto esperado (cuánto debería pagar)
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS amount_expected DECIMAL(10, 2);

-- Actualizar registros existentes para que amount_expected = amount
UPDATE payments SET amount_expected = amount WHERE amount_expected IS NULL;

-- Ahora hacer el campo NOT NULL con default
ALTER TABLE payments 
ALTER COLUMN amount_expected SET DEFAULT 0;

-- Monto pendiente (cuánto le falta por pagar)
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS amount_pending DECIMAL(10, 2) DEFAULT 0;

-- Porcentaje pagado (0-100)
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS payment_percentage INTEGER DEFAULT 100;

-- Campo confirmed_by si no existe (quién confirmó el pago)
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(255);

-- ============================================
-- 2. CREAR TRIGGER PARA CALCULAR AUTOMÁTICAMENTE
-- ============================================

-- Función que calcula el porcentaje y monto pendiente
CREATE OR REPLACE FUNCTION calculate_payment_percentage()
RETURNS TRIGGER AS $$
BEGIN
    -- Si no hay amount_expected, usar amount como referencia
    IF NEW.amount_expected IS NULL OR NEW.amount_expected = 0 THEN
        NEW.amount_expected := NEW.amount;
    END IF;
    
    -- Calcular monto pendiente
    NEW.amount_pending := GREATEST(NEW.amount_expected - NEW.amount, 0);
    
    -- Calcular porcentaje (evitar división por cero)
    IF NEW.amount_expected > 0 THEN
        NEW.payment_percentage := ROUND((NEW.amount::DECIMAL / NEW.amount_expected::DECIMAL) * 100);
    ELSE
        NEW.payment_percentage := 100;
    END IF;
    
    -- Si el porcentaje es >= 100, el pago está completo
    IF NEW.payment_percentage >= 100 THEN
        NEW.payment_percentage := 100;
        NEW.amount_pending := 0;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS trigger_calculate_payment_percentage ON payments;

-- Crear el trigger
CREATE TRIGGER trigger_calculate_payment_percentage
    BEFORE INSERT OR UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION calculate_payment_percentage();

-- ============================================
-- 3. ACTUALIZAR REGISTROS EXISTENTES
-- ============================================

-- Actualizar todos los pagos existentes para calcular los campos
UPDATE payments SET 
    amount_expected = COALESCE(amount_expected, amount),
    amount_pending = 0,
    payment_percentage = 100
WHERE status = 'paid';

UPDATE payments SET 
    amount_expected = COALESCE(amount_expected, amount),
    amount_pending = COALESCE(amount_expected, amount),
    payment_percentage = 0
WHERE status IN ('pending', 'overdue');

-- ============================================
-- 4. ÍNDICE PARA BUSCAR PAGOS PARCIALES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_payments_partial 
ON payments(payment_percentage) 
WHERE payment_percentage < 100 AND status = 'paid';

-- ============================================
-- ¡MIGRACIÓN COMPLETA!
-- ============================================
-- Los campos nuevos son:
--   - amount_expected: monto que debería pagar el estudiante
--   - amount: monto que realmente pagó
--   - amount_pending: cuánto le falta (amount_expected - amount)
--   - payment_percentage: porcentaje pagado (0-100)
-- ============================================
