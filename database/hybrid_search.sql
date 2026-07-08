-- ============================================================
-- BÚSQUEDA HÍBRIDA + FILTRO DIRECTO POR PÁGINA/UNIDAD
-- Si detecta page_filter o unit_filter, hace lookup directo en metadata
-- Si no, hace búsqueda RRF (Semántica + Keywords con OR)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

DROP INDEX IF EXISTS idx_knowledge_fts;
DROP INDEX IF EXISTS idx_knowledge_metadata;

CREATE INDEX idx_knowledge_fts
  ON knowledge_embeddings USING GIN (to_tsvector('simple', content));

CREATE INDEX idx_knowledge_metadata
  ON knowledge_embeddings USING GIN (metadata);

CREATE OR REPLACE FUNCTION hybrid_search_knowledge (
  query_embedding vector(384),
  query_text text,
  match_threshold float,
  match_count int,
  page_filter int DEFAULT NULL,
  unit_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  vector_weight  float := 1.0;
  fts_weight     float := 1.5;
  rrf_k          int   := 60;
  internal_limit int   := match_count * 5;
  fts_query      tsquery;
BEGIN
  -- RUTA RÁPIDA: Si viene page_filter, lookup directo por metadata
  IF page_filter IS NOT NULL THEN
    RETURN QUERY
    SELECT
      ke.id, ke.content, ke.metadata, 1.0::float AS similarity
    FROM knowledge_embeddings ke
    WHERE (ke.metadata->>'pageNumber')::int = page_filter
    ORDER BY (ke.metadata->>'chunkIndex')::int ASC
    LIMIT match_count;
    RETURN;
  END IF;

  -- RUTA RÁPIDA: Si viene unit_filter, lookup directo por metadata  
  IF unit_filter IS NOT NULL THEN
    RETURN QUERY
    SELECT
      ke.id, ke.content, ke.metadata, 1.0::float AS similarity
    FROM knowledge_embeddings ke
    WHERE ke.metadata->>'unit' ILIKE '%' || unit_filter || '%'
    ORDER BY (ke.metadata->>'pageNumber')::int ASC, (ke.metadata->>'chunkIndex')::int ASC
    LIMIT match_count;
    RETURN;
  END IF;

  -- RUTA NORMAL: Búsqueda híbrida RRF (semántica + keywords OR)
  fts_query := to_tsquery('simple',
    regexp_replace(plainto_tsquery('simple', query_text)::text, ' & ', ' | ', 'g')
  );

  RETURN QUERY
  WITH vector_search AS (
    SELECT ke.id, ke.content, ke.metadata,
      ROW_NUMBER() OVER (ORDER BY ke.embedding <=> query_embedding) as rank
    FROM knowledge_embeddings ke
    WHERE 1 - (ke.embedding <=> query_embedding) > match_threshold
    LIMIT internal_limit
  ),
  keyword_search AS (
    SELECT ke.id, ke.content, ke.metadata,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(to_tsvector('simple', ke.content), fts_query) DESC
      ) as rank
    FROM knowledge_embeddings ke
    WHERE to_tsvector('simple', ke.content) @@ fts_query
    LIMIT internal_limit
  )
  SELECT
    COALESCE(vs.id, ks.id),
    COALESCE(vs.content, ks.content),
    COALESCE(vs.metadata, ks.metadata),
    (
      COALESCE(1.0 / (rrf_k + vs.rank), 0.0) * vector_weight +
      COALESCE(1.0 / (rrf_k + ks.rank), 0.0) * fts_weight
    )::float
  FROM vector_search vs
  FULL OUTER JOIN keyword_search ks ON vs.id = ks.id
  ORDER BY 4 DESC
  LIMIT match_count;
END;
$$;
