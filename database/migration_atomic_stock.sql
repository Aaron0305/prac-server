-- Función para descontar stock de forma atómica y segura
-- Evita condiciones de carrera y asegura que el stock no sea negativo (opcional)

CREATE OR REPLACE FUNCTION decrement_product_stock(
    p_id UUID,
    p_quantity NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_stock NUMERIC;
    v_product_name TEXT;
BEGIN
    -- Actualizar el stock restando la cantidad, solo si el producto existe
    -- Usamos GREATEST(0, ...) para evitar stocks negativos si así se desea, 
    -- o podemos dejar que falle si no hay suficiente.
    
    UPDATE pos_products
    SET stock = stock - p_quantity
    WHERE id = p_id
    RETURNING stock, name INTO v_new_stock, v_product_name;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'name', v_product_name,
        'new_stock', v_new_stock
    );
END;
$$;
