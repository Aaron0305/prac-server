-- ============================================
-- MIGRACIÓN: Actualizar niveles de 3 a 6
-- ============================================
-- Ejecutar este script en el SQL Editor de Supabase
-- ANTES de usar la nueva versión de la aplicación

-- 1. Primero, eliminar la constraint CHECK existente
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_level_check;

-- 2. Actualizar los valores existentes a los nuevos niveles (agregar " 1" al final)
UPDATE students SET level = 'Beginner 1' WHERE level = 'Beginner';
UPDATE students SET level = 'Intermediate 1' WHERE level = 'Intermediate';
UPDATE students SET level = 'Advanced 1' WHERE level = 'Advanced';

-- 3. Agregar la nueva constraint CHECK con los 6 niveles
ALTER TABLE students ADD CONSTRAINT students_level_check 
    CHECK (level IN ('Beginner 1', 'Beginner 2', 'Intermediate 1', 'Intermediate 2', 'Advanced 1', 'Advanced 2'));

-- ============================================
-- ¡MIGRACIÓN COMPLETA!
-- ============================================
-- Los estudiantes existentes ahora tienen niveles "X 1"
-- Puedes editarlos manualmente si deseas cambiarlos a "X 2"
