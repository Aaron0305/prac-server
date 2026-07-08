import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Cargar la llave privada una sola vez al iniciar (se recarga en cada reinicio del servidor)
let privateKey: string | null = null;

function getPrivateKey(): string {
  if (privateKey) return privateKey;

  // 1. Primero intentar desde variable de entorno (producción)
  if (process.env.QZ_PRIVATE_KEY) {
    // La variable puede tener \n literales en vez de saltos de línea reales
    privateKey = process.env.QZ_PRIVATE_KEY.replace(/\\n/g, "\n");
    console.log("[QZ Sign] ✅ Llave privada cargada desde variable de entorno");
    return privateKey;
  }

  // 2. Fallback: leer desde archivo (desarrollo local)
  const keyPath = path.join(process.cwd(), "certs", "private-key.pem");
  if (fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, "utf-8");
    console.log("[QZ Sign] ✅ Llave privada cargada desde archivo:", keyPath);
    return privateKey;
  }

  throw new Error(
    "QZ Tray private key not found. Set QZ_PRIVATE_KEY env var or place certs/private-key.pem"
  );
}

/**
 * POST /api/pos/qz-sign
 * Firma un mensaje para QZ Tray usando SHA512 + RSA
 * Body: { request: "hash-a-firmar" }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const toSign = body.request;

    if (!toSign) {
      return NextResponse.json(
        { error: "Missing 'request' field" },
        { status: 400 }
      );
    }

    const key = getPrivateKey();
    const signer = crypto.createSign("SHA512");
    signer.update(toSign);
    signer.end();

    const signature = signer.sign(key, "base64");

    return new NextResponse(signature, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[QZ Sign] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
