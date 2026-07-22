import { pipeline } from '@huggingface/transformers';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// ─────────────────────────────────────────────
//  CONFIGURACIÓN CENTRAL — ajusta aquí sin tocar la lógica
// ─────────────────────────────────────────────
const CONFIG = {
  START_PAGE: 5,     // Página real del PDF donde comienza el contenido útil (solicitado desde hoja 5)
  CHUNK_SIZE: 500,   // ↑ Aumentado de 200 → 500 palabras para más contexto por fragmento
  CHUNK_OVERLAP: 80,    // ↑ Aumentado de 30 → 80 palabras de solapamiento para no perder contexto entre fragmentos
  MIN_CHUNK_CHARS: 80,    // Mínimo de caracteres para considerar un chunk válido
  MAX_NOISE_RATIO: 0.15,  // Si más del 15% son símbolos raros → fragmento corrupto, se descarta
  BATCH_SIZE: 20,    // Fragmentos que se insertan en Supabase por llamada
  MODEL: 'Supabase/gte-small', // Modelo nativo de Supabase Edge Functions
  TABLE: 'knowledge_embeddings',
};

// ─────────────────────────────────────────────
//  VARIABLES DE ENTORNO
// ─────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(' Error: Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─────────────────────────────────────────────
//  DETECTAR PDF AUTOMÁTICAMENTE
// ─────────────────────────────────────────────
const BOOK_DIR = path.join(__dirname);
const files = fs.readdirSync(BOOK_DIR);
const pdfFileName = files.find(f => f.toLowerCase().endsWith('.pdf'));

if (!pdfFileName) {
  console.error(' No se encontró ningún archivo .pdf en la carpeta lib/Book.');
  process.exit(1);
}

const PDF_PATH = path.join(BOOK_DIR, pdfFileName);
console.log(` Archivo PDF detectado: ${pdfFileName}`);

