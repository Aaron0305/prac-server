import { NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import Groq from "groq-sdk";

import { createClient } from "@supabase/supabase-js";
import { franc } from "franc";
import { Redis } from "@upstash/redis";

// ============================================================
// TIPOS
// ============================================================
interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

interface RequestBody {
    message: string;
    historyContext?: ChatMessage[];
    teacherId?: string;
}

interface KnowledgeFragment {
    content: string;
    similarity: number;
    metadata?: {
        source?: string;
        chunkIndex?: number;
        startPage?: number;
        pageNumber?: number;
        unit?: string;
        topics?: string[];
    };
}

interface RagContext {
    fragments: Array<{
        page?: number;
        unit?: string;
        topics?: string[];
        similarity: number;
        contentPreview: string;
    }>;
    totalFragments: number;
    queryMode: "page" | "unit" | "hybrid";
}

// ============================================================
// CONFIGURACIÓN CENTRAL
// ============================================================
const CONFIG = {
    model: "llama-3.3-70b-versatile",
    rag: {
        matchThreshold: 0.08,
        matchCountDefault: 8,
        matchCountExtended: 12,
        matchCountPage: 15,
    },
    limits: {
        maxMessageLength: 2000,
        maxHistoryMessages: 10,
        requestTimeoutMs: 45_000,
        embeddingTimeoutMs: 8_000,
        rateLimitWindow: 60,
        rateLimitMaxReqs: 20,
    },
} as const;

// ============================================================
// RATE LIMITER (Upstash Redis + fallback memoria)
// ============================================================
let _redis: Redis | null = null;

function getRedis(): Redis | null {
    if (_redis) return _redis;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    _redis = new Redis({ url, token });
    return _redis;
}

async function isRateLimited(ip: string): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return isRateLimitedInMemory(ip);
    try {
        const key = `rl:${ip}`;
        const current = await redis.incr(key);
        if (current === 1) await redis.expire(key, CONFIG.limits.rateLimitWindow);
        return current > CONFIG.limits.rateLimitMaxReqs;
    } catch {
        log("warn", "Redis", "Redis no disponible, usando fallback en memoria");
        _redis = null;
        return isRateLimitedInMemory(ip);
    }
}

const ipRequestLog = new Map<string, number[]>();

function isRateLimitedInMemory(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - CONFIG.limits.rateLimitWindow * 1000;
    const requests = (ipRequestLog.get(ip) ?? []).filter(t => t > windowStart);
    requests.push(now);
    ipRequestLog.set(ip, requests);
    return requests.length > CONFIG.limits.rateLimitMaxReqs;
}

setInterval(() => {
    const cutoff = Date.now() - CONFIG.limits.rateLimitWindow * 1000;
    for (const [ip, times] of ipRequestLog.entries()) {
        const valid = times.filter(t => t > cutoff);
        if (valid.length === 0) ipRequestLog.delete(ip);
        else ipRequestLog.set(ip, valid);
    }
}, 5 * 60_000);

// Embeddings moved to Supabase Edge Functions

// ============================================================
// MÉTRICAS
// ============================================================
const metrics = {
    totalRequests: 0,
    totalErrors: 0,
    latencies: [] as number[],
    lastErrorAt: null as Date | null,
    lastErrorMsg: "",
};

function recordLatency(ms: number) {
    metrics.latencies.push(ms);
    if (metrics.latencies.length > 50) metrics.latencies.shift();
}

function avgLatency(): number {
    if (metrics.latencies.length === 0) return 0;
    return Math.round(metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length);
}

// ============================================================
// LOGGER
// ============================================================
type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, context: string, message: string, extra?: unknown) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        context,
        message,
        ...(extra !== undefined ? { extra } : {}),
    };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.info(JSON.stringify(entry));
}

// ============================================================
// DETECCIÓN DE IDIOMA
// ============================================================
function detectLanguage(text: string): "es" | "en" | "auto" {
    if (text.trim().length < 20) return "auto";
    const code = franc(text, { minLength: 10, only: ["spa", "eng"] });
    if (code === "spa") return "es";
    if (code === "eng") return "en";
    return "auto";
}

