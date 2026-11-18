// Crea una planilla de Excel (.xlsx) con una sola hoja, sin librerías: un .xlsx es un ZIP con unos pocos archivos XML.
// Sirve en el navegador (window.Planilla) y en las pruebas (require). Los textos van como texto, nunca como fórmulas.
(function (raiz) {
  const enc = new TextEncoder();

  // CRC-32 que exige el formato ZIP.
  const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  // ZIP sin compresión: [{ nombre, bytes }] -> Uint8Array
  function zip(archivos, ahora = new Date()) {
    const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
    const fecha = (Math.max(0, ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
    const partes = [], central = [];
    let pos = 0;
    for (const a of archivos) {
      const nombre = enc.encode(a.nombre), crc = crc32(a.bytes);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
      loc.setUint16(10, hora, true); loc.setUint16(12, fecha, true); loc.setUint32(14, crc, true);
      loc.setUint32(18, a.bytes.length, true); loc.setUint32(22, a.bytes.length, true); loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
      partes.push(new Uint8Array(loc.buffer), nombre, a.bytes);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, hora, true); cen.setUint16(14, fecha, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, a.bytes.length, true); cen.setUint32(24, a.bytes.length, true); cen.setUint16(28, nombre.length, true);
      cen.setUint32(42, pos, true);
      central.push(new Uint8Array(cen.buffer), nombre);
      pos += 30 + nombre.length + a.bytes.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, pos, true);
    const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
    const salida = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of todo) { salida.set(p, o); o += p.length; }
    return salida;
  }

  // Quita lo que XML no admite (caracteres de control) y escapa lo especial.
  const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Nombre de columna: 0 -> A, 25 -> Z, 26 -> AA
  const letra = n => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

  const NOMBRE_HOJA_MAL = /[\[\]:*?/\\]/g;

  // columnas: [{ titulo, ancho? }], filas: [[valor, ...]] (texto o número). Devuelve los bytes del archivo .xlsx.
  function crearXlsx({ hoja = 'Hoja1', columnas, filas }) {
    const nombreHoja = String(hoja).replace(NOMBRE_HOJA_MAL, ' ').trim().slice(0, 31) || 'Hoja1';
    const celda = (v, c, f, estilo) => {
      const ref = letra(c) + f, s = estilo ? ` s="${estilo}"` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === '') return '';
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    };
    const fila = (valores, f, estilo) => `<row r="${f}">${valores.map((v, c) => celda(v, c, f, estilo)).join('')}</row>`;
    const ultima = letra(columnas.length - 1) + (filas.length + 1);
    const hojaXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + `<cols>${columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 18}" customWidth="1"/>`).join('')}</cols>`
      + `<sheetData>${fila(columnas.map(c => c.titulo), 1, 1)}${filas.map((f, i) => fila(f, i + 2, 0)).join('')}</sheetData>`
      + `<autoFilter ref="A1:${ultima}"/>`
      + '</worksheet>';
    const archivos = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      // Estilo 0: normal. Estilo 1: encabezado en negrita con fondo verde claro.
      'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': hojaXml,
    };
    return zip(Object.entries(archivos).map(([nombre, texto]) => ({ nombre, bytes: enc.encode(texto) })));
  }

  const api = { crearXlsx, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Planilla = api;
})(typeof window !== 'undefined' ? window : globalThis);