// ─────────────────────────────────────────────
//  LIMPIEZA DE TEXTO
//  Elimina ruido común del OCR y fuentes corruptas
// ─────────────────────────────────────────────
function cleanText(raw: string): string {
  return raw
    // Normaliza saltos de línea de Windows
    .replace(/\r\n/g, '\n')
    // Elimina líneas que son SOLO símbolos decorativos/basura (bullets del libro)
    // NOTA: No eliminamos líneas que contengan letras o números
    .replace(/^[\s~•\-_\/\\|'`.,:;!@#$%^&*()]{3,}$/gm, '')
    // Colapsa espacios internos múltiples
    .replace(/[ \t]{2,}/g, ' ')
    // Une palabras partidas por guión al final de línea (OCR muy común en PDFs)
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // ELIMINADO: Las regex /\b(\w) (\w)\b/g que unían letras individuales destruían
    // abreviaturas técnicas válidas ("A *", "O(n)", siglas como "I A", etc.)
    // Colapsa líneas vacías múltiples en máximo dos
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────
//  DETECCIÓN DE FRAGMENTO CORRUPTO
//  Si más del MAX_NOISE_RATIO son caracteres no alfanuméricos raros → basura
// ─────────────────────────────────────────────
function isCorrupted(text: string): boolean {
  const total = text.length;
  if (total === 0) return true;

  // Cuenta caracteres que NO son: letras, números, espacios, puntuación normal
  const noiseChars = (text.match(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ\s.,;:!?'"()\-\/\n]/g) || []).length;
  const ratio = noiseChars / total;

  return ratio > CONFIG.MAX_NOISE_RATIO;
}

// ─────────────────────────────────────────────
//  EXTRACCIÓN DE TEXTO DESDE PDF (Preservando Páginas)
//  Comienza desde START_PAGE, ignora páginas con error
// ─────────────────────────────────────────────
interface PageData {
  text: string;
  pageNum: number;
}
async function extractTextFromPDF(filePath: string): Promise<PageData[]> {
  console.log(`   Cargando PDF con pdfjs-dist...`);

  const data = new Uint8Array(fs.readFileSync(filePath));

  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
    cMapUrl: undefined,
    cMapPacked: false,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  console.log(`   PDF cargado: ${numPages} páginas totales.`);
  console.log(`     Saltando páginas 1–${CONFIG.START_PAGE - 1} (índice/prefacio).`);
  console.log(`    Extrayendo desde la página ${CONFIG.START_PAGE}...\n`);

  const pagesData: PageData[] = [];
  let errorCount = 0;
  let skippedPages = 0;

  for (let pageNum = CONFIG.START_PAGE; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: { str?: string }) => item.str || '')
        .join(' ');

      // Si la página entera parece corrupta, la omitimos
      if (isCorrupted(pageText)) {
        skippedPages++;
        continue;
      }

      pagesData.push({ text: pageText, pageNum });

    } catch (pageError) {
      errorCount++;
      if (errorCount <= 5) {
        console.warn(`    Página ${pageNum} con error: ${(pageError as Error).message?.slice(0, 60)}`);
      }
    }

    if (pageNum % 20 === 0) {
      process.stdout.write(`\r   Leyendo páginas: ${pageNum}/${numPages}...`);
    }
  }

  console.log(`\n    Extracción completa.`);
  console.log(`      - Páginas con error:    ${errorCount}`);
  console.log(`      - Páginas corruptas omitidas: ${skippedPages}`);

  return pagesData.map(p => ({ text: cleanText(p.text), pageNum: p.pageNum }));
}

// ─────────────────────────────────────────────
//  CHUNKING CON OVERLAP (Reteniendo página)
//  Respeta contexto entre fragmentos consecutivos
// ─────────────────────────────────────────────
interface ChunkData {
  text: string;
  pageNum: number;
}

// ─────────────────────────────────────────────
//  DETECCIÓN DE TEMA/SECCIÓN DENTRO DEL CHUNK
// ─────────────────────────────────────────────
const TOPIC_PATTERNS: [RegExp, string][] = [
  [/\b(agente[s]?|agent[s]?)\b/i, 'Agentes'],
  [/\b(búsqueda|busqueda|search|heurístic[ao]|heuristic[s]?|a\*)\b/i, 'Búsqueda'],
  [/\b(conocimiento|lógica|logica|knowledge|logic)\b/i, 'Conocimiento y Lógica'],
  [/\b(razonamiento|probabilidad|bayes|inferencia)\b/i, 'Razonamiento'],
  [/\b(planificación|planificacion|planning)\b/i, 'Planificación'],
  [/\b(aprendizaje|learning|machine learning|supervisado)\b/i, 'Aprendizaje Automático'],
  [/\b(redes neuronales|neural networks|deep learning|aprendizaje profundo)\b/i, 'Redes Neuronales'],
  [/\b(procesamiento del lenguaje|pln|nlp|lenguaje natural)\b/i, 'Lenguaje Natural'],
  [/\b(visión|vision|percepción|percepcion)\b/i, 'Visión y Percepción'],
  [/\b(robótica|robotica|robotics)\b/i, 'Robótica'],
  [/\b(ética|etica|philosophy|filosofía)\b/i, 'Ética y Filosofía'],
];

function detectTopics(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, label] of TOPIC_PATTERNS) {
    if (pattern.test(text) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found;
}

function chunkTextWithOverlap(pages: PageData[]): ChunkData[] {
  const allChunks: ChunkData[] = [];
  for (const page of pages) {
    const words = page.text.split(/\s+/).filter(w => w.length > 0);
    let i = 0;

    while (i < words.length) {
      const end = Math.min(i + CONFIG.CHUNK_SIZE, words.length);
      const chunkText = words.slice(i, end).join(' ');
      allChunks.push({ text: chunkText, pageNum: page.pageNum });
      i += CONFIG.CHUNK_SIZE - CONFIG.CHUNK_OVERLAP;
    }
  }
  return allChunks;
}

// ─────────────────────────────────────────────
//  VERIFICAR DUPLICADOS EN SUPABASE
//  Consulta si ya existe data del mismo archivo fuente
// ─────────────────────────────────────────────
async function checkForDuplicates(source: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(CONFIG.TABLE)
    .select('id')
    .contains('metadata', { source })
    .limit(1);

  if (error) {
    console.warn('    No se pudo verificar duplicados:', error.message);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

// ─────────────────────────────────────────────
//  BORRAR REGISTROS ANTERIORES DEL MISMO ARCHIVO
// ─────────────────────────────────────────────
async function deletePreviousRecords(source: string): Promise<void> {
  const { error } = await supabase
    .from(CONFIG.TABLE)
    .delete()
    .contains('metadata', { source });

  if (error) {
    throw new Error(`No se pudieron borrar registros anteriores: ${error.message}`);
  }
}

// ─────────────────────────────────────────────
//  INSERCIÓN EN LOTES CON RETRY
//  Reintenta hasta 3 veces si hay error de red
// ─────────────────────────────────────────────
async function insertBatch(rows: object[], maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { error } = await supabase.from(CONFIG.TABLE).insert(rows);
    if (!error) return;

    if (attempt === maxRetries) {
      throw new Error(`Error al insertar lote después de ${maxRetries} intentos: ${error.message}`);
    }
    console.warn(`    Reintento ${attempt}/${maxRetries} por error: ${error.message}`);
    await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
  }
}

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('==============================================');
  console.log(' INGESTIÓN RAG — INTELIGENCIA ARTIFICIAL    ');
  console.log('==============================================\n');

  // 1. Cargar modelo
  console.log(`1. Cargando modelo de embeddings: ${CONFIG.MODEL}`);
  console.log('   (Primera vez puede tardar ~2 minutos descargando el modelo)\n');
  const extractor = await pipeline('feature-extraction', CONFIG.MODEL);
  console.log('    Modelo listo.\n');

  // 2. Verificar PDF
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Archivo PDF no encontrado en: ${PDF_PATH}`);
  }

  // 3. Verificar duplicados
  console.log('2. Verificando si ya existe data de este archivo en Supabase...');
  const alreadyExists = await checkForDuplicates(pdfFileName);

  if (alreadyExists) {
    console.log(`     Se encontraron registros previos de "${pdfFileName}".`);
    console.log('     Borrando registros anteriores para evitar duplicados...');
    await deletePreviousRecords(pdfFileName);
    console.log('    Registros anteriores eliminados.\n');
  } else {
    console.log('    Sin duplicados. Continuando...\n');
  }

  // 4. Extraer texto
  console.log('3. Extrayendo texto del PDF...');
  const pagesData = await extractTextFromPDF(PDF_PATH);

  const totalChars = pagesData.reduce((acc, p) => acc + p.text.length, 0);
  if (totalChars < 500) {
    console.error('\n Se extrajo muy poco texto. El PDF puede estar severamente dañado.');
    process.exit(1);
  }
  console.log(`    Texto limpio listo: ${totalChars.toLocaleString()} caracteres en ${pagesData.length} páginas.\n`);

  // 5. Chunkear
  console.log('4. Dividiendo en fragmentos con overlap (preservando páginas y secciones)...');
  const rawChunks = chunkTextWithOverlap(pagesData);

  // Filtrar chunks cortos o corruptos y añadir CONTEXTO DE CAPÍTULO, SECCIÓN Y PÁGINA IMPRESA
  let currentUnitContext = "General / Intro";
  let currentSectionContext = "";
  let currentPrintedPage = 1;

  const chunks = rawChunks
    .filter(c => {
      const trimmed = c.text.trim();
      return trimmed.length >= CONFIG.MIN_CHUNK_CHARS && !isCorrupted(trimmed);
    })
    .map(c => {
      // DETECCIÓN DE PÁGINA IMPRESA REAL (ej. encabezado/pie de página)
      const pageHeaderMatch = c.text.match(/\b([1-9]\d{1,3})\s+(?:INTEGLENCIA|INTELIGENCIA|REPRESENTACIÓN|REPRESENTACION|BÚSQUEDA|BUSQUEDA|CAPÍTULO|CAPITULO)\b/i)
        || c.text.match(/\b(?:INTEGLENCIA|INTELIGENCIA|REPRESENTACIÓN|REPRESENTACION|BÚSQUEDA|BUSQUEDA)\b.{0,30}\b([1-9]\d{1,3})\b/i);
      
      if (pageHeaderMatch) {
        const pNum = parseInt(pageHeaderMatch[1]);
        if (pNum >= 1 && pNum <= 1300) {
          currentPrintedPage = pNum;
        }
      } else {
        // Estimación aproximada si no hay encabezado explícito (PDF suele tener ~25 páginas de índice/prefacio)
        currentPrintedPage = Math.max(1, c.pageNum - 25);
      }

      // DETECCIÓN DE CAPÍTULO O UNIDAD
      const chapterMatch = c.text.match(/\b(CAPÍTULO|Capítulo|Capitulo|CHAPTER|Chapter|UNIDAD|Unidad|UNIT|Unit)\s+(\d{1,2})\b/);
      if (chapterMatch) {
        const num = parseInt(chapterMatch[2]);
        if (num >= 1 && num <= 30) {
          currentUnitContext = `Capítulo ${num}`;
        }
      }

      // DETECCIÓN DE SECCIONES EXACTAS (ej: 10.1, 10.2, 10.5, 10.7)
      const sectionMatches = c.text.match(/\b(\d{1,2}\.\d{1,2})\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ\s,:-]{3,50})/g);
      const sectionsFound: string[] = [];
      if (sectionMatches) {
        for (const sm of sectionMatches) {
          const secNum = sm.match(/\d{1,2}\.\d{1,2}/)?.[0];
          if (secNum && !sectionsFound.includes(secNum)) {
            sectionsFound.push(secNum);
            currentSectionContext = secNum;
          }
        }
      }
      
      // Detectar temas de Inteligencia Artificial en el fragmento
      const topics = detectTopics(c.text);

      return {
        text: `[Unit: ${currentUnitContext}] [Section: ${currentSectionContext || 'N/A'}] [PrintedPage: ${currentPrintedPage}] [PageNum: ${c.pageNum}] ${c.text.trim()}`,
        pageNum: c.pageNum,
        printedPage: currentPrintedPage,
        unit: currentUnitContext,
        sections: sectionsFound,
        currentSection: currentSectionContext,
        topics
      };
    });

  console.log(`    Fragmentos generados: ${rawChunks.length}`);
  console.log(`    Fragmentos válidos (limpios): ${chunks.length}`);
  console.log(`     Fragmentos descartados (corruptos/cortos): ${rawChunks.length - chunks.length}\n`);

  // 6. Generar embeddings e insertar en lotes
  console.log('5. Generando embeddings e insertando en Supabase...\n');

  let successCount = 0;
  let batchBuffer: object[] = [];
  const startTime = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Generar embedding
    const output = await extractor(chunk.text, { pooling: 'mean', normalize: true });
    const embeddingArray = Array.from(output.data as Float32Array);

    batchBuffer.push({
      content: chunk.text,
      embedding: embeddingArray,
      metadata: {
        source: pdfFileName,
        chunkIndex: i,
        pageNumber: chunk.pageNum,
        printedPage: chunk.printedPage,
        unit: chunk.unit,
        section: chunk.currentSection,
        sections: chunk.sections,
        topics: chunk.topics
      },
    });

    // Cuando el buffer llega al tamaño del lote, insertamos
    if (batchBuffer.length >= CONFIG.BATCH_SIZE || i === chunks.length - 1) {
      await insertBatch(batchBuffer);
      successCount += batchBuffer.length;
      batchBuffer = [];

      // Progreso con estimación de tiempo restante
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = successCount / elapsed;
      const remaining = Math.ceil((chunks.length - successCount) / rate);
      process.stdout.write(
        `\r   Progreso: ${successCount}/${chunks.length} fragmentos` +
        ` | ${Math.round((successCount / chunks.length) * 100)}%` +
        ` | ~${remaining}s restantes   `
      );
    }
  }

  // 7. Verificación post-ingestión
  console.log('\n\n6. Verificando datos en Supabase...');
  const { count } = await supabase
    .from(CONFIG.TABLE)
    .select('*', { count: 'exact', head: true })
    .contains('metadata', { source: pdfFileName });

  // 8. Resumen final
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n==========================================`);
  console.log(` INGESTIÓN COMPLETADA`);
  console.log(`==========================================`);
  console.log(`   Archivo:             ${pdfFileName}`);
  console.log(`   Página de inicio:    ${CONFIG.START_PAGE}`);
  console.log(`   Fragmentos enviados: ${successCount}`);
  console.log(`   Fragmentos en DB:    ${count ?? 'N/A'}`);
  console.log(`   Modelo usado:        ${CONFIG.MODEL}`);
  console.log(`   Tiempo total:        ${totalTime}s`);

  if (count && count >= successCount) {
    console.log(`\n ¡Verificación exitosa! Todos los fragmentos están en Supabase.`);
  } else {
    console.warn(`\n Posible discrepancia: se enviaron ${successCount} pero la DB reporta ${count}.`);
  }
}

main().catch(err => {
  console.error('\n Error fatal:');
  console.error(err);
  process.exit(1);
});