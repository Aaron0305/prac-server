import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const PDF_PATH = path.join(__dirname, 'Inteligencia Artificial Un Enfoque Moderno.pdf');

async function extractPages(startPage: number, endPage: number) {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const pdf = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  console.log(`Total pages: ${pdf.numPages}\n`);

  for (let pageNum = startPage; pageNum <= Math.min(endPage, pdf.numPages); pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str || '').join(' ');
      console.log(`\n========== PÁGINA ${pageNum} ==========`);
      console.log(text.trim());
    } catch (e) {
      console.log(`\n========== PÁGINA ${pageNum} ==========`);
      console.log(`[ERROR: ${(e as Error).message}]`);
    }
  }
}

async function main() {
  console.log('=== EXTRAYENDO ÍNDICE Y CONTENIDO DEL LIBRO ===\n');
  await extractPages(1, 20);
}

main().catch(console.error);
