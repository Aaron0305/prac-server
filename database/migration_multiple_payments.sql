-- ============================================
-- MIGRACIÓN: Permitir múltiples pagos por período
-- ============================================
-- 
-- PROBLEMA: El constraint UNIQUE en (student_id, month, year) 
-- impide guardar pagos parciales en diferentes fechas.
--
-- SOLUCIÓN: Eliminar el constraint para permitir múltiples
-- registros de pago por período (ej: $200 lunes, $560 viernes)
--
-- EJECUTAR EN SUPABASE SQL EDITOR:
-- ============================================

-- 1. Eliminar el constraint único existente
ALTER TABLE payments 
DROP CONSTRAINT IF EXISTS payments_student_id_month_year_key;

-- 2. Verificar que se eliminó (debería devolver 0 filas)
SELECT conname 
FROM pg_constraint 
WHERE conrelid = 'payments'::regclass 
AND contype = 'u';

-- ============================================
-- NOTAS IMPORTANTES:
-- ============================================
-- 
-- Después de esta migración:
-- - Se pueden guardar MÚLTIPLES pagos para el mismo período
-- - Cada pago tiene su propia fecha (paid_at)
-- - Los reportes diarios mostrarán cada pago individual
-- - El GET /api/payments consolidará los pagos por período para la UI
-- - El GET /api/payments?raw=true devolverá pagos individuales
--
-- ============================================
