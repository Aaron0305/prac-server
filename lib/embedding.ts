import { pipeline } from '@huggingface/transformers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorInstance: any = null;
let isInitializing = false;

async function getExtractor() {
    if (extractorInstance) return extractorInstance;

    if (isInitializing) {
        // Esperar a que la inicialización actual termine
        while (isInitializing) {
            await new Promise(r => setTimeout(r, 100));
        }
        return extractorInstance;
    }

    isInitializing = true;
    try {
        extractorInstance = await pipeline('feature-extraction', 'Supabase/gte-small');
    } catch (err) {
        console.warn("⚠️ Error cargando modelo ONNX en caché. Reintentando carga limpia...", err);
        // Reintento de carga en caso de descarga parcial o error de caché protobuf
        try {
            extractorInstance = await pipeline('feature-extraction', 'Supabase/gte-small');
        } catch (retryErr) {
            console.error("❌ Fallo definitivo cargando modelo de embeddings:", retryErr);
            extractorInstance = null;
        }
    } finally {
        isInitializing = false;
    }

    return extractorInstance;
}

/**
 * Genera el vector embedding (384 dimensiones) para una consulta de texto
 * en Node.js usando el modelo nativo Supabase/gte-small.
 */
export async function getQueryEmbedding(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    if (!extractor) {
        throw new Error("El modelo de embeddings no está disponible en este momento.");
    }
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
}
