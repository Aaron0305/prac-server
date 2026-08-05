import { pipeline } from '@huggingface/transformers';

// Singleton para cargar el modelo 'Supabase/gte-small' en memoria una sola vez
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorPromise: Promise<any> | null = null;

/**
 * Genera el vector embedding (384 dimensiones) para una consulta de texto
 * en Node.js usando el modelo nativo Supabase/gte-small.
 */
export async function getQueryEmbedding(text: string): Promise<number[]> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Supabase/gte-small');
  }
  const extractor = await extractorPromise;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}
