import { NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import Groq from "groq-sdk";
import { pipeline } from "@huggingface/transformers";
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

// ============================================================
// EMBEDDINGS (singleton + warm-up + timeout)
// ============================================================
let extractorInstance: any = null;
let extractorLoading: Promise<any> | null = null;

export const extractorStatus: {
    state: "idle" | "loading" | "ready" | "error";
    loadedAt?: Date;
    lastError?: string;
} = { state: "idle" };

async function getExtractor() {
    if (extractorInstance) return extractorInstance;
    if (!extractorLoading) {
        log("info", "Embeddings", "Cargando modelo...");
        extractorStatus.state = "loading";
        extractorLoading = pipeline(
            "feature-extraction",
            "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
        )
            .then((inst: any) => {
                extractorInstance = inst;
                extractorStatus.state = "ready";
                extractorStatus.loadedAt = new Date();
                log("info", "Embeddings", "Modelo listo");
                return inst;
            })
            .catch((err: unknown) => {
                extractorLoading = null;
                extractorStatus.state = "error";
                extractorStatus.lastError = String(err);
                throw err;
            });
    }
    return extractorLoading;
}

// getExtractor().catch(() => { }); // Se cargará bajo demanda para ahorrar RAM al inicio

async function getEmbeddingWithTimeout(text: string): Promise<number[]> {
    const extractor = await Promise.race([
        getExtractor(),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("embedding_timeout")),
                CONFIG.limits.embeddingTimeoutMs
            )
        ),
    ]);
    const output = await (extractor as any)(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
}

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

    const unitPatterns = [/\b(?:unit|unidad)\s*(\d+)/gi, /\bu(\d{1,2})\b/gi];
    for (const pattern of unitPatterns) {
        let m;
        while ((m = pattern.exec(message)) !== null) keywords.push(`UNIT ${m[1]}`);
    }

    const lessonMatch = message.match(/\b(?:lesson|lecci[oó]n|leccion)\s*(\d+)/i);
    if (lessonMatch) keywords.push(`LESSON ${lessonMatch[1]}`);

    const topicKeywords: [RegExp, string][] = [
        [/\b(?:grammar|gramática|gramatica)\b/i, "grammar"],
        [/\b(?:vocabulary|vocabulario|vocab)\b/i, "vocabulary"],
        [/\b(?:speaking|conversación|oral)\b/i, "speaking"],
        [/\b(?:listening|comprensión auditiva|audio)\b/i, "listening"],
        [/\b(?:reading|lectura)\b/i, "reading"],
        [/\b(?:writing|escritura|written)\b/i, "writing"],
        [/\b(?:pronunciation|pronunciación)\b/i, "pronunciation"],
        [/\b(?:exercise|ejercicio|practice|práctica)\b/i, "exercise"],
        [/\b(?:review|repaso|test|exam|quiz)\b/i, "review assessment"],
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
    const m = message.match(/\b(?:unit|unidad)\s*(\d+)/i);
    if (m && parseInt(m[1]) >= 1 && parseInt(m[1]) <= 14) return `UNIT ${m[1]}`;
    return null;
}

