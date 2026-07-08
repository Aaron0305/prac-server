-- ============================================
-- MIGRACIÓN: AGREGAR CAMPO is_disabled A custom_holidays
-- Permite desactivar días festivos predefinidos
-- ============================================

-- Agregar columna is_disabled (por defecto false = es un festivo agregado)
-- Cuando es true = es un festivo predefinido que fue desactivado
ALTER TABLE custom_holidays ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false;

-- Eliminar restricción UNIQUE actual en date (si existe) y recrearla
-- Esto permite tener tanto festivos personalizados como desactivaciones
-- La restricción UNIQUE se mantiene porque solo puede haber una entrada por fecha