// ============================================================
// DETECCIÓN DE TIPO DE PREGUNTA
// ← CAMBIO: "page" es su propio tipo para tratarlo diferente
// ============================================================
type QuestionType = "simple" | "complex" | "page";

function detectQuestionType(message: string): QuestionType {
    // Incluye variantes con typos comunes: pragina, pagna, pagia, pagian
    const pageWordPattern = /\b(?:page|p[aá]ginas?|paginas?|pr[aá]ginas?|pag[ia]nas?|p\.?|pg\.?)\s*\d+/i;
    const pageContextPattern = /\b(?:qu[eé]|qu[eé] hay|qu[eé] dice|qu[eé] sale|qu[eé] contiene|muestra|dame|ve)\b.{0,30}\b\d{2,4}\b/i;
    if (pageWordPattern.test(message) || pageContextPattern.test(message)) return "page";

    const complexKeywords = [
        "plan de clase", "planificacion", "examen", "evaluacion", "actividades para",
        "ejercicios para", "como ensenar", "estrategia", "unidad completa", "semana",
        "genera", "crea", "disena", "elabora",
        "lesson plan", "exam", "test", "quiz", "activities for", "how to teach",
        "full lesson", "generate", "create", "design",
        "explica detalladamente", "describe en detalle", "compara", "diferencias entre",
        "ventajas y desventajas", "resume el capitulo",
    ];
    const lower = message.toLowerCase();
    return complexKeywords.some(k => lower.includes(k)) ? "complex" : "simple";
}

// ============================================================
// MENSAJES DE SEGUIMIENTO
// ============================================================
function isFollowUpMessage(message: string): boolean {
    const hasReference = /\b(?:page|p[aá]gina|unit|unidad|lesson)\s*\d/i.test(message);
    if (hasReference) return false;

    const followUpPatterns = [
        /^d[ií]me(lo)?\b/i, /^expl[ií]ca(me|lo)?\b/i, /^rep[ií]te(lo)?\b/i,
        /^en (ingl[eé]s|espa[nñ]ol)\b/i, /^trad[uú]ce/i, /^m[aá]s detalle/i,
        /^contin[uú]a/i, /^sigue\b/i, /^y (qu[eé]|c[oó]mo)\b/i,
        /^pero\b/i, /^entonces\b/i, /^ahora\b/i,
        /^tell me (more|again|in)/i, /^explain (more|again|it)/i,
        /^repeat/i, /^in (english|spanish)/i, /^translate/i,
        /^continue/i, /^go on/i, /^what about/i, /^and (what|how)/i,
        /^now\b/i, /^also\b/i, /^but\b/i,
    ];
    const isShort = message.trim().split(/\s+/).length <= 6;
    return followUpPatterns.some(p => p.test(message.trim())) || isShort;
}

// ============================================================
// EXTRACCIÓN DE KEYWORDS
// ============================================================
// ============================================================
// NORMALIZADOR Y CORRECTOR DE CONSULTAS (Resiliencia ante typos)
// ============================================================
function extractSectionNumbers(message: string): string[] {
    const sections: string[] = [];
    const regex = /\b(?:punto|subtema|secci[oó]n|sec\.?)\s*(\d{1,2}\.\d{1,2})\b|\b(\d{1,2}\.\d{1,2})\b/gi;
    let m;
    while ((m = regex.exec(message)) !== null) {
        const sec = m[1] || m[2];
        if (sec && !sections.includes(sec)) sections.push(sec);
    }
    return sections;
}

