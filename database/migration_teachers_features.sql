-- ==============================================================================
-- MIGRACIÓN: FUNCIONALIDADES DE TEACHER (HORARIOS Y ASIGNACIÓN DE ESTUDIANTES)
-- ==============================================================================
-- Ejecutar en el SQL Editor de Supabase
-- ==============================================================================

-- 1. Agregar asignación de maestro a estudiantes
-- (Relación 1 a N: Un estudiante pertenece a un maestro específico)
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL;

-- 2. Agregar horario interactivo directamente a la tabla del maestro
-- (Guardamos el horario como un arreglo JSON estructurado para mayor flexibilidad)
ALTER TABLE public.teachers
ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '[]'::jsonb;

-- 3. Crear índice para acelerar las búsquedas de estudiantes por maestro
CREATE INDEX IF NOT EXISTS idx_students_teacher_id ON public.students(teacher_id);
