-- ============================================
-- MIGRACIÓN: POS products (costo y ganancia)
-- Objetivo:
--   Guardar el costo real y la ganancia por unidad para poder
--   calcular utilidades históricas correctamente.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================

ALTER TABLE pos_products
ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS profit_margin NUMERIC(10, 2);

-- Defaults suaves (evita nulls en UI si hay registros viejos)
UPDATE pos_products
SET cost_price = COALESCE(cost_price, price),
    profit_margin = COALESCE(profit_margin, GREATEST(price - COALESCE(cost_price, price), 0))
WHERE cost_price IS NULL OR profit_margin IS NULL;
