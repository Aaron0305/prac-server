import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';

const PDF_PATH = path.join(__dirname, 'Inteligencia Artificial Un Enfoque Moderno.pdf');

async function extractPage() {
    try {
        const doc = await pdfjsLib.getDocument(PDF_PATH).promise;
        const page = await doc.getPage(24); // physical page 24
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(' ');
        console.log("=== CONTENIDO DE LA PÁGINA 24 ===");
        console.log(text);
        console.log("=================================");
    } catch (e) {
        console.error(e);
    }
}
extractPage();
