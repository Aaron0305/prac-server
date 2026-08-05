-- ============================================================
-- MIGRACIÓN: Búsqueda Híbrida RRF (Reciprocal Rank Fusion)
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ──────────────────────────────────────────────
-- PASO 1: Agregar columna tsvector para Full Text Search
-- ──────────────────────────────────────────────
ALTER TABLE knowledge_embeddings 
ADD COLUMN IF NOT EXISTS content_tsv tsvector;

-- ──────────────────────────────────────────────
-- PASO 2: Poblar content_tsv con los datos existentes
-- Usa configuración 'spanish' para stemming en español
-- Pondera el contenido principal como peso A (máxima prioridad)
-- y los topics de metadata como peso B
-- ──────────────────────────────────────────────
UPDATE knowledge_embeddings 
SET content_tsv = 
    setweight(to_tsvector('spanish', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(metadata->>'sectionTitle', '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(
        array_to_string(
            ARRAY(SELECT jsonb_array_elements_text(
                CASE WHEN metadata ? 'topics' AND jsonb_typeof(metadata->'topics') = 'array'
                     THEN metadata->'topics'
                     ELSE '[]'::jsonb
                END
            )),
            ' '
        ), 
        ''
    )), 'B');

-- ──────────────────────────────────────────────
-- PASO 3: Crear índice GIN para búsqueda ultra rápida
-- ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_knowledge_content_tsv 
ON knowledge_embeddings USING gin(content_tsv);

-- ──────────────────────────────────────────────
-- PASO 4: Trigger para auto-actualizar content_tsv
-- en cada INSERT o UPDATE
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_content_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_tsv := 
        setweight(to_tsvector('spanish', coalesce(NEW.content, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.metadata->>'sectionTitle', '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(
            array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(
                    CASE WHEN NEW.metadata ? 'topics' AND jsonb_typeof(NEW.metadata->'topics') = 'array'
                         THEN NEW.metadata->'topics'
                         ELSE '[]'::jsonb
                    END
                )),
                ' '
            ), 
            ''
        )), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger existente si existe (para poder recrearlo)
DROP TRIGGER IF EXISTS trg_update_content_tsv ON knowledge_embeddings;

CREATE TRIGGER trg_update_content_tsv
BEFORE INSERT OR UPDATE ON knowledge_embeddings
FOR EACH ROW EXECUTE FUNCTION update_content_tsv();

-- ──────────────────────────────────────────────
-- PASO 5: Función RPC Hybrid Search con Reciprocal Rank Fusion (RRF)
-- Combina:
--   1. Búsqueda Vectorial Densa (coseno via pgvector)
--   2. Búsqueda Léxica Full Text Search (ts_rank con ponderación)
-- Usando RRF: score = 1/(k + rank_vector) + 1/(k + rank_fts)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hybrid_search_rrf(
    query_text text,
    query_embedding vector(384),
    match_count int DEFAULT 10,
    rrf_k int DEFAULT 60,
    similarity_threshold float DEFAULT 0.15
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    similarity float,
    fts_rank float,
    rrf_score float
)
LANGUAGE sql STABLE
AS $$
    WITH
    -- Búsqueda vectorial (semántica): top N resultados por similitud coseno
    vector_search AS (
        SELECT 
            ke.id,
            ke.content,
            ke.metadata,
            1 - (ke.embedding <=> query_embedding) AS similarity,
            ROW_NUMBER() OVER (ORDER BY ke.embedding <=> query_embedding) AS rank_ix
        FROM knowledge_embeddings ke
        WHERE 1 - (ke.embedding <=> query_embedding) > similarity_threshold
        ORDER BY ke.embedding <=> query_embedding
        LIMIT match_count * 3
    ),
    -- Búsqueda Full Text Search (léxica): top N resultados por ts_rank
    fts_search AS (
        SELECT 
            ke.id,
            ke.content,
            ke.metadata,
            ts_rank_cd(ke.content_tsv, websearch_to_tsquery('spanish', query_text), 32) AS fts_rank,
            ROW_NUMBER() OVER (
                ORDER BY ts_rank_cd(ke.content_tsv, websearch_to_tsquery('spanish', query_text), 32) DESC
            ) AS rank_ix
        FROM knowledge_embeddings ke
        WHERE ke.content_tsv @@ websearch_to_tsquery('spanish', query_text)
        ORDER BY fts_rank DESC
        LIMIT match_count * 3
    ),
    -- Combinar ambos rankings con Reciprocal Rank Fusion
    combined AS (
        SELECT
            COALESCE(vs.id, fs.id) AS id,
            COALESCE(vs.content, fs.content) AS content,
            COALESCE(vs.metadata, fs.metadata) AS metadata,
            COALESCE(vs.similarity, 0.0) AS similarity,
            COALESCE(fs.fts_rank, 0.0) AS fts_rank,
            -- RRF Score: combina ambos rankings
            COALESCE(1.0 / (rrf_k + vs.rank_ix), 0.0) +
            COALESCE(1.0 / (rrf_k + fs.rank_ix), 0.0) AS rrf_score
        FROM vector_search vs
        FULL OUTER JOIN fts_search fs ON vs.id = fs.id
    )
    SELECT 
        combined.id,
        combined.content,
        combined.metadata,
        combined.similarity::float,
        combined.fts_rank::float,
        combined.rrf_score::float
    FROM combined
    ORDER BY combined.rrf_score DESC
    LIMIT match_count;
$$;

-- ──────────────────────────────────────────────
-- PASO 6: Verificación — contar registros con tsvector poblado
-- ──────────────────────────────────────────────
SELECT 
    COUNT(*) AS total_registros,
    COUNT(content_tsv) AS con_tsv_poblado,
    COUNT(*) - COUNT(content_tsv) AS sin_tsv
FROM knowledge_embeddings;
