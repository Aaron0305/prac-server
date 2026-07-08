-- ============================================
-- MIGRACIÓN: TABLA CUSTOM_HOLIDAYS
-- Días festivos personalizados por el admin
-- ============================================

CREATE TABLE IF NOT EXISTS custom_holidays (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL DEFAULT 'Día festivo personalizado',
    created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para búsquedas por fecha
CREATE INDEX IF NOT EXISTS idx_custom_holidays_date ON custom_holidays(date);