function normalizeUserQuery(message: string): { cleanQuery: string; detectedPages: number[]; detectedSections: string[] } {
    let text = message.toLowerCase().trim();

    // 1. Correcciones de typos comunes en páginas ("pafg 84", "pagian 84", "pragina 84")
    text = text.replace(/\b(pafg|pagian|pagna|pagia|pragina|praginas|pag\.?|pgs?\.?)\b/g, "pagina");

    // 2. Corrección de faltas de ortografía comunes en conceptos de IA
    const typoDictionary: [RegExp, string][] = [
        [/\bunm\s+neourna\b|\bneourna\b|\bneournas\b|\bneurna\b|\bneuronas?\b/gi, "neuronas redes neuronales"],
        [/\bbusqueda\s+a\b|\ba\*\b|\ba\s+estrella\b/gi, "búsqueda a* heurística"],
        [/\bagente\s+reactivo\b|\bagentes\s+reactivos\b/gi, "agentes reactivos reflejos"],
        [/\blogica\s+de\s+primer\s+orden\b|\bfol\b/gi, "lógica de primer orden"],
        [/\bproposicional\b|\btabla\s+de\s+verdad\b/gi, "lógica proposicional"],
        [/\bbayes\b|\bmarcov\b|\bmarkov\b/gi, "redes bayesianas markov"],
    ];

    let cleanQuery = text;
    for (const [regex, replacement] of typoDictionary) {
        if (regex.test(text)) {
            cleanQuery += " " + replacement;
        }
    }

    // 3. Extracción de páginas y secciones
    const detectedPages: number[] = [];
    const pageMatches = text.match(/\b(?:pagina|p)\s*(\d{1,4})\b/g);
    if (pageMatches) {
        for (const m of pageMatches) {
            const num = m.match(/\d+/);
            if (num) detectedPages.push(parseInt(num[0]));
        }
    }
    if (detectedPages.length === 0) {
        const isolatedNum = text.match(/\b(?:dice|trata|hay|ver|contenido|que|sale|en)\b.{0,15}\b(\d{1,4})\b/i);
        if (isolatedNum) detectedPages.push(parseInt(isolatedNum[1]));
    }

    const detectedSections = extractSectionNumbers(message);

    return {
        cleanQuery: [...new Set(cleanQuery.split(/\s+/))].join(" "),
        detectedPages: [...new Set(detectedPages)],
        detectedSections
    };
}

function extractStructuralKeywords(message: string): string {
    const { cleanQuery, detectedPages } = normalizeUserQuery(message);
    const keywords: string[] = [];

    for (const p of detectedPages) {
        keywords.push(`PageNum ${p}`);
    }

    const chapterPatterns = [/\b(?:capitulo|chapter|cap|unit|unidad)\s*(\d+)/gi, /\bc(\d{1,2})\b/gi];
    for (const pattern of chapterPatterns) {
        let m;
        while ((m = pattern.exec(message)) !== null) keywords.push(`Capítulo ${m[1]}`);
    }

    const topicKeywords: [RegExp, string][] = [
        [/\b(?:agente|agentes|agent)\b/i, "agentes"],
        [/\b(?:búsqueda|busqueda|search|heurística|a\*)\b/i, "búsqueda"],
        [/\b(?:conocimiento|lógica|logica|knowledge)\b/i, "conocimiento"],
        [/\b(?:razonamiento|probabilidad|bayes)\b/i, "razonamiento"],
        [/\b(?:planificación|planificacion|planning)\b/i, "planificación"],
        [/\b(?:aprendizaje|learning|machine learning|neurona|redes)\b/i, "aprendizaje redes neuronales"],
        [/\b(?:procesamiento del lenguaje|pln|nlp)\b/i, "lenguaje natural"],
        [/\b(?:visión|vision|percepción)\b/i, "visión"],
        [/\b(?:robótica|robotica|robotics)\b/i, "robótica"],
    ];
    for (const [pattern, keyword] of topicKeywords) {
        if (pattern.test(cleanQuery)) keywords.push(keyword);
    }

    return keywords.length > 0 ? keywords.join(" ") : cleanQuery;
}

