-- Agregar columnas para Soft Delete en pagos
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS voided_by TEXT;

-- Índice para mejorar velocidad de filtrado de pagos activos
CREATE INDEX IF NOT EXISTS idx_payments_active ON payments(is_active) WHERE is_active = TRUE;
