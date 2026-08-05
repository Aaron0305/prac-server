import { pipeline } from '@huggingface/transformers';

// Inicializar y pre-cargar el modelo 'Supabase/gte-small' en el arranque del servidor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractorPromise: Promise<any> = pipeline('feature-extraction', 'Supabase/gte-small').catch(err => {
    console.error("Error pre-cargando modelo de embeddings en servidor:", err);
    return null;
});

/**
 * Genera el vector embedding (384 dimensiones) para una consulta de texto
 * en Node.js usando el modelo nativo Supabase/gte-small.
 */
export async function getQueryEmbedding(text: string): Promise<number[]> {
  const extractor = await extractorPromise;
  if (!extractor) {
      throw new Error("El modelo de embeddings no pudo cargarse.");
  }
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}