// ============================================================
// RAG — búsqueda de contexto
// ← CAMBIO: usa matchCount diferente según tipo de pregunta
// ============================================================
async function fetchRelevantContext(
    query: string,
    questionType: QuestionType
): Promise<{ contextText: string; ragContext: RagContext }> {
    const start = Date.now();

    const queryEmbedding = await getEmbeddingWithTimeout(query);
    const ftsKeywords = extractStructuralKeywords(query);
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
        // Fetch para cada página solicitada en paralelo
        const promises = pageNumbers.map(pageNum =>
            (supabase.rpc as any)("hybrid_search_knowledge", {
                query_embedding: queryEmbedding,
                query_text: `PageNum ${pageNum}`,
                match_threshold: matchThreshold,
                match_count: matchCount,
                page_filter: pageNum,
                unit_filter: null,
            })
        );
        const results = await Promise.all(promises);
        for (const res of results) {
            if (res.data) allFragments.push(...(res.data as KnowledgeFragment[]));
        }
    } else {
        const { data, error } = await (supabase.rpc as any)("hybrid_search_knowledge", {
            query_embedding: queryEmbedding,
            query_text: ftsKeywords,
            match_threshold: matchThreshold,
            match_count: matchCount,
            page_filter: null,
            unit_filter: unitFilter,
        });
        if (error) throw new Error(`Supabase RPC error: ${error.message}`);
        allFragments = data ?? [];
    }

    log("info", "RAG", `Búsqueda en ${Date.now() - start}ms`, {
        mode: queryMode, pages: pageNumbers, matchCount, ftsKeywords,
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
// ← CAMBIO: instrucciones específicas para preguntas de página
// ============================================================
function buildSystemPrompt(
    contextText: string,
    lang: "es" | "en" | "auto",
    questionType: QuestionType   // ← NUEVO parámetro
): string {
    const langInstruction = {
        es: "SIEMPRE responde en español, independientemente del idioma del contenido del libro.",
        en: "ALWAYS respond in English, regardless of the language used in the book content.",
        auto: "Detect the language of the teacher's question and respond in that same language.",
    }[lang];

    // ← CAMBIO: instrucciones de longitud según tipo
    const lengthInstruction = questionType === "page"
        ? `INSTRUCCIÓN DE RESPUESTA PARA PÁGINAS/RETROALIMENTACIÓN:
- Si te piden retroalimentación o análisis de varias páginas (ej. 40, 39, 38): Analiza TODAS las páginas solicitadas basándote en el contenido. Brinda una retroalimentación pedagógica clara de la progresión de los temas, y FINALIZA CON UN TIP ESPECIAL O CONSEJO de cómo enseñar esas tres páginas o temas en conjunto.
- Si solo te preguntan qué dice una página: LISTA TODO EL CONTENIDO de esa página sin omitir nada. Sé exhaustivo: el profesor quiere saber exactamente qué hay para preparar su clase.
- Organiza la información con secciones claras usando el contenido exacto recuperado.`
        : questionType === "complex"
            ? `INSTRUCCIÓN DE RESPUESTA:
- Esta es una pregunta compleja (plan de clase, examen, actividades). Sé detallado y estructurado.
- Usa secciones con encabezados cuando ayude a organizar la respuesta.
- Si envuelve un repaso de varios temas, al final provee un "Tip Especial" como recomendación docente.`
            : `INSTRUCCIÓN DE RESPUESTA:
- SÉ CONCISO. Responde en máximo 3-5 líneas.
- Usa viñetas SOLO cuando sea necesario listar cosas.`;

    const bookContext = contextText.length > 0
        ? `\n\n=== CONTENIDO OFICIAL DEL LIBRO TOP NOTCH ===\n${contextText}\n==============================================\n\nBasa tu respuesta ÚNICAMENTE en el contenido anterior. Cita páginas explícitamente.`
        : "\n\nNOTA: No se encontró contenido específico del libro. Usa tu conocimiento pedagógico y avisa que no provino del libro.";

    return `Eres un asistente pedagógico EXCLUSIVO para profesores de inglés que utilizan el libro Top Notch.

IDIOMA: ${langInstruction}

RESTRICCIÓN ABSOLUTA DE TEMA:
- SOLO puedes responder preguntas de: enseñanza de inglés, libro Top Notch, planes de clase, retroalimentación pedagógica, didáctica y resolución de dudas de la materia.
- NO respondas temas ajenos bajo NINGUNA circunstancia.

TU ROL Y CONOCIMIENTO:
- Conoces a profundidad el libro Top Notch y su metodología.
- Brindas "Feedback" analítico cuando te preguntan por varias páginas consecutivas y propones cómo unirlas u optimizar el tiempo.

${lengthInstruction}

REGLAS GENERALES:
1. Cuando el libro tenga el contenido, menciona la página brevemente.
2. Si algo NO está en el libro, dilo en una línea.
3. Para planes de clase (SOLO si lo piden): incluye objetivo, duración y materiales.
4. PROHIBICIÓN ABSOLUTA DE ALUCINAR: No inventes actividades ni ejercicios que no estén EXACTAMENTE en el fragmento recuperado.
5. No repitas información obvia. Sé natural y directo.
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
                extractor: extractorStatus,
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