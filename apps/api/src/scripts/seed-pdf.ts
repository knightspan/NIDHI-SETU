import PDFDocument from 'pdfkit';

/** Renders a PDF to a buffer. */
function render(draw: (doc: PDFKit.PDFDocument) => void, size: [number, number]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size, margin: 28, info: { Title: 'Specimen (fictional)' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

function watermark(doc: PDFKit.PDFDocument, w: number, h: number): void {
  doc.save();
  doc.rotate(-20, { origin: [w / 2, h / 2] });
  doc.fontSize(34).fillColor('#d03b3b').opacity(0.18);
  doc.text('SPECIMEN · FICTIONAL', 0, h / 2 - 20, { width: w, align: 'center' });
  doc.restore();
  doc.opacity(1).fillColor('#111111');
}

export interface FdrPdfFields {
  bankName: string;
  branch: string;
  fdrNumber: string;
  ifsc: string;
  amount: number;
  issueDate: string;
  maturityDate: string;
  depositorNames: string[];
  lienMarked: boolean;
  /** Makes otherwise identical scans byte-different. */
  nonce: string;
}

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** A fictional fixed-deposit receipt, laid out like the OCR samples (with a real text layer). */
export function fdrPdf(f: FdrPdfFields): Promise<Buffer> {
  const [w, h] = [595, 360];
  return render(
    (doc) => {
      doc.rect(20, 20, w - 40, 44).fill('#1f3a8a');
      doc.fillColor('#ffffff').fontSize(18).text(f.bankName.toUpperCase(), 34, 32);
      doc.fontSize(8).text(`Branch: ${f.branch}`, 34, 32, { width: w - 68, align: 'right' });
      doc.fillColor('#111111').fontSize(13).text('FIXED DEPOSIT RECEIPT', 34, 78);
      const rows: [string, string][] = [
        ['FDR No.:', f.fdrNumber],
        ['IFSC:', f.ifsc],
        ['In the name(s) of:', f.depositorNames.join(' & ')],
        ['Principal Amount (Rs.):', inr(f.amount)],
        ['Date of Issue:', dmy(f.issueDate)],
        ['Maturity Date:', dmy(f.maturityDate)],
      ];
      let y = 108;
      for (const [k, v] of rows) {
        doc.fontSize(10).fillColor('#444444').text(k, 40, y);
        doc.fillColor('#111111').text(v, 210, y, { width: w - 250 });
        y += 22;
      }
      if (f.lienMarked) {
        doc
          .rect(w - 210, h - 92, 170, 34)
          .lineWidth(1.2)
          .stroke('#d03b3b');
        doc
          .fontSize(8)
          .fillColor('#d03b3b')
          .text('LIEN MARKED IN FAVOUR OF AICTE, NEW DELHI', w - 204, h - 84, { width: 160 });
      }
      doc
        .fontSize(7)
        .fillColor('#777777')
        .text(`Authorised signatory · ${f.nonce}`, 40, h - 50);
      watermark(doc, w, h);
    },
    [w, h],
  );
}

/** A fictional one-page letter (NOC, bank letter). */
export function letterPdf(title: string, body: string, nonce: string): Promise<Buffer> {
  const [w, h] = [595, 420];
  return render(
    (doc) => {
      doc.fontSize(16).text(title, { align: 'center' });
      doc.moveDown().fontSize(11).text(body, { align: 'left' });
      doc.moveDown().fontSize(8).fillColor('#777777').text(`Ref. ${nonce}`);
      watermark(doc, w, h);
    },
    [w, h],
  );
}
