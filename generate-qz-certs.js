/**
 * Genera un certificado X.509 auto-firmado + llave privada para QZ Tray.
 * Ejecutar con: node generate-qz-certs.js
 * 
 * QZ Tray requiere un certificado X.509 PEM (BEGIN CERTIFICATE),
 * NO una llave pública cruda (BEGIN PUBLIC KEY).
 */
const forge = require("node-forge");
const fs = require("fs");
const path = require("path");

console.log("🔐 Generando certificado X.509 auto-firmado para QZ Tray...\n");

// 1. Generar par de llaves RSA 2048-bit
const keys = forge.pki.rsa.generateKeyPair(2048);

// 2. Crear certificado X.509 auto-firmado
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";

// Válido por 10 años
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

// Datos del certificado
const attrs = [
    { name: "commonName", value: "Ingles POS QZ Tray" },
    { name: "organizationName", value: "Ingles School" },
    { name: "localityName", value: "Ixtlahuaca" },
    { name: "stateOrProvinceName", value: "Estado de Mexico" },
    { name: "countryName", value: "MX" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs); // auto-firmado

// Extensiones
cert.setExtensions([
    { name: "basicConstraints", cA: true },
    {
        name: "keyUsage",
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
    },
    {
        name: "subjectAltName",
        altNames: [
            { type: 2, value: "localhost" },
            { type: 2, value: "localhost.qz.io" },
            { type: 7, ip: "127.0.0.1" },
        ],
    },
]);

// 3. Firmar el certificado con SHA256
cert.sign(keys.privateKey, forge.md.sha256.create());

// 4. Exportar a PEM
const certPem = forge.pki.certificateToPem(cert);
const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

// 5. Guardar archivos
const certsDir = path.join(__dirname, "certs");
if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
}

// Llave privada (NUNCA compartir)
fs.writeFileSync(path.join(certsDir, "private-key.pem"), privateKeyPem);
console.log("✅ private-key.pem (llave privada RSA 2048-bit)");

// Certificado X.509 para el servidor
fs.writeFileSync(path.join(certsDir, "digital-certificate.txt"), certPem);
console.log("✅ digital-certificate.txt (certificado X.509)");

// override.crt para QZ Tray
fs.writeFileSync(path.join(certsDir, "override.crt"), certPem);
console.log("✅ override.crt (para instalar en QZ Tray)");

// Copia del certificado al cliente (public/)
const clientPublicDir = path.join(__dirname, "..", "client", "public");
fs.writeFileSync(path.join(clientPublicDir, "digital-certificate.txt"), certPem);
console.log("✅ client/public/digital-certificate.txt (accesible desde navegador)");

// Verificación
const loaded = forge.pki.certificateFromPem(certPem);
console.log("\n📋 CERTIFICADO GENERADO:");
console.log("   Tipo:    X.509 v3 (auto-firmado)");
console.log("   Sujeto:", loaded.subject.getField("CN").value);
console.log("   Válido:  " + loaded.validity.notBefore.toLocaleDateString() + " - " + loaded.validity.notAfter.toLocaleDateString());
console.log("   Firma:   SHA-256 con RSA");
console.log("   Header:  " + certPem.split("\n")[0]);

console.log("\n📋 PASOS SIGUIENTES:");
console.log("1. Copia override.crt a 'C:\\Program Files\\QZ Tray\\'");
console.log("2. Reinicia QZ Tray completamente");
console.log("3. Refresca el navegador");
console.log("4. Los diálogos ahora mostrarán tu sitio como CONFIABLE ✅");
