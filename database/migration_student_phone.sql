-- ============================================
-- MIGRACIÓN: Agregar teléfono del alumno
-- ============================================
-- Ejecutar en Supabase SQL Editor

-- Agregar columna para teléfono del alumno
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS student_phone VARCHAR(20);

-- ¡Listo! Ahora puedes guardar el teléfono del estudiante
