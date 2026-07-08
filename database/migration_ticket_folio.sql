-- ============================================
-- MIGRACIÓN: FOLIO DE TICKET PARA PAGOS
-- ============================================
-- Agrega un campo ticket_folio a la tabla payments
-- El folio es secuencial por día (se reinicia cada día: 1, 2, 3...)
-- Permite generar tickets con número de folio para corte de caja

-- Agregar columna ticket_folio
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ticket_folio INTEGER;

-- Índice para buscar folios por fecha (para calcular el siguiente folio del día)
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
