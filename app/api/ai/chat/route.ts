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
    model: "llama-3.1-8b-instant",
    rag: {
        matchThreshold: 0.10,   // ← más bajo para capturar más fragmentos de la página
        matchCountDefault: 6,
        matchCountExtended: 10,
        matchCountPage: 15,     // ← NUEVO: páginas necesitan más fragmentos
    },
    limits: {
        maxMessageLength: 2000,
        maxHistoryMessages: 10,
        requestTimeoutMs: 25_000,
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
    // Primero verificar si es pregunta de página — tiene prioridad
    const isPageQuery = /\b(?:page|p[aá]gina|pagina|p\.?|pg\.?)\s*\d+/i.test(message) ||
        /\bqu[eé]\s+(?:hay|tiene|contiene|dice|sale|aparece)/i.test(message) &&
        /\b(?:page|p[aá]gina)\b/i.test(message);
    if (isPageQuery) return "page";

    const complexKeywords = [
        "plan de clase", "planificación", "examen", "evaluación", "actividades para",
        "ejercicios para", "cómo enseñar", "estrategia", "unidad completa", "semana",
        "genera", "crea", "diseña", "elabora",
        "lesson plan", "exam", "test", "quiz", "activities for", "how to teach",
        "unit", "full lesson", "generate", "create", "design",
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
function extractStructuralKeywords(message: string): string {
    const keywords: string[] = [];

    const pagePatterns = [/\b(?:page|página|pagina|p\.|pg\.?)\s*(\d+)/gi, /\bp(\d+)\b/gi];
    for (const pattern of pagePatterns) {
        let m;
        while ((m = pattern.exec(message)) !== null) keywords.push(`PageNum ${m[1]}`);
    }

    const chapterPatterns = [/\b(?:cap[ií]tulo|capitulo|chapter|cap|unit|unidad)\s*(\d+)/gi, /\bc(\d{1,2})\b/gi];
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
        [/\b(?:aprendizaje|learning|machine learning)\b/i, "aprendizaje"],
        [/\b(?:redes neuronales|deep learning)\b/i, "redes neuronales"],
        [/\b(?:procesamiento del lenguaje|pln|nlp)\b/i, "lenguaje natural"],
        [/\b(?:visión|vision|percepción)\b/i, "visión"],
        [/\b(?:robótica|robotica|robotics)\b/i, "robótica"],
    ];
    for (const [pattern, keyword] of topicKeywords) {
        if (pattern.test(message)) keywords.push(keyword);
    }

    return keywords.length > 0 ? keywords.join(" ") : message;
}

function extractPageNumbers(message: string): number[] {
    const pages: number[] = [];
    const regex = /\b(?:pages?|p[aá]ginas?|p\.|pgs?\.?)\s*((?:\d+(?:\s*,\s*|\s+y\s+|\s+e\s+|\s+and\s+|\s+-\s+|)*)+)/gi;
    let m;
    while ((m = regex.exec(message)) !== null) {
        const numbers = m[1].match(/\d+/g);
        if (numbers) {
            numbers.forEach(n => pages.push(parseInt(n)));
        }
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

    // 🚀 SALUDOS / CORTE SÍA: Saltar RAG y embeddings por completo (Latencia 0ms)
    if (isGreetingMessage(query)) {
        return {
            contextText: "",
            ragContext: { fragments: [], totalFragments: 0, queryMode: "hybrid" }
        };
    }

    const pageNumbers = extractPageNumbers(query);
    const isMultiPage = pageNumbers.length > 1;
    const isPageTargeted = pageNumbers.length > 0;
    const unitFilter = isPageTargeted ? null : extractUnitNumber(query);

    const matchCount = questionType === "page" ? CONFIG.rag.matchCountPage
        : questionType === "complex" ? CONFIG.rag.matchCountExtended
            : CONFIG.rag.matchCountDefault;

    const matchThreshold = questionType === "page" || isMultiPage ? 0.08 : CONFIG.rag.matchThreshold;
    const queryMode: RagContext["queryMode"] = isPageTargeted ? "page" : unitFilter ? "unit" : "hybrid";
    const supabase = getSupabaseClient();

    let allFragments: KnowledgeFragment[] = [];

    if (isPageTargeted) {
        // 🚀 BÚSQUEDA DIRECTA Y ULTRA RÁPIDA DE PÁGINA (JSONB exacto en Supabase)
        const promises = pageNumbers.map(async pageNum => {
            const { data, error } = await (supabase.from as any)("knowledge_embeddings")
                .select("content, metadata")
                .contains("metadata", { pageNumber: pageNum })
                .limit(matchCount);

            if (error || !data || data.length === 0) {
                const fallback = await (supabase.from as any)("knowledge_embeddings")
                    .select("content, metadata")
                    .contains("metadata", { startPage: pageNum })
                    .limit(matchCount);
                return (fallback.data ?? []).map((row: any) => ({
                    content: row.content,
                    similarity: 1.0,
                    metadata: row.metadata,
                }));
            }

            return data.map((row: any) => ({
                content: row.content,
                similarity: 1.0,
                metadata: row.metadata,
            }));
        });

        const results = await Promise.all(promises);
        for (const fragments of results) {
            allFragments.push(...fragments);
        }
    } else {
        const ftsKeywords = extractStructuralKeywords(query);

        // 🚀 LLAMADA ULTRA-RÁPIDA A LA EDGE FUNCTION DE SUPABASE
        const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed-query`;
        const edgeFunctionKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Usado como Auth Token
        
        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${edgeFunctionKey}`,
            },
            body: JSON.stringify({
                query,
                matchCount,
                matchThreshold,
                ftsKeywords,
                pageFilter: null,
                unitFilter: unitFilter,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Edge Function error: ${response.status} ${errText}`);
        }

        const { data } = await response.json();
        allFragments = data ?? [];
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
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(
    contextText: string,
    lang: "es" | "en" | "auto",
    questionType: QuestionType
): string {
    const langInstruction = {
        es: "SIEMPRE responde en español, independientemente del idioma del contenido del libro.",
        en: "ALWAYS respond in English, regardless of the language used in the book content.",
        auto: "Detecta el idioma de la pregunta del usuario y responde en ese mismo idioma.",
    }[lang];

    // ── Instrucciones adaptativas por tipo de pregunta ──
    const lengthInstruction = questionType === "page"
        ? `FORMATO DE RESPUESTA — CONSULTA DE PÁGINA(S):
- Si preguntan por UNA página concreta: Extrae y presenta TODO el contenido de esa página, organizado en secciones claras.
- Cita las páginas con el formato [Página X].`
        : questionType === "complex"
            ? `FORMATO DE RESPUESTA — CONSULTA COMPLEJA:
- Estructura la respuesta con encabezados Markdown claros (##, ###).
- Incluye pseudocódigo o fórmulas si aplican al tema.`
            : `FORMATO DE RESPUESTA — CONSULTA SIMPLE / SALUDO:
- Si el usuario está saludando ("hola", "buenas noches", etc.), responde con un saludo amable y breve como ARIA e invítalo a preguntar sobre el libro.
- Si es una pregunta breve sobre IA, responde directo al grano (3-6 líneas).`;

    // ── Contexto del libro recuperado por RAG ──
    const bookContext = contextText.length > 0
        ? `\n\n╔══════════════════════════════════════════════════════════════╗
║  FRAGMENTOS RECUPERADOS DEL LIBRO (fuente autoritativa)     ║
╚══════════════════════════════════════════════════════════════╝
${contextText}
══════════════════════════════════════════════════════════════

INSTRUCCIÓN CRÍTICA: Tu respuesta DEBE basarse en los fragmentos anteriores cuando contengan la información. Cita las páginas con [Página X].`
        : `\n\n(Nota: No hay fragmentos de texto adjuntos para esta consulta. Si el usuario está saludando, presentándose o preguntando en general sobre el libro de IA, responde amablemente preséntandote como ARIA e invitándolo a realizar consultas del libro).`;

    // ── SYSTEM PROMPT PRINCIPAL ──
    return `Eres **ARIA** (Asistente de Referencia en Inteligencia Artificial), un asistente académico de élite especializado EXCLUSIVAMENTE en el libro:

📖 **"Inteligencia Artificial: Un Enfoque Moderno" (2ª Edición)**
✍️ Autores: Stuart J. Russell & Peter Norvig

═══════════════════════════════════════════
🌐 IDIOMA
═══════════════════════════════════════════
${langInstruction}

═══════════════════════════════════════════
🔒 RESTRICCIÓN DE TEMA
═══════════════════════════════════════════
- Tu dominio principal es la Inteligencia Artificial del libro de Russell & Norvig.
- PERMITE saludos amables de cortesía, presentaciones y preguntas sobre los temas del libro.
- SOLO si el usuario pregunta algo TOTALMENTE AJENO a la Inteligencia Artificial (recetas de cocina, deportes, política, películas), responde EXACTAMENTE:
  "❌ Lo siento, solo puedo ayudarte con temas del libro *Inteligencia Artificial: Un Enfoque Moderno* de Russell & Norvig. ¿Tienes alguna duda sobre IA?"

═══════════════════════════════════════════
🧠 TU ROL Y EXPERTISE
═══════════════════════════════════════════
Eres un experto en IA con conocimiento enciclopédico de los 27 capítulos del libro. Si te saludan ("hola", "buenas noches"), saluda cordialmente, preséntate brevemente como ARIA y menciona que estás listo para responder cualquier duda sobre los temas o capítulos del libro de Russell & Norvig.

═══════════════════════════════════════════
📋 ${lengthInstruction}
═══════════════════════════════════════════
═══════════════════════════════════════════
⚖️ REGLAS DE INTEGRIDAD
═══════════════════════════════════════════
1. **Citación obligatoria**: Cuando el contenido provenga del libro, cita la página exacta [Página X].
2. **Transparencia**: Si algo NO está en los fragmentos recuperados, dilo explícitamente en una línea.
3. **Anti-alucinación estricta**: NUNCA inventes datos, cifras, nombres de algoritmos, teoremas o resultados que no estén en el fragmento recuperado. Si no tienes la información, di "No tengo ese dato específico del libro".
4. **Pseudocódigo fiel**: Si el libro presenta pseudocódigo de un algoritmo, reprodúcelo fielmente. No lo modifiques ni "mejores".
5. **Notación matemática**: Usa notación clara y consistente con la del libro.
6. **Formato profesional**: Usa Markdown (encabezados, viñetas, código, negrita) para que la respuesta sea visualmente clara y fácil de estudiar.
7. **Sin redundancia**: No repitas la pregunta del usuario ni agregues introducciones genéricas. Ve directo al grano.
8. **Navegación**: Cuando sea útil, indica al usuario "Para profundizar, revisa el Capítulo X, sección Y (página Z)" para que pueda ir directamente a la fuente.
${bookContext}`;
}

// ============================================================
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
        const { data, error } = await (supabase.from as any)("chat_messages")
            .select("role, content, created_at")
            .eq("teacher_id", teacherId)
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) throw error;

        const messages = (data ?? []).map((m: any) => ({
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

    // ← CAMBIO: pasar questionType al buildSystemPrompt
    const systemPrompt = buildSystemPrompt(contextText, lang, questionType);

    const trimmedHistory: ChatMessage[] = (historyContext ?? [])
        .slice(-CONFIG.limits.maxHistoryMessages)
        .map(({ role, content }) => ({ role, content }));

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: message },
    ];

    try {
        const groq = new Groq({ apiKey });

        const stream = await groq.chat.completions.create({
            messages,
            model: CONFIG.model,
            temperature: questionType === "complex" ? 0.4 : 0.2,
            // ← CAMBIO: páginas necesitan más tokens para listar todo el contenido
            max_tokens: questionType === "page" ? 3000
                : questionType === "complex" ? 2048
                    : 1024,
            stream: true,
        });

        const encoder = new TextEncoder();
        let fullReply = "";

        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
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
                    log("info", "Groq", `Stream completado en ${elapsed}ms`, {
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
        await (supabase.from as any)("chat_messages").insert([
            { teacher_id: teacherId, role: "teacher", content: userMsg, rag_context: null },
            { teacher_id: teacherId, role: "assistant", content: assistantMsg, rag_context: ragContext },
        ]);
    } catch (err) {
        log("warn", "ChatPersist", "No se pudo guardar el mensaje", err);
    }
}