function extractPageNumbers(message: string): number[] {
    const pages: number[] = [];
    // Acepta variantes con typos: pagina, pragina, pagna, pagia, pagian, etc.
    const regex = /\b(?:pages?|p[r]?[aá]g(?:in[ao]|i|an)?s?|p\.?|pgs?\.?)\s*((?:\d+(?:\s*[,y]\s*|\s+e\s+|\s+and\s+|\s*-\s*)?)+)/gi;
    let m;
    while ((m = regex.exec(message)) !== null) {
        const numbers = m[1].match(/\d+/g);
        if (numbers) numbers.forEach(n => pages.push(parseInt(n)));
    }
    // Fallback: si la query es tipo "que dice la [typo] 84" captura el numero solo
    if (pages.length === 0) {
        const fallback = message.match(/\b(?:p[r]?[aá]g(?:in[ao]|i|an)?s?|pagian|pagna|pagia|pragina|praginas)\s+(\d+)/i);
        if (fallback) pages.push(parseInt(fallback[1]));
    }
    return [...new Set(pages)];
}

function extractUnitNumber(message: string): string | null {
    const m = message.match(/\b(?:cap[ií]tulo|capitulo|chapter|unit|unidad)\s*(\d+)/i);
    if (m && parseInt(m[1]) >= 1 && parseInt(m[1]) <= 30) return `Capítulo ${m[1]}`;
    return null;
}

function isGreetingMessage(message: string): boolean {
    const clean = message.trim().toLowerCase().replace(/[¡!¿?,.]/g, "");
    const greetingWords = [
        "hola", "hola buenas", "hola buenas noches", "buenas noches", "buenos dias", "buenas tardes",
        "saludos", "hey", "hola como estas", "quien eres", "quien eres tu", "que puedes hacer",
        "gracias", "muchas gracias", "ok", "okey", "entendido", "perfecto"
    ];
    return greetingWords.includes(clean) || (clean.length <= 15 && (clean.startsWith("hola") || clean.startsWith("buenas") || clean.startsWith("gracias")));
}

