-- ============================================
-- MIGRACIÓN: Agregar método de pago (Efectivo / Transferencia)
-- ============================================
-- Ejecutar en el SQL Editor de Supabase

-- Agregar columna payment_method a la tabla payments
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'efectivo'
CHECK (payment_method IN ('efectivo', 'transferencia'));

-- Comentario: Los valores posibles son:
-- 'efectivo' = Pago en efectivo
-- 'transferencia' = Pago por transferencia bancaria
