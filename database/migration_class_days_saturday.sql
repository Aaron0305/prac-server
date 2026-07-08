
-- Actualizar todos los estudiantes que no tengan class_days asignados
UPDATE students 
SET class_days = ARRAY[6]
WHERE class_days IS NULL OR class_days = '{}';

-- Verificar el resultado
SELECT id, name, class_days FROM students ORDER BY name;
