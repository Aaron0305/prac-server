-- ==============================================================================
-- MIGRACIÓN: CORREGIR RELACIÓN (FOREIGN KEY) EN CHAT_MESSAGES
-- ==============================================================================
-- Ejecutar en el SQL Editor de Supabase
-- Esto evitará que queden mensajes "huérfanos" si eliminas un maestro.
-- ==============================================================================

-- 1. Primero, debemos convertir la columna actual de TEXTO a UUID
-- (Usamos USING para decirle a la base de datos cómo castear los textos existentes)
ALTER TABLE public.chat_messages 
ALTER COLUMN teacher_id SET DATA TYPE UUID USING teacher_id::uuid;

-- 2. Ahora sí podemos agregar el "candado" o Foreign Key real.
-- ON DELETE CASCADE significa que si borras al maestro, se borran sus chats.
ALTER TABLE public.chat_messages
ADD CONSTRAINT chat_messages_teacher_id_fkey 
FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