// ============================================================
// RAG — búsqueda de contexto
// ============================================================
async function fetchRelevantContext(
    query: string,
    questionType: QuestionType
): Promise<{ contextText: string; ragContext: RagContext }> {
    const start = Date.now();

    // SALUDOS / CORTESÍA: Saltar RAG y embeddings por completo
    if (isGreetingMessage(query)) {
        return {
            contextText: "",
            ragContext: { fragments: [], totalFragments: 0, queryMode: "hybrid" }
        };
    }

    const normalized = normalizeUserQuery(query);
    const pageNumbers = normalized.detectedPages.length > 0 ? normalized.detectedPages : extractPageNumbers(query);
    const sectionTargeted = normalized.detectedSections.length > 0;
    const isMultiPage = pageNumbers.length > 1;
    const isPageTargeted = pageNumbers.length > 0;
    const unitFilter = isPageTargeted || sectionTargeted ? null : extractUnitNumber(query);

    const matchCount = questionType === "page" ? CONFIG.rag.matchCountPage
        : questionType === "complex" ? CONFIG.rag.matchCountExtended
            : CONFIG.rag.matchCountDefault;

    const matchThreshold = questionType === "page" || isMultiPage ? 0.05 : CONFIG.rag.matchThreshold;
    const queryMode: RagContext["queryMode"] = isPageTargeted ? "page" : unitFilter ? "unit" : "hybrid";
    const supabase = getSupabaseClient();

    let allFragments: KnowledgeFragment[] = [];

    // BÚSQUEDA DIRECTA POR SECCIÓN (ej. 10.5, 10.7)
    if (sectionTargeted) {
        const secPromises = normalized.detectedSections.map(async secNum => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { section: secNum })
                .limit(matchCount);

            if (!error && data && data.length > 0) {
                return data.map((row: { content: string; metadata?: KnowledgeFragment['metadata'] }) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            // Fallback: Buscar en el arreglo de secciones
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: arrayData } = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { sections: [secNum] })
                .limit(matchCount);

            if (arrayData && arrayData.length > 0) {
                return arrayData.map((row: { content: string; metadata?: KnowledgeFragment['metadata'] }) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            return [];
        });

        const secResults = await Promise.all(secPromises);
        for (const fragments of secResults) {
            allFragments.push(...fragments);
        }
    }

    // BÚSQUEDA DIRECTA POR PÁGINA IMPRESA O NÚMERO DE PÁGINA
    if (isPageTargeted && allFragments.length === 0) {
        const promises = pageNumbers.map(async pageNum => {
            // 1. Buscar por printedPage (página impresa real del libro ej: 391)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const printedRes = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { printedPage: pageNum })
                .limit(matchCount);

            if (printedRes.data && printedRes.data.length > 0) {
                return printedRes.data.map((row: { content: string; metadata?: KnowledgeFragment['metadata'] }) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            // 2. Buscar por pageNumber (número de página del PDF)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { pageNumber: pageNum })
                .limit(matchCount);

            if (!error && data && data.length > 0) {
                return data.map((row: { content: string; metadata?: KnowledgeFragment['metadata'] }) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            // 3. Fallback por startPage
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fallbackStart = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { startPage: pageNum })
                .limit(matchCount);

            if (fallbackStart.data && fallbackStart.data.length > 0) {
                return fallbackStart.data.map((row: { content: string; similarity?: number; metadata?: KnowledgeFragment['metadata'] }) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            return [];
        });

        const results = await Promise.all(promises);
        for (const fragments of results) {
            allFragments.push(...fragments);
        }
    } else if (allFragments.length === 0) {
        const ftsKeywords = extractStructuralKeywords(query);

        // LLAMADA A LA EDGE FUNCTION DE SUPABASE (protegida con try/catch)
        try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const edgeFunctionKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            
            if (supabaseUrl && edgeFunctionKey) {
                const edgeFunctionUrl = `${supabaseUrl}/functions/v1/embed-query`;
                const response = await fetch(edgeFunctionUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${edgeFunctionKey}`,
                    },
                    body: JSON.stringify({
                        query: normalized.cleanQuery,
                        matchCount,
                        matchThreshold,
                        ftsKeywords,
                        pageFilter: null,
                        unitFilter: unitFilter,
                    }),
                });

                if (response.ok) {
                    const { data } = await response.json();
                    allFragments = data ?? [];
                }
            }
        } catch (edgeErr) {
            log("warn", "RAG", "No se pudo conectar a la Edge Function de Supabase, continuando...", edgeErr);
        }
    }

    log("info", "RAG", `Búsqueda en ${Date.now() - start}ms`, {
        mode: queryMode, pages: pageNumbers, matchCount,
    });

    const fragments = allFragments;

    const ragContext: RagContext = {
        totalFragments: fragments.length,
        queryMode,
        fragments: fragments.map(f => ({
            page: f.metadata?.pageNumber ?? f.metadata?.startPage,
            unit: f.metadata?.unit,
            topics: f.metadata?.topics,
            similarity: Math.round(f.similarity * 1000) / 1000,
            contentPreview: f.content.substring(0, 120),
        })),
    };

    if (fragments.length === 0) return { contextText: "", ragContext };

    const contextText = fragments
        .map((f, idx) => {
            const page = f.metadata?.pageNumber ?? f.metadata?.startPage;
            const unit = f.metadata?.unit ?? "";
            const topics = f.metadata?.topics?.join(", ") ?? "";
            let header = page && unit ? `[${unit} — Página ${page}]`
                : page ? `[Página ${page}]`
                    : unit ? `[${unit}]`
                        : `[Fragmento ${idx + 1}]`;
            if (topics) header += ` (Temas: ${topics})`;
            return `${header}\n${f.content}`;
        })
        .join("\n\n---\n\n");

    return { contextText, ragContext };
}



// ============================================================
function buildSystemPrompt(
    contextText: string,
    lang: "es" | "en" | "auto"
): string {
    const langLine = lang === "es"
        ? "Responde SIEMPRE en español."
        : lang === "en"
            ? "ALWAYS respond in English."
            : "Responde en el mismo idioma que use el usuario.";

    const bookContext = contextText.length > 0
        ? `\n\n--- FRAGMENTOS RECUPERADOS DEL LIBRO DE RUSSELL & NORVIG ---\n${contextText}\n--- FIN DE FRAGMENTOS ---\n\nINSTRUCCIÓN: Usa los fragmentos anteriores como tu referencia principal de datos. Cita páginas inline con [Página X].`
        : "\n\n(No hay fragmentos específicos adjuntos a esta consulta inmediata).";

    return `Eres ARIA, la Asistente de Referencia en Inteligencia Artificial especializada de élite en el libro "Inteligencia Artificial: Un Enfoque Moderno" (2ª Edición) de Stuart J. Russell & Peter Norvig.

${langLine}

COBERTURA DE LA BASE DE DATOS:
- Tu sistema cuenta con la TOTALIDAD del libro 'Inteligencia Artificial: Un Enfoque Moderno' (2ª Edición, 27 capítulos, 1,220 páginas) indexado y disponible en la base de datos de Supabase.
- Si el usuario pregunta si el libro está completo, hasta qué página tienes acceso o si tienes todo el texto, confirma con absoluta seguridad que la totalidad de las 1,220 páginas del libro está registrada en el sistema. NUNCA digas que solo tienes acceso a unos pocos fragmentos.

FORMATO Y ESTILO DE RESPUESTA (ESTILO CHATGPT):
1. Organiza las respuestas de manera muy visual, estructurada y limpia utilizando Markdown.
2. Usa un encabezado principal claro con ## para el tema.
3. Utiliza etiquetas en negrita con salto de línea para organizar la información:
   - **Concepto:** (Explicación clara y elegante)
   - **Características:** (Lista con viñetas)
   - **Ejemplo / Aplicación:** (Caso práctico del libro)
4. Agrega un salto de línea limpio entre cada bloque para que la lectura sea cómoda.
5. Al final de la respuesta, si usas información del libro, añade siempre el bloque de fuente:
► **FUENTE**: *Inteligencia Artificial: Un Enfoque Moderno* - Capítulo [N] - Página(s) [X]${bookContext}`;
}

// VALIDACIÓN
// ============================================================
function validateBody(body: unknown): { valid: true; data: RequestBody } | { valid: false; error: string } {
    if (typeof body !== "object" || body === null)
        return { valid: false, error: "El cuerpo debe ser un objeto JSON." };

    const { message, historyContext, teacherId } = body as Record<string, unknown>;

    if (typeof message !== "string" || message.trim().length === 0)
        return { valid: false, error: "El campo 'message' es requerido y no puede estar vacío." };

    if (message.length > CONFIG.limits.maxMessageLength)
        return { valid: false, error: `El mensaje no puede superar ${CONFIG.limits.maxMessageLength} caracteres.` };

    if (historyContext !== undefined) {
        if (!Array.isArray(historyContext))
            return { valid: false, error: "'historyContext' debe ser un arreglo." };
        for (const msg of historyContext) {
            if (
                typeof msg !== "object" || msg === null ||
                !["user", "assistant"].includes((msg as ChatMessage).role) ||
                typeof (msg as ChatMessage).content !== "string"
            ) return { valid: false, error: "Cada mensaje del historial debe tener 'role' y 'content' válidos." };
        }
    }

    return {
        valid: true,
        data: {
            message: message.trim(),
            historyContext: historyContext as ChatMessage[] | undefined,
            teacherId: typeof teacherId === "string" ? teacherId.trim() : undefined,
        },
    };
}

// ============================================================
// SUPABASE (singleton)
// ============================================================
let _supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Variables de Supabase no configuradas.");
    _supabaseClient = createClient(url, key);
    return _supabaseClient;
}

// ============================================================
// CORS
// ============================================================
export async function OPTIONS(request: Request) {
    return NextResponse.json({}, { headers: getCorsHeaders(request.headers.get("origin")) });
}

// ============================================================
// GET — historial + health
// ============================================================
export async function GET(request: Request) {
    const corsHeaders = getCorsHeaders(request.headers.get("origin"));
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type === "health") {
        const redisOk = getRedis() !== null;
        return NextResponse.json(
            {
                status: "ok",
                ts: new Date().toISOString(),
                extractor: "edge_functions",
                redis: redisOk ? "configured" : "fallback_memory",
                metrics: {
                    totalRequests: metrics.totalRequests,
                    totalErrors: metrics.totalErrors,
                    avgLatencyMs: avgLatency(),
                    lastErrorAt: metrics.lastErrorAt,
                    lastErrorMsg: metrics.lastErrorMsg || null,
                },
            },
            { status: 200, headers: corsHeaders }
        );
    }

    const teacherId = searchParams.get("teacherId");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

    if (!teacherId) {
        return NextResponse.json(
            { error: "teacherId es requerido" },
            { status: 400, headers: corsHeaders }
        );
    }

    try {
        const supabase = getSupabaseClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from as any)("chat_messages")
            .select("role, content, created_at")
            .eq("teacher_id", teacherId)
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) throw error;

        const messages = (data ?? []).map((m: { role: string; content: string; created_at: string }) => ({
            ...m,
            role: m.role === "teacher" ? "user" : m.role,
        }));

        return NextResponse.json({ messages }, { status: 200, headers: corsHeaders });
    } catch (err) {
        log("error", "ChatHistory", "Error cargando historial", err);
        return NextResponse.json({ error: "Error al cargar el historial." }, { status: 500, headers: corsHeaders });
    }
}

// ============================================================
// POST — handler principal
// ============================================================
export async function POST(request: Request) {
    const requestStart = Date.now();
    const origin = request.headers.get("origin");
    const corsHeaders = getCorsHeaders(origin);

    metrics.totalRequests++;

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (await isRateLimited(ip)) {
        log("warn", "RateLimit", `IP bloqueada: ${ip}`);
        return NextResponse.json(
            { error: "Demasiadas solicitudes. Espera un momento antes de continuar." },
            { status: 429, headers: corsHeaders }
        );
    }

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return NextResponse.json(
            { error: "El cuerpo de la petición no es JSON válido." },
            { status: 400, headers: corsHeaders }
        );
    }

    const validation = validateBody(rawBody);
    if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400, headers: corsHeaders });
    }

    const { message, historyContext, teacherId } = validation.data;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        log("error", "Config", "GROQ_API_KEY no definida");
        return NextResponse.json({ error: "Error de configuración del servidor." }, { status: 500, headers: corsHeaders });
    }

    const lang = detectLanguage(message);
    const questionType = detectQuestionType(message);   // ← ahora puede devolver "page"
    const followUp = isFollowUpMessage(message);

    log("info", "Request", `Idioma: ${lang} | Tipo: ${questionType} | FollowUp: ${followUp}`, {
        ip, messageLength: message.length,
    });

    let contextText = "";
    let ragContext: RagContext = { fragments: [], totalFragments: 0, queryMode: "hybrid" };

    try {
        let ragQuery = message;
        if (followUp && historyContext && historyContext.length > 0) {
            const lastUserMsg = [...historyContext].reverse().find(
                m => m.role === "user" && m.content !== message
            );
            if (lastUserMsg) {
                ragQuery = lastUserMsg.content;
                log("info", "RAG", `Follow-up detectado. Query anterior: "${ragQuery.substring(0, 80)}..."`);
            }
        }

        const result = await fetchRelevantContext(ragQuery, questionType);
        contextText = result.contextText;
        ragContext = result.ragContext;
    } catch (ragError) {
        const isEmbeddingTimeout = ragError instanceof Error && ragError.message === "embedding_timeout";
        log("warn", "RAG", isEmbeddingTimeout
            ? "Timeout en embeddings, se omite contexto"
            : "No se pudo obtener contexto del libro", ragError);
    }

    const systemPrompt = buildSystemPrompt(contextText, lang);

    const trimmedHistory: ChatMessage[] = (historyContext ?? [])
        .slice(-CONFIG.limits.maxHistoryMessages)
        .map(({ role, content }) => ({ role, content }));

    try {
        const groq = new Groq({ apiKey });

        const messagesForGroq: Parameters<typeof groq.chat.completions.create>[0]['messages'] = [
            { role: "system", content: systemPrompt },
            ...trimmedHistory,
            { role: "user", content: message },
        ];

        // Model Fallback Pipeline para tolerancia a fallos por cuotas/rate limits de Groq
        const fallbackModels = [
            CONFIG.model, // "llama-3.3-70b-versatile"
            "llama-3.1-8b-instant",
            "llama3-70b-8192",
            "llama3-8b-8192",
            "gemma2-9b-it",
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let groqStream: any = null;
        let selectedModelUsed: string = CONFIG.model;

        for (const targetModel of fallbackModels) {
            try {
                groqStream = await groq.chat.completions.create({
                    messages: messagesForGroq,
                    model: targetModel,
                    temperature: questionType === "complex" ? 0.4 : 0.2,
                    max_tokens: questionType === "page" ? 3000 : questionType === "complex" ? 2048 : 1024,
                    stream: true,
                });
                selectedModelUsed = targetModel;
                break; // Éxito con este modelo
            } catch (modelErr) {
                const isRateLimit = modelErr instanceof Error && (modelErr.message.includes("rate_limit") || modelErr.message.includes("429"));
                log("warn", "GroqFallback", `Fallo en modelo ${targetModel} (${isRateLimit ? "Rate Limit" : "Error"}), probando fallback...`);
                // Breve pausa de 200ms si es rate limit antes de probar el siguiente modelo
                if (isRateLimit) await new Promise(res => setTimeout(res, 200));
            }
        }

        if (!groqStream) {
            log("warn", "Groq", "Todos los modelos de Groq alcanzaron el límite de cuota (Rate Limit)");
            const friendlyMsg = "⚠️ *El servicio de IA ha alcanzado temporalmente el límite de peticiones de Groq (Rate Limit por minuto). Por favor, espera 10 segundos e intenta tu consulta nuevamente.*";
            const encoder = new TextEncoder();
            const fallbackStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: friendlyMsg })}\n\n`));
                    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                    controller.close();
                }
            });
            return new Response(fallbackStream, {
                status: 200,
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    ...corsHeaders,
                },
            });
        }

        const encoder = new TextEncoder();
        let fullReply = "";

        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of groqStream) {
                        const text = chunk.choices[0]?.delta?.content ?? "";
                        if (text) {
                            fullReply += text;
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
                        }
                    }

                    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                    controller.close();

                    const elapsed = Date.now() - requestStart;
                    recordLatency(elapsed);
                    log("info", "Groq", `Stream completado en ${elapsed}ms con modelo ${selectedModelUsed}`, {
                        model: selectedModelUsed,
                        questionType,
                        lang,
                        contextFragments: ragContext.totalFragments,
                        replyLength: fullReply.length,
                    });

                    if (teacherId) {
                        saveChatMessages(teacherId, message, fullReply, ragContext).catch(() => { });
                    }
                } catch (streamError) {
                    metrics.totalErrors++;
                    log("error", "Groq", "Error durante streaming", streamError);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Error durante la generación." })}\n\n`));
                    controller.close();
                }
            },
        });

        return new Response(readableStream, {
            status: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error) {
        metrics.totalErrors++;
        metrics.lastErrorAt = new Date();
        metrics.lastErrorMsg = error instanceof Error ? error.message : String(error);

        const isTimeout = error instanceof Error && error.message === "Groq timeout";
        log("error", "Groq", isTimeout ? "Timeout" : "Error inesperado", error);

        return NextResponse.json(
            {
                error: isTimeout
                    ? "El servicio tardó demasiado. Intenta de nuevo."
                    : "Error interno procesando la respuesta.",
            },
            { status: isTimeout ? 504 : 500, headers: corsHeaders }
        );
    }
}

// ============================================================
// PERSISTENCIA
// ============================================================
async function saveChatMessages(
    teacherId: string,
    userMsg: string,
    assistantMsg: string,
    ragContext: RagContext
) {
    try {
        const supabase = getSupabaseClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from as any)("chat_messages").insert([
            { teacher_id: teacherId, role: "teacher", content: userMsg, rag_context: null },
            { teacher_id: teacherId, role: "assistant", content: assistantMsg, rag_context: ragContext },
        ]);
    } catch (err) {
        log("warn", "ChatPersist", "No se pudo guardar el mensaje", err);
    }
}