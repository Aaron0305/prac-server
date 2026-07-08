-- ========================================================
-- MIGRACIÓN: PERMITIR MÚLTIPLES LIBROS Y PAGOS DIARIOS
-- ========================================================
-- Este script remueve la restricción de unicidad para evitar
-- conflictos (duplicate key) cuando un alumno compra varios libros
-- o realiza múltiples abonos en el mismo período/año.
-- 
-- Ejecutar en el SQL Editor de Supabase si la tabla aún lo exige.
-- ========================================================

ALTER TABLE payments 
DROP CONSTRAINT IF EXISTS payments_student_id_month_year_key;
