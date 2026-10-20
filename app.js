(function () {
'use strict';
// Piezas mínimas que reemplazan lo propio de Node en el navegador (se incluyen dentro del paquete web, app.js).
// Solo existe lo que el generador de la carta en PDF necesita: un "Buffer" básico y un "zlib" que escribe sin comprimir.

class BufferWeb extends Uint8Array {
  static alloc(n) { return new BufferWeb(n); }
  static isBuffer(x) { return x instanceof BufferWeb; }
  static byteLength(s) { return new TextEncoder().encode(String(s)).length; }
  static from(x, codificacion = 'utf8') {
    if (typeof x === 'string') {
      if (codificacion === 'latin1' || codificacion === 'binary') {
        const b = new BufferWeb(x.length);
        for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i) & 255;
        return b;
      }
      if (codificacion === 'utf8' || codificacion === 'utf-8') { const u = new TextEncoder().encode(x); const b = new BufferWeb(u.length); b.set(u); return b; }
      throw new Error('Codificación no soportada en la versión web: ' + codificacion);
    }
    const b = new BufferWeb(x.length);
    b.set(x);
    return b;
  }
  static concat(lista) {
    const total = lista.reduce((n, p) => n + p.length, 0);
    const salida = new BufferWeb(total);
    let o = 0;
    for (const p of lista) { salida.set(p, o); o += p.length; }
    return salida;
  }
  readUInt32BE(o) { return this[o] * 0x1000000 + ((this[o + 1] << 16) | (this[o + 2] << 8) | this[o + 3]); }
  readUInt16BE(o) { return (this[o] << 8) | this[o + 1]; }
  toString(codificacion = 'utf8', desde = 0, hasta = this.length) {
    const parte = this.subarray(desde, hasta);
    if (codificacion === 'latin1' || codificacion === 'binary') {
      let s = '';
      for (let i = 0; i < parte.length; i += 8192) s += String.fromCharCode.apply(null, parte.subarray(i, i + 8192));
      return s;
    }
    return new TextDecoder().decode(parte);
  }
}

// Un flujo zlib válido que guarda los datos SIN comprimir (bloques "stored"). Para una carta de una página basta, y
// cualquier lector de PDF lo entiende igual que uno comprimido.
const zlibWeb = {
  deflateSync(datos) {
    const bloques = Math.max(1, Math.ceil(datos.length / 65535));
    const salida = new BufferWeb(2 + datos.length + bloques * 5 + 4);
    let o = 0;
    salida[o++] = 0x78; salida[o++] = 0x01;
    for (let b = 0; b < bloques; b++) {
      const desde = b * 65535, largo = Math.min(65535, datos.length - desde);
      salida[o++] = b === bloques - 1 ? 1 : 0;
      salida[o++] = largo & 255; salida[o++] = largo >> 8;
      salida[o++] = ~largo & 255; salida[o++] = (~largo >> 8) & 255;
      salida.set(datos.subarray(desde, desde + largo), o); o += largo;
    }
    let a = 1, c = 0; // suma de comprobación Adler-32
    for (let i = 0; i < datos.length; i++) { a = (a + datos[i]) % 65521; c = (c + a) % 65521; }
    const adler = ((c << 16) | a) >>> 0;
    salida[o++] = adler >>> 24; salida[o++] = (adler >>> 16) & 255; salida[o++] = (adler >>> 8) & 255; salida[o++] = adler & 255;
    return salida;
  },
  inflateSync() { throw new Error('Los logos PNG no se pueden leer en la versión web: se convierten a JPEG antes.'); },
};

const definiciones = {}, cargados = {};
const definir = (id, fn) => { definiciones[id] = fn; };
const ESTUBS = { fs: {}, path: { join: (...p) => p.filter(Boolean).join('/'), dirname: p => String(p).replace(/\/[^/]*$/, '') }, zlib: zlibWeb };
// Resuelve './x' y '../x' entre los módulos del paquete (sin usar nada propio de Node).
const resolver = (desde, pedido) => { const base = desde.split('/').slice(0, -1); for (const p of pedido.replace(/\.js$/, '').split('/')) { if (p === '.' || p === '') continue; if (p === '..') base.pop(); else base.push(p); } return base.join('/'); };
function cargar(id) {
  if (cargados[id]) return cargados[id].exports;
  if (!definiciones[id]) throw new Error('Módulo no incluido en la versión web: ' + id);
  const modulo = cargados[id] = { exports: {} };
  const pedir = nombre => {
    if (nombre.startsWith('.')) return cargar(resolver(id, nombre));
    if (nombre in ESTUBS) return ESTUBS[nombre];
    throw new Error('"' + nombre + '" no existe en la versión web (lo pidió ' + id + ')');
  };
  definiciones[id](modulo, modulo.exports, pedir, 'lib', BufferWeb);
  return modulo.exports;
}

definir("lib/csv", function (module, exports, require, __dirname, Buffer) {
// Parser CSV mínimo (comillas, comas y saltos de línea dentro de campos)
function parseCSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  texto = texto.replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some(x => x !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some(x => x !== '')) filas.push(fila);
  return filas;
}
module.exports = { parseCSV };

});

definir("lib/normalizar", function (module, exports, require, __dirname, Buffer) {
const REGIONES = [
  'ARICA - PARINACOTA', 'TARAPACÁ', 'ANTOFAGASTA', 'ATACAMA', 'COQUIMBO', 'VALPARAÍSO',
  'METROPOLITANA', 'O´HIGGINS', 'MAULE', 'ÑUBLE', 'BÍO BÍO', 'ARAUCANÍA', 'LOS RÍOS',
  'LOS LAGOS', 'AYSÉN', 'MAGALLANES Y ANTÁRTICA CHILENA',
];

const sinTildes = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function normalizarRut(valor) {
  const limpio = String(valor || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return { valor: '', valido: false };
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  const formateado = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  return { valor: formateado, valido: esperado === dv };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "15 de marzo de 1985" -> "15 3 1985". Los meses se reconocen por sus tres primeras letras.
function fechaConMesNumerico(s) {
  return sinTildes(s).toLowerCase()
    .replace(/\bde\b/g, ' ')
    .replace(/\b(sept?|set)[a-z]*/g, 'sep')
    .replace(/\b([a-z]{3})[a-z]*\b/g, (p, tres) => (MESES.includes(tres) ? String(MESES.indexOf(tres) + 1) : p))
    .replace(/[\s.,]+$/, '');
}

function normalizarFecha(valor) {
  const s = fechaConMesNumerico(String(valor || '').trim());
  let d, m, a, r;
  if ((r = s.match(/^(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})\s*[\/\-. ]\s*(\d{2,4})$/))) { [, d, m, a] = r; }
  else if ((r = s.match(/^(\d{4})\s*[\/\-. ]\s*(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})$/))) { [, a, m, d] = r; }
  else if ((r = s.match(/^(\d{2})(\d{2})(\d{4})$/))) { [, d, m, a] = r; }
  else return { valor: '', valida: false };
  d = Number(d); m = Number(m); a = Number(a);
  if (a < 100) a += a > 30 ? 1900 : 2000;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) {
    return { valor: '', valida: false };
  }
  return { valor: f.toISOString().slice(0, 10), valida: true };
}

// "Marca temporal" de Google Forms (d/m/aaaa hh:mm:ss, orden chileno) -> "aaaa-mm-ddThh:mm:ss".
// Si trae solo la fecha devuelve "aaaa-mm-dd"; si no es una fecha (hay filas con texto suelto) devuelve ''.
function normalizarMarca(valor) {
  const m = String(valor || '').match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/);
  if (!m) return '';
  const [d, mes, a] = [m[1], m[2], m[3]].map(Number);
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return '';
  const fecha = f.toISOString().slice(0, 10);
  if (m[4] === undefined) return fecha;
  const [hh, mm, ss] = [m[4], m[5], m[6] || 0].map(Number);
  if (hh > 23 || mm > 59 || ss > 59) return fecha;
  const p = n => String(n).padStart(2, '0');
  return `${fecha}T${p(hh)}:${p(mm)}:${p(ss)}`;
}

function edad(fechaISO, hoy = new Date()) {
  if (!fechaISO) return null;
  const [a, m, d] = fechaISO.split('-').map(Number);
  let e = hoy.getUTCFullYear() - a;
  const mes = hoy.getUTCMonth() + 1;
  if (mes < m || (mes === m && hoy.getUTCDate() < d)) e--;
  return e;
}

function normalizarTelefono(valor) {
  let n = String(valor || '').replace(/\D/g, '');
  if (n.startsWith('56') && n.length >= 11) n = n.slice(2);
  if (n.length !== 9) return { valor: String(valor || '').trim(), valido: false };
  return { valor: `+56 ${n[0]} ${n.slice(1, 5)} ${n.slice(5)}`, valido: true };
}

function normalizarRegion(valor) {
  const partes = String(valor || '').split(',').map(p => p.trim()).filter(Boolean);
  const reconocidas = partes
    .map(p => REGIONES.find(r => sinTildes(r) === sinTildes(p)))
    .filter(Boolean);
  return { valor: reconocidas.join(', '), multiple: reconocidas.length > 1, valida: reconocidas.length >= 1 };
}

const normalizarTexto = v => String(v || '').trim().replace(/\s+/g, ' ');
const normalizarComuna = v => normalizarTexto(v).toUpperCase();
const normalizarCorreo = v => normalizarTexto(v).toLowerCase();
const correoValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

module.exports = {
  REGIONES, normalizarRut, normalizarFecha, normalizarMarca, edad, normalizarTelefono, normalizarRegion,
  normalizarTexto, normalizarComuna, normalizarCorreo, correoValido, sinTildes,
};

});

definir("lib/etapas", function (module, exports, require, __dirname, Buffer) {
const { sinTildes } = require('./normalizar');

// La columna "Gestión" de la planilla es texto libre (65 variantes para unas pocas etapas reales).
// Las reglas se evalúan en orden: gana la primera que coincide.
const REGLAS = [
  ['Renuncia', t => /RENUNCI/.test(t) && !/RENUNCIA A DELEGADA/.test(t)],
  ['No califica', t => /NO CALIFICA/.test(t)],
  ['Socia', t => /PAGANDO CUOTAS|PAGO (ANUAL )?REALIZADO|FUNDADORA|DIRECTORA|DELEGADA/.test(t)],
  ['Aprobada', t => /APROBAD/.test(t) && !/SOLICITUD APROBACION/.test(t)],
  ['Con documentos', t => /CON CARTA/.test(t) && !/SIN CARTA/.test(t)],
  ['Pendiente de carta', () => true],
];

const ETAPAS = ['Pendiente de carta', 'Con documentos', 'Aprobada', 'Socia', 'Renuncia', 'No califica', 'Sin gestión'];

function clasificarEtapa(texto) {
  const t = sinTildes(String(texto || '')).replace(/\s+/g, ' ').trim();
  if (!t) return 'Sin gestión';
  return REGLAS.find(([, f]) => f(t))[0];
}

function extraerCargos(texto) {
  const t = sinTildes(String(texto || ''));
  return ['FUNDADORA', 'DIRECTORA', 'DELEGADA']
    .filter(c => t.includes(c) && !(c === 'DELEGADA' && /RENUNCIA A DELEGADA/.test(t)))
    .map(c => c[0] + c.slice(1).toLowerCase());
}

const MODALIDADES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

// Devuelve la modalidad en mayúsculas si es reconocible; los valores basura ("X", el encabezado repetido) se descartan.
function normalizarModalidad(valor) {
  const t = sinTildes(String(valor || '')).trim();
  const encontradas = MODALIDADES.filter(m => t.includes(m));
  return encontradas.join(' + ');
}

function normalizarMonto(valor) {
  const n = String(valor || '').replace(/[^\d]/g, '');
  return n && /^[\d.$\s]+$/.test(String(valor).trim()) ? Number(n) : null;
}

module.exports = { ETAPAS, clasificarEtapa, extraerCargos, normalizarModalidad, normalizarMonto };

});

definir("lib/pasos", function (module, exports, require, __dirname, Buffer) {
// Pasos de admisión de cada postulante: lo que hoy está escrito a mano en la columna "Gestión".
// Cada paso hecho guarda una fecha y una nota opcional. Se guardan junto con las correcciones.
const PASOS = [
  { id: 'cartaEnviada', etiqueta: 'Carta enviada' },
  { id: 'cartaFirmada', etiqueta: 'Carta firmada recibida' },
  { id: 'carnet', etiqueta: 'Copia de carnet recibida' },
  { id: 'identidad', etiqueta: 'Identidad verificada', ayuda: 'Se revisó el carnet para validar la identidad y la copia se borró' },
  { id: 'revisada', etiqueta: 'Revisada por secretaría' },
  { id: 'aprobada', etiqueta: 'Aprobada por el directorio' },
  { id: 'bienvenida', etiqueta: 'Bienvenida enviada' },
  { id: 'cuota', etiqueta: 'Primera cuota pagada' },
];
const IDS = PASOS.map(p => p.id);

// Días sin respuesta a la carta antes de avisar para hacer seguimiento. Es un supuesto: se pregunta a AMAGRO.
const PLAZO_RESPUESTA_DIAS = 15;

const RANGO = { 'Sin gestión': 0, 'Pendiente de carta': 1, 'Con documentos': 2, Aprobada: 3, Socia: 4 };
const TERMINALES = ['Renuncia', 'No califica'];

function fechaValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return a >= 2000 && a <= 2100 && f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
}

// Fecha local de hoy como aaaa-mm-dd.
function hoyISO(ahora = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

const diaUTC = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

// Valida un paso recibido del navegador. Devuelve { id, hecho, entrada } o { error }.
function validarPaso({ paso, hecho, fecha, nota }, ahora = new Date()) {
  if (!IDS.includes(paso)) return { error: 'Paso desconocido.' };
  if (typeof hecho !== 'boolean') return { error: 'Falta indicar si el paso está hecho.' };
  if (!hecho) return { id: paso, hecho: false };
  const f = fecha === undefined || fecha === '' ? hoyISO(ahora) : fecha;
  if (!fechaValida(f)) return { error: 'La fecha no es válida.' };
  // Se tolera un día de diferencia por el reloj del equipo; las fechas muy futuras son casi seguro un error.
  if (diaUTC(f) > diaUTC(hoyISO(ahora)) + 864e5) return { error: 'La fecha no puede ser futura.' };
  const n = nota === undefined || nota === null ? '' : String(nota).replace(/[\u0000-\u001F]/g, ' ').trim();
  if (n.length > 300) return { error: 'La nota es demasiado larga (máximo 300 caracteres).' };
  return { id: paso, hecho: true, entrada: { fecha: f, nota: n } };
}

// Valida los pasos guardados en un respaldo. Reconstruye el objeto solo con lo permitido.
function validarPasosGuardados(pasos) {
  if (pasos === undefined) return { pasos: {} };
  if (!pasos || typeof pasos !== 'object' || Array.isArray(pasos)) return { error: 'Los pasos del respaldo no tienen el formato correcto.' };
  const limpios = {};
  for (const [id, e] of Object.entries(pasos)) {
    const r = validarPaso({ paso: id, hecho: true, fecha: e && e.fecha, nota: e && e.nota }, new Date(8.64e15));
    if (r.error) return { error: `Paso "${id}" inválido en el respaldo: ${r.error}` };
    limpios[id] = r.entrada;
  }
  return { pasos: limpios };
}

// Etapa que dicen los pasos (la más avanzada), o null si no hay ninguno que la determine.
function etapaPorPasos(pasos = {}) {
  if (pasos.cuota) return 'Socia';
  if (pasos.aprobada || pasos.bienvenida) return 'Aprobada'; // la bienvenida solo se envía a quien ya fue aprobada
  if (pasos.cartaFirmada || pasos.carnet || pasos.identidad || pasos.revisada) return 'Con documentos';
  if (pasos.cartaEnviada) return 'Pendiente de carta';
  return null;
}

// Une la etapa que dice el texto de la planilla con la de los pasos: gana la más avanzada.
// Renuncia y No califica mandan siempre: son decisiones, no avances.
function combinarEtapa(deTexto, dePasos) {
  if (TERMINALES.includes(deTexto) || !dePasos) return deTexto;
  return (RANGO[dePasos] ?? 0) > (RANGO[deTexto] ?? 0) ? dePasos : deTexto;
}

const progreso = (pasos = {}) => IDS.filter(id => pasos[id]).length;

// Aviso de seguimiento: carta enviada hace tiempo y todavía sin carta firmada ni carnet.
function seguimiento(pasos = {}, hoy = new Date(), etapa = '') {
  if (TERMINALES.includes(etapa)) return null;
  if (!pasos.cartaEnviada || pasos.cartaFirmada || pasos.carnet) return null;
  const dias = Math.floor((diaUTC(hoyISO(hoy)) - diaUTC(pasos.cartaEnviada.fecha)) / 864e5);
  return dias >= PLAZO_RESPUESTA_DIAS ? { tipo: 'sinRespuesta', dias } : null;
}

module.exports = {
  PASOS, IDS, PLAZO_RESPUESTA_DIAS, fechaValida, hoyISO, validarPaso, validarPasosGuardados,
  etapaPorPasos, combinarEtapa, progreso, seguimiento,
};

});

definir("lib/cargos", function (module, exports, require, __dirname, Buffer) {
// Cargos y condición de las socias.
//  - «Socia fundadora» es una CONDICIÓN que no cambia: no es un cargo. Sale del texto de «Gestión» de la planilla y se puede corregir a mano.
//  - Los cargos son los de HOY (sin historial de períodos): Presidenta, Vicepresidenta, Secretaria, Tesorera, Directora y Delegada regional
//    (esta lleva la región; puede haber varias por región). Se pueden escribir cargos nuevos: la lista de abajo solo los sugiere.
// Los cargos de una socia se guardan en su ficha como texto JSON (campo «cargos»); si ese campo no existe todavía, se usan los que dice la planilla.
const { REGIONES } = require('./normalizar');
const N = require('./normalizar');

const DELEGADA = 'Delegada regional';
const CARGOS_SUGERIDOS = ['Presidenta', 'Vicepresidenta', 'Secretaria', 'Tesorera', 'Directora', DELEGADA];
const MAX_CARGOS = 10;

// Lo que dice la planilla en «Gestión». «Directora» NO se toma de ahí: esas etiquetas eran del Directorio antiguo.
function delPlanilla(texto) {
  const t = N.sinTildes(String(texto || ''));
  const delegada = t.includes('DELEGADA') && !/RENUNCIA A DELEGADA/.test(t);
  return { fundadora: t.includes('FUNDADORA'), cargos: delegada ? [{ cargo: DELEGADA, region: '' }] : [] };
}

// Lee el texto guardado en la ficha. Cualquier cosa rara se ignora (lista vacía).
function leer(texto) {
  try {
    const l = JSON.parse(texto);
    if (!Array.isArray(l)) return [];
    return l.filter(c => c && typeof c.cargo === 'string' && c.cargo.trim()).map(c => ({ cargo: c.cargo.trim(), region: typeof c.region === 'string' ? c.region : '' }));
  } catch { return []; }
}

const esDelegada = c => N.sinTildes(c).toLowerCase() === N.sinTildes(DELEGADA).toLowerCase();

// Valida la lista que llega de la pantalla. Devuelve { limpios } (la lista ya ordenada y sin repetidos) o { error }.
function validar(lista) {
  if (!Array.isArray(lista)) return { error: 'Los cargos no son válidos.' };
  if (lista.length > MAX_CARGOS) return { error: `Una socia puede tener hasta ${MAX_CARGOS} cargos.` };
  const limpios = [], vistos = new Set();
  for (const c of lista) {
    if (!c || typeof c.cargo !== 'string') return { error: 'Los cargos no son válidos.' };
    let cargo = c.cargo.replace(/\s+/g, ' ').trim();
    if (cargo.length < 3 || cargo.length > 60) return { error: 'El nombre del cargo debe tener entre 3 y 60 letras.' };
    if (esDelegada(cargo)) cargo = DELEGADA; // siempre con el mismo nombre
    let region = '';
    if (cargo === DELEGADA) {
      region = typeof c.region === 'string' ? c.region.trim() : '';
      if (region && !REGIONES.includes(region)) return { error: 'La región de la delegada no es válida.' };
    } else if (c.region) return { error: `El cargo «${cargo}» no lleva región.` };
    const clave = N.sinTildes(cargo).toLowerCase() + '|' + region;
    if (vistos.has(clave)) return { error: `El cargo «${cargo}»${region ? ' de ' + region : ''} está repetido.` };
    vistos.add(clave);
    limpios.push({ cargo, region });
  }
  return { limpios };
}

// «Delegada regional · MAULE», o «Delegada regional · falta la región».
const etiqueta = c => (c.cargo === DELEGADA ? `${c.cargo} · ${c.region || 'falta la región'}` : c.cargo);

module.exports = { DELEGADA, CARGOS_SUGERIDOS, MAX_CARGOS, delPlanilla, leer, validar, etiqueta };

});

definir("lib/procesar", function (module, exports, require, __dirname, Buffer) {
const { parseCSV } = require('./csv');
const N = require('./normalizar');
const E = require('./etapas');
const P = require('./pasos');
const C = require('./cargos');

// Cada campo se detecta por palabras clave en el encabezado, porque la planilla real
// puede tener mayúsculas, tildes o texto extra.
const CAMPOS = {
  marca: ['marca temporal', 'timestamp'],
  correo: ['correo', 'email'],
  nombre: ['nombre'],
  rut: ['rut'],
  nacimiento: ['nacimiento'],
  telefono: ['telefono', 'telef'],
  region: ['region'],
  comuna: ['comuna'],
  direccion: ['direccion'],
  profesion: ['profesion', 'actividad'],
  situacion: ['independiente', 'dependiente'],
  empresa: ['empresa', 'organizacion'],
  origen: ['enteraste'],
};

// Columnas de gestión interna: existen en la planilla pero no en el formulario.
// Si faltan no es un error, así que no se reportan como "no encontradas".
const CAMPOS_GESTION = {
  gestion: ['gestion'],
  resultado: ['aprobada'],
  modalidad: ['modalidad'],
  ingreso: ['ingreso'],
  motivacion: ['motivacion'],
  observaciones: ['observaciones'],
};

function mapearColumnas(encabezados) {
  const mapa = {};
  const usadas = new Set();
  for (const [campo, claves] of Object.entries({ ...CAMPOS, ...CAMPOS_GESTION })) {
    const idx = encabezados.findIndex((h, i) =>
      !usadas.has(i) && claves.some(k => N.sinTildes(h).toLowerCase().includes(k)));
    if (idx >= 0) { mapa[campo] = idx; usadas.add(idx); }
  }
  // Columnas sin título que acompañan a una con título: citación y asistencia van tras "ingreso";
  // una segunda nota va tras "observaciones".
  const sinTitulo = i => i < encabezados.length && !encabezados[i].trim();
  if (mapa.ingreso !== undefined) {
    if (sinTitulo(mapa.ingreso + 1)) mapa.citacion = mapa.ingreso + 1;
    if (sinTitulo(mapa.ingreso + 2)) mapa.asistencia = mapa.ingreso + 2;
  }
  if (mapa.observaciones !== undefined && sinTitulo(mapa.observaciones + 1)) {
    mapa.observaciones2 = mapa.observaciones + 1;
  }
  return mapa;
}

// Campos que se pueden corregir desde la app. 'etapa' se guarda aparte porque la planilla
// solo tiene texto libre en "Gestión".
const EDITABLES = ['nombre', 'rut', 'correo', 'nacimiento', 'telefono', 'region', 'comuna', 'direccion',
  'profesion', 'situacion', 'empresa', 'origen', 'resultado', 'modalidad', 'ingreso', 'citacion',
  'asistencia', 'observaciones', 'etapa', 'inscripcion', 'duplicada', 'inactiva', 'fundadora', 'cargos'];

// La clave identifica una postulación aunque cambie su posición en la planilla:
// fecha y hora del envío + correo original (o RUT + nombre si la fila se agregó a mano).
function claveDe(fila, mapa) {
  const c = campo => (mapa[campo] === undefined ? '' : String(fila[mapa[campo]] || '').trim());
  if (c('marca')) return `${c('marca')}|${c('correo').toLowerCase()}`;
  return `rut:${N.sinTildes(c('rut')).replace(/[^0-9K]/g, '')}|${N.sinTildes(c('nombre')).replace(/\s+/g, ' ')}`;
}

function procesarFila(fila, mapa, hoy, numero, ed = {}, pasos = {}) {
  const crudo = campo => (mapa[campo] === undefined ? '' : fila[mapa[campo]] || '');
  const observacionesOriginales = [crudo('observaciones'), crudo('observaciones2')].map(N.normalizarTexto).filter(Boolean).join(' · ');
  // Los valores editados reemplazan a los de la planilla antes de validar, así las alertas se recalculan.
  const editados = [], originales = {};
  const original = campo => (campo === 'observaciones' ? observacionesOriginales : crudo(campo));
  for (const campo of EDITABLES) {
    // 'duplicada' (clave de la postulación principal) no es una corrección de datos: se muestra aparte.
    if (campo === 'etapa' || campo === 'duplicada' || campo === 'inactiva' || campo === 'fundadora' || campo === 'cargos' || !(campo in ed)) continue;
    if (String(ed[campo]).trim() !== String(original(campo)).trim()) {
      editados.push(campo); originales[campo] = original(campo);
    }
  }
  const v = campo => {
    if (editados.includes(campo)) return ed[campo];
    if (campo === 'observaciones2' && editados.includes('observaciones')) return '';
    return crudo(campo);
  };
  const alertas = [];
  const planilla = C.delPlanilla(v('gestion'));
  const cargosDetalle = typeof ed.cargos === 'string' ? C.leer(ed.cargos) : planilla.cargos;
  // Etapa: la del texto de "Gestión" unida con la de los pasos (gana la más avanzada); una edición manual manda.
  const etapaCalculada = P.combinarEtapa(E.clasificarEtapa(v('gestion')), P.etapaPorPasos(pasos));
  let etapa = etapaCalculada;
  if (E.ETAPAS.includes(ed.etapa) && ed.etapa !== etapaCalculada) { editados.push('etapa'); originales.etapa = etapaCalculada; etapa = ed.etapa; }
  const rut = N.normalizarRut(v('rut'));
  const nac = N.normalizarFecha(v('nacimiento'));
  const tel = N.normalizarTelefono(v('telefono'));
  const reg = N.normalizarRegion(v('region'));
  const correo = N.normalizarCorreo(v('correo'));
  const e = N.edad(nac.valor, hoy);

  if (!rut.valido) alertas.push('RUT inválido');
  if (!nac.valida) alertas.push('Fecha de nacimiento ilegible');
  else if (e < 18 || e > 90) alertas.push(`Fecha de nacimiento dudosa (edad calculada: ${e})`);
  else if (e < 25) alertas.push(`Menor de 25 años (${e})`);
  if (!tel.valido) alertas.push('Teléfono con formato dudoso');
  if (!reg.valida) alertas.push('Región no reconocida');
  if (reg.multiple) alertas.push('Marcó más de una región');
  if (!N.correoValido(correo)) alertas.push('Correo inválido');

  return {
    marca: v('marca'),
    postulacion: N.normalizarMarca(v('marca')),
    correo,
    nombre: N.normalizarTexto(v('nombre')).toUpperCase(),
    rut: rut.valor || N.normalizarTexto(v('rut')),
    nacimiento: nac.valor,
    edad: e,
    telefono: tel.valor,
    region: reg.valor || N.normalizarTexto(v('region')),
    comuna: N.normalizarComuna(v('comuna')),
    direccion: N.normalizarTexto(v('direccion')),
    profesion: N.normalizarTexto(v('profesion')),
    situacion: N.normalizarTexto(v('situacion')).toUpperCase(),
    empresa: N.normalizarTexto(v('empresa')),
    origen: N.normalizarTexto(v('origen')),
    // Gestión interna
    fila: numero,
    gestion: N.normalizarTexto(v('gestion')),
    etapa,
    // Condición y cargos: lo que se anotó en la ficha manda; si no hay nada anotado, vale lo que dice la planilla (sin «Directora»: era del Directorio antiguo).
    fundadora: ed.fundadora === 'si' ? true : ed.fundadora === 'no' ? false : planilla.fundadora,
    cargosDetalle,
    cargos: cargosDetalle.map(C.etiqueta),
    resultado: N.normalizarTexto(v('resultado')),
    modalidad: E.normalizarModalidad(v('modalidad')),
    ingreso: E.normalizarMonto(v('ingreso')),
    citacion: N.normalizarTexto(v('citacion')),
    asistencia: N.normalizarTexto(v('asistencia')),
    inscripcion: N.normalizarTexto(v('inscripcion')), // N° de inscripción como socia (viene de la planilla de socias)
    motivacion: N.normalizarTexto(v('motivacion')),
    observaciones: [v('observaciones'), v('observaciones2')].map(N.normalizarTexto).filter(Boolean).join(' · '),
    clave: claveDe(fila, mapa),
    // «No activa»: la administración dejó de gestionar esta postulación (se oculta, no se borra). 'si' o vacío.
    inactiva: ed.inactiva === 'si',
    // Si alguien la marcó como duplicada de otra postulación, aquí va la clave de la principal (si no, vacío).
    duplicadaDe: typeof ed.duplicada === 'string' && ed.duplicada.trim() && ed.duplicada.trim() !== claveDe(fila, mapa) ? ed.duplicada.trim() : '',
    editados,
    originales,
    pasos,
    progreso: P.progreso(pasos),
    seguimiento: ed.inactiva === 'si' ? null : P.seguimiento(pasos, hoy, etapa),
    alertas,
  };
}

// Fracción de palabras del nombre más corto que aparecen en el otro (1 = uno contiene al otro).
function similitudNombres(a, b) {
  const palabras = s => new Set(N.sinTildes(s).split(/\s+/).filter(Boolean));
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 1;
  return [...A].filter(p => B.has(p)).length / Math.min(A.size, B.size);
}

// ediciones: { [clave]: { campo: valor } } con las correcciones hechas en la app.
function procesarCSV(texto, hoy = new Date(), ediciones = {}, pasosPorClave = {}) {
  const filas = parseCSV(texto);
  if (filas.length < 1) return { columnasNoEncontradas: Object.keys(CAMPOS), registros: [] };
  const mapa = mapearColumnas(filas[0]);
  // Algunas filas de la planilla repiten el encabezado a mitad de la hoja: se descartan al final
  // (después de numerar, para que "fila N" siga coincidiendo con la planilla).
  const celdaRut = f => mapa.rut === undefined ? '' : N.sinTildes(f[mapa.rut] || '').trim();
  const esEncabezado = f => mapa.rut !== undefined && celdaRut(f) === celdaRut(filas[0]);
  const registros = filas.slice(1).map((f, i) => ({
    ...procesarFila(f, mapa, hoy, i + 2, ediciones[claveDe(f, mapa)], pasosPorClave[claveDe(f, mapa)]),
    _encabezado: esEncabezado(f),
  }));

  // Duplicados: filas que comparten RUT válido o correo. Se agrupan de forma transitiva
  // (A comparte RUT con B y B comparte correo con C => las tres son la misma persona).
  const padre = registros.map((_, i) => i);
  const raiz = i => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const vistos = { rut: new Map(), correo: new Map() };
  // Las filas marcadas como duplicadas ya fueron resueltas: no cuentan para detectar duplicados ni dan alertas.
  const resuelta = r => r._encabezado || !!r.duplicadaDe;
  registros.forEach((r, i) => {
    if (resuelta(r)) return;
    for (const clave of ['rut', 'correo']) {
      if (!r[clave]) continue;
      if (clave === 'rut' && r.alertas.includes('RUT inválido')) continue;
      if (vistos[clave].has(r[clave])) {
        const j = vistos[clave].get(r[clave]);
        registros[j].alertas.push(`Duplicado (${clave}) con fila ${i + 2}`);
        r.alertas.push(`Duplicado (${clave}) con fila ${j + 2}`);
        padre[raiz(i)] = raiz(j);
      } else vistos[clave].set(r[clave], i);
    }
  });

  const grupos = new Map();
  registros.forEach((r, i) => {
    if (resuelta(r)) return;
    const k = raiz(i);
    (grupos.get(k) || grupos.set(k, []).get(k)).push(r);
  });
  for (const g of grupos.values()) {
    for (const r of g) {
      r.relacionadas = g.filter(o => o !== r)
        .map(o => ({ fila: o.fila, marca: o.marca, nombre: o.nombre, etapa: o.etapa }));
      for (const o of r.relacionadas) {
        if (o.etapa === 'No califica' && r.etapa !== 'No califica') {
          r.alertas.push(`Otra postulación suya figura como "No califica" (fila ${o.fila})`);
        }
        if (o.etapa === 'Renuncia' && r.etapa !== 'Renuncia') {
          r.alertas.push(`Otra postulación suya figura como "Renuncia" (fila ${o.fila})`);
        }
        if (['Aprobada', 'Socia'].includes(r.etapa) && ['Aprobada', 'Socia'].includes(o.etapa)) {
          r.alertas.push(`Figura como aprobada o socia más de una vez (fila ${o.fila})`);
        }
        if (similitudNombres(r.nombre, o.nombre) < 0.5) {
          r.alertas.push(`Mismo RUT o correo con un nombre distinto (fila ${o.fila})`);
        }
      }
    }
  }
  registros.forEach(r => { r.relacionadas = r.relacionadas || []; });
  // A cada duplicada se le indica cuál es su principal (si todavía existe en la planilla).
  const porClave = new Map(registros.filter(r => !r._encabezado).map(r => [r.clave, r]));
  for (const r of registros) {
    if (!r.duplicadaDe) continue;
    const p = porClave.get(r.duplicadaDe);
    r.duplicadaDeInfo = p ? { fila: p.fila, nombre: p.nombre, etapa: p.etapa, marca: p.marca } : null;
  }

  return {
    columnasNoEncontradas: Object.keys(CAMPOS).filter(c => mapa[c] === undefined),
    registros: registros.filter(r => !r._encabezado),
    hayGestion: mapa.gestion !== undefined,
  };
}

module.exports = { procesarCSV, mapearColumnas, EDITABLES };

});

definir("lib/ediciones", function (module, exports, require, __dirname, Buffer) {
const { EDITABLES } = require('./procesar');
const { ETAPAS } = require('./etapas');
const { validarPasosGuardados } = require('./pasos');
const { validar: validarCargos } = require('./cargos');

// Valida un conjunto de campos editados. Devuelve { limpios } o { error }.
function validarCampos(cambios) {
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) return { error: 'Datos de edición inválidos.' };
  const limpios = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (!EDITABLES.includes(campo)) return { error: `El campo "${campo}" no se puede editar.` };
    if (typeof valor !== 'string' && typeof valor !== 'number') return { error: `Valor inválido en "${campo}".` };
    if (String(valor).length > 2000) return { error: `"${campo}" es demasiado largo.` };
    limpios[campo] = String(valor);
  }
  if (limpios.etapa !== undefined && !ETAPAS.includes(limpios.etapa)) return { error: 'Etapa no reconocida.' };
  if (limpios.fundadora !== undefined && !['si', 'no'].includes(limpios.fundadora)) return { error: 'La condición de socia fundadora no es válida.' };
  if (limpios.cargos !== undefined) {
    let lista;
    try { lista = JSON.parse(limpios.cargos); } catch { return { error: 'Los cargos no son válidos.' }; }
    const v = validarCargos(lista);
    if (v.error) return { error: v.error };
    limpios.cargos = JSON.stringify(v.limpios); // se guarda ya limpio y ordenado
  }
  return { limpios };
}

// Valida un archivo de respaldo completo: { [clave]: { campos: {...}, modificado } }.
// Se reconstruye desde cero con los valores ya validados, así no entra nada inesperado.
function validarRespaldo(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return { error: 'El archivo no es un respaldo de correcciones.' };
  const limpio = {};
  for (const [clave, entrada] of Object.entries(datos)) {
    // Cada entrada trae correcciones (campos), pasos de admisión, o ambos. Los respaldos antiguos solo traen campos.
    if (!entrada || typeof entrada !== 'object' || (!entrada.campos && !entrada.pasos)) return { error: 'El archivo no es un respaldo de correcciones.' };
    const r = validarCampos(entrada.campos || {});
    if (r.error) return { error: `Respaldo inválido: ${r.error}` };
    const p = validarPasosGuardados(entrada.pasos);
    if (p.error) return { error: `Respaldo inválido: ${p.error}` };
    limpio[clave] = {
      campos: r.limpios,
      ...(Object.keys(p.pasos).length ? { pasos: p.pasos } : {}),
      modificado: typeof entrada.modificado === 'string' ? entrada.modificado : new Date().toISOString(),
    };
  }
  return { respaldo: limpio };
}

// Decide si hay que recordar que se descargue un respaldo. Avisa solo cuando hay correcciones
// hechas después del último respaldo descargado y han pasado al menos `umbralDias` días desde
// ese respaldo (o, si nunca se descargó uno, desde la primera de esas correcciones).
// Devuelve null si no hay nada que avisar, o { dias, pendientes, nunca }.
function avisoRespaldo(ediciones, ultimoRespaldo, ahora = new Date(), umbralDias = 7) {
  const fecha = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const ref = ultimoRespaldo ? fecha(ultimoRespaldo) : null;
  const pendientes = Object.values(ediciones || {})
    .map(e => e && fecha(e.modificado))
    .filter(d => d && (!ref || d > ref));
  if (!pendientes.length) return null;
  const desde = ref || new Date(Math.min(...pendientes));
  const dias = Math.floor((ahora - desde) / 864e5);
  return dias >= umbralDias ? { dias, pendientes: pendientes.length, nunca: !ref } : null;
}

module.exports = { validarCampos, validarRespaldo, avisoRespaldo };

});

definir("lib/hoja", function (module, exports, require, __dirname, Buffer) {
// Convierte el enlace de una planilla de Google en su enlace de descarga CSV.
// Solo se aceptan enlaces de docs.google.com (el servidor hace la petición, así que se restringe el destino).
function urlExportacion(entrada) {
  let u;
  try { u = new URL(String(entrada).trim()); } catch { throw new Error('El enlace no es válido'); }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') {
    throw new Error('Solo se aceptan enlaces de Google Sheets (docs.google.com)');
  }
  const id = u.pathname.match(/\/spreadsheets\/d\/(?:e\/)?([\w-]+)/);
  if (!id) throw new Error('No se reconoce el enlace como una planilla de Google');
  // Hoja ya publicada en la web como CSV: se usa tal cual
  if (u.pathname.includes('/pub') && u.searchParams.get('output') === 'csv') return u.href;
  const gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv&gid=${gid}`;
}

// Descarga la hoja y comprueba que realmente llegó un CSV y no una página de inicio de sesión.
async function descargarHoja(entrada) {
  const r = await fetch(urlExportacion(entrada), { redirect: 'follow' });
  const tipo = r.headers.get('content-type') || '';
  if (!r.ok || tipo.includes('text/html')) {
    throw new Error('Google no entregó la planilla. Debe estar compartida como "Cualquier persona con el enlace: lector".');
  }
  return r.text();
}

module.exports = { urlExportacion, descargarHoja };

});

definir("lib/socias", function (module, exports, require, __dirname, Buffer) {
const { parseCSV } = require('./csv');
const N = require('./normalizar');

// Planilla de socias que entrega AMAGRO: una fila por socia, con su RUT, N° de inscripción y estado.
// Aquí solo se leen esos datos para actualizar el listado; los pagos de la planilla no se usan.
// Todo es de solo lectura: devuelve un plan de cambios y no guarda nada.

const sinAcentos = s => N.sinTildes(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();
const rutLimpio = s => String(s || '').replace(/[^0-9kK]/g, '').toUpperCase();
const textoNorm = s => sinAcentos(s).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const limpiaEspacios = s => String(s || '').replace(/\s+/g, ' ').trim();

// Encuentra la fila de encabezados (la planilla tiene títulos de año encima) y las columnas que se usan.
function leerSocias(texto) {
  const filas = parseCSV(String(texto || ''));
  let cab = -1;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const celdas = filas[i].map(sinAcentos);
    if (celdas.includes('rut') && celdas.some(c => c.startsWith('nombre'))) { cab = i; break; }
  }
  if (cab < 0) return { error: 'No se reconoce la planilla: no encuentro una fila con las columnas RUT y NOMBRE.' };
  const celdas = filas[cab].map(sinAcentos);
  const col = pred => celdas.findIndex(pred);
  const c = {
    rut: col(x => x === 'rut'),
    nombre: col(x => x.startsWith('nombre')),
    correo: col(x => x === 'mail' || x === 'correo' || x === 'email'),
    inscripcion: col(x => /inscripcion/.test(x)),
    estado: col(x => x === 'estado'),
  };
  const faltan = [];
  if (c.inscripcion < 0) faltan.push('N° INSCRIPCIÓN');
  if (c.estado < 0) faltan.push('ESTADO');
  if (faltan.length) return { error: `A la planilla le faltan estas columnas: ${faltan.join(', ')}.` };
  const dato = (f, i) => (i < 0 ? '' : limpiaEspacios(f[i]));

  const porRut = new Map(), avisos = [];
  for (const f of filas.slice(cab + 1)) {
    const rut = rutLimpio(dato(f, c.rut));
    if (!rut) continue;
    const socia = { rut, nombre: dato(f, c.nombre), correo: dato(f, c.correo), inscripcion: dato(f, c.inscripcion), estado: dato(f, c.estado) };
    if (porRut.has(rut)) avisos.push(`El RUT ${N.normalizarRut(rut).valor || rut} aparece más de una vez en la planilla de socias; se usa la última fila.`);
    porRut.set(rut, socia);
  }
  return { socias: [...porRut.values()], avisos };
}

// Compara las socias con nuestro listado y arma el plan:
//  - cambios: lo que se aplica directo (etapa "Socia" y N° de inscripción), por postulación;
//  - revisiones: diferencias de nombre o correo, que la persona acepta o no una por una;
//  - conflictos: socias que en el listado figuran como "Renuncia" o "No califica": se muestran, no se cambian.
function planificar(socias, registros) {
  const porRut = new Map();
  for (const r of registros) {
    if (r._encabezado) continue;
    const k = rutLimpio(r.rut);
    if (k) (porRut.get(k) || porRut.set(k, []).get(k)).push(r);
  }
  const plan = { cambios: [], revisiones: [], conflictos: [], sinCoincidencia: [], noActivas: [], resumen: {} };
  const personasASocia = new Set();
  let inscripciones = 0, encontradas = 0;

  for (const s of socias) {
    const filas = porRut.get(s.rut);
    if (!filas) { plan.sinCoincidencia.push({ rut: N.normalizarRut(s.rut).valor || s.rut, nombre: s.nombre }); continue; }
    if (!/^activa/.test(sinAcentos(s.estado))) { plan.noActivas.push({ nombre: s.nombre, estado: s.estado }); continue; }
    encontradas++;
    const reciente = filas.slice().sort((a, b) => String(a.postulacion).localeCompare(String(b.postulacion)) || a.fila - b.fila).pop();
    let inscrita = false;
    for (const r of filas) {
      const campos = {};
      if (r.etapa === 'Renuncia' || r.etapa === 'No califica') {
        // Contradice a la planilla de socias: no se toca nada de esta fila hasta que AMAGRO lo aclare.
        plan.conflictos.push({ clave: r.clave, fila: r.fila, nombre: r.nombre, etapa: r.etapa });
        continue;
      }
      if (r.etapa !== 'Socia') { campos.etapa = 'Socia'; personasASocia.add(s.rut); }
      if (s.inscripcion && r.inscripcion !== s.inscripcion) { campos.inscripcion = s.inscripcion; inscrita = true; }
      if (Object.keys(campos).length) plan.cambios.push({ clave: r.clave, fila: r.fila, nombre: r.nombre, campos });
    }
    if (inscrita) inscripciones++;
    // Diferencias de datos: solo contra la postulación más reciente, y sin contar tildes ni mayúsculas.
    if (s.nombre && textoNorm(s.nombre) !== textoNorm(reciente.nombre)) {
      plan.revisiones.push({ id: `${reciente.clave}|nombre`, clave: reciente.clave, fila: reciente.fila, campo: 'nombre', hoy: reciente.nombre, nuevo: s.nombre.toUpperCase() });
    }
    if (s.correo && s.correo.toLowerCase() !== String(reciente.correo || '').toLowerCase()) {
      plan.revisiones.push({ id: `${reciente.clave}|correo`, clave: reciente.clave, fila: reciente.fila, campo: 'correo', hoy: reciente.correo, nuevo: s.correo.toLowerCase() });
    }
  }
  plan.resumen = {
    socias: socias.length,
    encontradas,
    pasanASocia: personasASocia.size,
    inscripciones,
    filasAfectadas: plan.cambios.length,
    revisiones: plan.revisiones.length,
    conflictos: plan.conflictos.length,
    sinCoincidencia: plan.sinCoincidencia.length,
    noActivas: plan.noActivas.length,
  };
  return plan;
}

// Junta los cambios directos con las revisiones aceptadas, por postulación: { [clave]: { campo: valor } }.
function camposAAplicar(plan, aceptadas = []) {
  const ok = new Set(aceptadas);
  const porClave = {};
  for (const c of plan.cambios) porClave[c.clave] = { ...(porClave[c.clave] || {}), ...c.campos };
  for (const r of plan.revisiones) if (ok.has(r.id)) porClave[r.clave] = { ...(porClave[r.clave] || {}), [r.campo]: r.nuevo };
  return porClave;
}

module.exports = { leerSocias, planificar, camposAAplicar };

});

definir("lib/correcciones", function (module, exports, require, __dirname, Buffer) {
const N = require('./normalizar');

// Corrección de datos por enlace: qué datos se le piden a la postulante y cómo se revisa lo que responde.

// Alertas que la propia persona puede resolver (las mismas que menciona el mensaje de la ficha).
const PIDE = [
  [/^RUT inválido/, 'rut'],
  [/^Fecha de nacimiento (ilegible|dudosa)/, 'nacimiento'],
  [/^Teléfono con formato dudoso/, 'telefono'],
  [/^(Región no reconocida|Marcó más de una región)/, 'region'],
];

const fechaCL = iso => (iso ? iso.split('-').reverse().join('/') : '');
const valorActual = (r, campo) => (campo === 'nacimiento' ? fechaCL(r.nacimiento) : String(r[campo] ?? ''));

// { campo: valorActual } de los datos con alerta de una postulación. Vacío si no hay nada que la persona pueda corregir.
function camposConAlerta(registro) {
  const pedir = {};
  for (const [re, campo] of PIDE) {
    if ((registro.alertas || []).some(a => re.test(a))) pedir[campo] = valorActual(registro, campo);
  }
  return pedir;
}

// Cómo se vería un valor propuesto y si pasa las mismas comprobaciones que usa la ficha.
function evaluarPropuesta(campo, valor, hoy = new Date()) {
  const v = String(valor ?? '');
  switch (campo) {
    case 'rut': { const r = N.normalizarRut(v); return { vista: r.valor || v, valido: !!r.valido }; }
    case 'telefono': { const r = N.normalizarTelefono(v); return { vista: r.valor || v, valido: !!r.valido }; }
    case 'region': { const r = N.normalizarRegion(v); return { vista: r.valor || v, valido: !!r.valida && !r.multiple }; }
    case 'correo': { const c = N.normalizarCorreo(v); return { vista: c, valido: !!N.correoValido(c) }; }
    case 'nacimiento': {
      const r = N.normalizarFecha(v);
      const e = r.valida ? N.edad(r.valor, hoy) : null;
      return { vista: r.valida ? fechaCL(r.valor) : v, valido: !!r.valida && e >= 18 && e <= 90 };
    }
    default: return { vista: v, valido: v.trim().length > 0 };
  }
}

module.exports = { camposConAlerta, evaluarPropuesta, valorActual, PIDE };

});

definir("lib/duplicados", function (module, exports, require, __dirname, Buffer) {
// Duplicados: personas con más de una postulación. Regla acordada con la administración: se deja como principal la
// postulación más reciente y las demás se marcan como duplicadas (campo 'duplicada' = clave de la principal).
// No se borra nada: se puede deshacer, y queda en el historial.
//
// Se propone solo lo seguro:
//  - 'socia':     alguna de las postulaciones ya es de una socia.
//  - 'mismo-rut': todas comparten un RUT válido y los nombres son equivalentes (mismas palabras salvo acentos,
//                 mayúsculas, un error de ortografía o un nombre omitido), sin «Renuncia» ni «No califica» de por medio.
// El resto queda "para revisar a mano".
const N = require('./normalizar');

const CAMPOS_COMPARADOS = ['nombre', 'correo', 'telefono', 'region', 'comuna', 'direccion', 'profesion', 'empresa'];
const norm = v => N.sinTildes(String(v || '')).toLowerCase().replace(/\s+/g, ' ').trim();

// Distancia de edición entre dos palabras (para tolerar una letra mal escrita).
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const palabras = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// ¿Es el mismo nombre? Cada palabra del más corto debe aparecer en el más largo (con a lo más una letra distinta en palabras
// de 5 letras o más). Así «Tabita Díaz Lobos» y «Tabita Magdalena Díaz Lobos» son equivalentes, pero «Ana Pérez» y «Ana Soto» no.
function nombresEquivalentes(a, b) {
  let A = palabras(a), B = palabras(b);
  if (!A.length || !B.length) return false;
  if (A.length > B.length) [A, B] = [B, A];
  if (A.length < 2) return false; // un nombre de una sola palabra no basta para dar por segura la identidad
  const libres = [...B];
  return A.every(p => {
    const i = libres.findIndex(q => q === p || (p.length >= 5 && q.length >= 5 && distancia(p, q) <= 1));
    if (i < 0) return false;
    libres.splice(i, 1);
    return true;
  });
}

// Grupos de postulaciones de una misma persona (según RUT o correo, ya calculados en `relacionadas`).
function gruposDePersonas(registros) {
  const activos = registros.filter(r => !r.duplicadaDe);
  const porFila = new Map(activos.map(r => [r.fila, r]));
  const visto = new Set();
  const grupos = [];
  for (const r of activos) {
    if (visto.has(r.fila) || !r.relacionadas.length) continue;
    const g = [], pendientes = [r];
    while (pendientes.length) {
      const x = pendientes.pop();
      if (visto.has(x.fila) || !porFila.has(x.fila)) continue;
      visto.add(x.fila); g.push(x);
      for (const o of x.relacionadas) if (porFila.has(o.fila)) pendientes.push(porFila.get(o.fila));
    }
    if (g.length > 1) grupos.push(g);
  }
  return grupos;
}

const tienePasos = r => !!r.pasos && Object.keys(r.pasos).length > 0;
// La más reciente por fecha de postulación; si empatan o no hay fecha, la que está más abajo en la planilla.
const masReciente = g => g.slice().sort((a, b) => (String(b.postulacion || '').localeCompare(String(a.postulacion || '')) || b.fila - a.fila))[0];

// Por qué un grupo no se propone (o null si es seguro como 'mismo-rut').
function motivoRevision(g) {
  const rut = g[0].rut;
  if (!rut || g.some(r => r.rut !== rut || r.alertas.includes('RUT inválido'))) return 'No comparten el mismo RUT válido';
  if (g.some(r => r.etapa === 'Renuncia' || r.etapa === 'No califica')) return 'Alguna postulación figura como «Renuncia» o «No califica»: decide una persona';
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (!nombresEquivalentes(g[i].nombre, g[j].nombre)) return 'Los nombres no parecen ser de la misma persona';
  if (g.filter(tienePasos).length > 1) return 'Más de una postulación tiene pasos de admisión marcados';
  return null;
}

const describir = (g, principal) => g.slice().sort((a, b) => a.fila - b.fila).map(r => ({
  fila: r.fila, clave: r.clave, nombre: r.nombre, correo: r.correo, marca: r.marca, postulacion: r.postulacion, etapa: r.etapa, principal: r === principal,
}));
const diferencias = g => CAMPOS_COMPARADOS.filter(k => new Set(g.map(r => norm(r[k]))).size > 1);

// { grupos: [{ tipo, principal, filas, difieren }], revisar: [{ filas, motivo }] }
function proponer(registros) {
  const grupos = [], revisar = [];
  for (const g of gruposDePersonas(registros)) {
    const deSocia = g.some(r => r.etapa === 'Socia');
    const motivo = deSocia ? null : motivoRevision(g);
    if (!deSocia && motivo) { revisar.push({ filas: describir(g, null), motivo }); continue; }
    const conPasos = g.filter(tienePasos);
    const principal = conPasos.length === 1 ? conPasos[0] : masReciente(g); // si solo una tiene avance, esa es la principal
    grupos.push({ tipo: deSocia ? 'socia' : 'mismo-rut', principal: principal.clave, filas: describir(g, principal), difieren: diferencias(g) });
  }
  const orden = x => x.filas[0].fila;
  return { grupos: grupos.sort((a, b) => orden(a) - orden(b)), revisar: revisar.sort((a, b) => orden(a) - orden(b)) };
}

// De lo que pidió la pantalla (claves de las principales) a lo que hay que guardar: { claveDuplicada: { duplicada: clavePrincipal } }.
// Solo se acepta lo que coincide con una propuesta actual: la pantalla no puede marcar cualquier cosa.
function planDeAplicacion(registros, principales) {
  const { grupos } = proponer(registros);
  const porPrincipal = new Map(grupos.map(g => [g.principal, g]));
  const porClave = {};
  for (const p of principales) {
    const g = porPrincipal.get(p);
    if (!g) return { error: 'Uno de los grupos ya cambió o no corresponde. Actualiza la lista e inténtalo de nuevo.' };
    for (const f of g.filas) if (!f.principal) porClave[f.clave] = { duplicada: p };
  }
  return { porClave };
}

module.exports = { proponer, planDeAplicacion, gruposDePersonas, nombresEquivalentes };

});

definir("lib/almacen", function (module, exports, require, __dirname, Buffer) {
const { ErrorSupabase } = require('./supabase');

// Las correcciones y los pasos de admisión viven en la tabla "ediciones" de Supabase, una fila por postulación:
//   { clave, campos: {...}, pasos: {...}, modificado, modificado_por }
// y cada cambio queda anotado solo en "historial" (con el nombre de quien lo hizo; lo hace la base de datos).
// Aquí se traducen entre ese formato y el que usa el resto de la app: { [clave]: { campos, pasos?, modificado } }.

const PAGINA = 1000;
const REINTENTOS = 3;
const filtro = v => encodeURIComponent(v);

const aEntrada = f => ({
  campos: f.campos || {},
  ...(f.pasos && Object.keys(f.pasos).length ? { pasos: f.pasos } : {}),
  modificado: f.modificado,
});

class Almacen {
  constructor(sesion) { this.sesion = sesion; }

  async leerEdiciones() {
    const todas = {};
    for (let desde = 0; ; desde += PAGINA) {
      const { datos } = await this.sesion.pedir('GET', `ediciones?select=clave,campos,pasos,modificado&order=clave.asc&limit=${PAGINA}&offset=${desde}`);
      for (const f of datos || []) todas[f.clave] = aEntrada(f);
      if (!datos || datos.length < PAGINA) break;
    }
    return todas;
  }

  async _leerFila(clave) {
    const { datos } = await this.sesion.pedir('GET', `ediciones?select=clave,campos,pasos,modificado&clave=eq.${filtro(clave)}`);
    return (datos && datos[0]) || null;
  }

  // Lee la postulación, aplica `cambiar(campos, pasos)` y la guarda. Si otra persona la modificó entremedio
  // (el campo "modificado" ya no coincide), vuelve a leer y a aplicar el cambio sobre lo más reciente, así
  // no se pisan correcciones de dos personas que trabajan a la vez.
  async modificar(clave, cambiar) {
    for (let intento = 0; intento < REINTENTOS; intento++) {
      const fila = await this._leerFila(clave);
      const campos = { ...(fila ? fila.campos : {}) }, pasos = { ...(fila ? fila.pasos : {}) };
      cambiar(campos, pasos);
      const vacia = !Object.keys(campos).length && !Object.keys(pasos).length;
      let guardada;
      if (!fila) {
        if (vacia) return;
        try {
          await this.sesion.pedir('POST', 'ediciones', { cuerpo: { clave, campos, pasos }, prefer: 'return=representation' });
          guardada = true;
        } catch (e) {
          if (e.codigo === '23505') guardada = false; // otra persona la creó justo ahora
          else throw e;
        }
      } else {
        const where = `clave=eq.${filtro(clave)}&modificado=eq.${filtro(fila.modificado)}`;
        const { datos } = vacia
          ? await this.sesion.pedir('DELETE', `ediciones?${where}`, { prefer: 'return=representation' })
          : await this.sesion.pedir('PATCH', `ediciones?${where}`, { cuerpo: { campos, pasos }, prefer: 'return=representation' });
        guardada = Array.isArray(datos) && datos.length === 1;
      }
      if (guardada) return;
    }
    throw new ErrorSupabase('Otra persona estaba modificando esta ficha al mismo tiempo. Inténtalo de nuevo.', { estado: 409 });
  }

  // Aplica correcciones a muchas postulaciones, unas pocas a la vez. Devuelve cuántas salieron bien y cuáles fallaron.
  async editarVarios(porClave, simultaneas = 4) {
    const pendientes = Object.entries(porClave);
    const fallidas = [];
    let ok = 0;
    const trabajar = async () => {
      for (let item = pendientes.shift(); item; item = pendientes.shift()) {
        try { await this.editarCampos(item[0], item[1]); ok++; } catch (e) { fallidas.push({ clave: item[0], error: e.message }); }
      }
    };
    await Promise.all(Array.from({ length: simultaneas }, trabajar));
    return { ok, fallidas };
  }

  editarCampos(clave, limpios) {
    return this.modificar(clave, campos => Object.assign(campos, limpios));
  }

  // Quita una sola corrección (por ejemplo, la marca de duplicada) sin tocar las demás.
  quitarCampo(clave, campo) {
    return this.modificar(clave, campos => { delete campos[campo]; });
  }

  // Quita la misma corrección a muchas postulaciones, unas pocas a la vez.
  async quitarCampoVarios(claves, campo, simultaneas = 4) {
    const pendientes = [...claves];
    const fallidas = [];
    let ok = 0;
    const trabajar = async () => {
      for (let clave = pendientes.shift(); clave; clave = pendientes.shift()) {
        try { await this.quitarCampo(clave, campo); ok++; } catch (e) { fallidas.push({ clave, error: e.message }); }
      }
    };
    await Promise.all(Array.from({ length: simultaneas }, trabajar));
    return { ok, fallidas };
  }

  // Quita las correcciones de datos; los pasos de admisión se conservan.
  restaurar(clave) {
    return this.modificar(clave, campos => { for (const k of Object.keys(campos)) delete campos[k]; });
  }

  marcarPaso(clave, id, hecho, entrada) {
    return this.modificar(clave, (_c, pasos) => { if (hecho) pasos[id] = entrada; else delete pasos[id]; });
  }

  // Sube correcciones nuevas sin pisar las que ya existen en Supabase. Devuelve cuántas se subieron.
  async importar(ediciones) {
    const existentes = new Set(Object.keys(await this.leerEdiciones()));
    const nuevas = Object.entries(ediciones).filter(([k]) => !existentes.has(k));
    await this._subir(nuevas.map(([clave, e]) => ({ clave, campos: e.campos || {}, pasos: e.pasos || {} })), 'resolution=ignore-duplicates');
    return { subidas: nuevas.length, yaExistian: Object.keys(ediciones).length - nuevas.length };
  }

  // Deja Supabase exactamente igual al respaldo: sube lo del archivo y borra lo que no esté en él.
  async reemplazarTodo(respaldo) {
    const actuales = Object.keys(await this.leerEdiciones());
    const filas = Object.entries(respaldo).map(([clave, e]) => ({ clave, campos: e.campos || {}, pasos: e.pasos || {} }));
    await this._subir(filas, 'resolution=merge-duplicates');
    const sobran = actuales.filter(k => !(k in respaldo));
    for (const k of sobran) await this.sesion.pedir('DELETE', `ediciones?clave=eq.${filtro(k)}`);
    return { restauradas: filas.length, borradas: sobran.length };
  }

  async _subir(filas, resolucion) {
    for (let i = 0; i < filas.length; i += 200) {
      await this.sesion.pedir('POST', 'ediciones?on_conflict=clave', { cuerpo: filas.slice(i, i + 200), prefer: resolucion });
    }
  }

  // Planilla compartida: la copia del último "Actualizar" de cualquier persona y el enlace de Google.
  async leerHoja() {
    const { datos } = await this.sesion.pedir('GET', 'hoja_csv?select=contenido,actualizado&id=eq.1');
    return (datos && datos[0]) || null;
  }

  async guardarHoja(contenido) {
    await this.sesion.pedir('POST', 'rpc/guardar_hoja', { cuerpo: { p_contenido: contenido } });
  }

  async leerHojaUrl() {
    const { datos } = await this.sesion.pedir('GET', 'configuracion?select=valor&clave=eq.hoja_url');
    return datos && datos[0] && typeof datos[0].valor === 'string' ? datos[0].valor : '';
  }

  // Solo la administradora puede cambiarlo (lo exige la base de datos).
  async guardarHojaUrl(url) {
    await this.sesion.pedir('POST', 'configuracion?on_conflict=clave', { cuerpo: { clave: 'hoja_url', valor: url, actualizado: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  }

  // ---- Cuentas de usuarias (solo la administradora; crear y restablecer las hace la función de Supabase) ----
  usuarios() { return this.sesion.funcion('documentos', { accion: 'usuarios_listar' }); }
  crearUsuario({ correo, nombre, rol }) { return this.sesion.funcion('documentos', { accion: 'usuarios_crear', correo, nombre, rol }); }
  restablecerClave(id) { return this.sesion.funcion('documentos', { accion: 'usuarios_restablecer', id }); }

  // Últimos movimientos de cuentas (quién hizo qué con quién). Solo la administradora puede leerlo.
  async registroCuentas(limite = 100) {
    const { datos } = await this.sesion.pedir('GET', `registro_cuentas?select=creado_en,usuario_nombre,objetivo_nombre,accion,detalle&order=creado_en.desc&limit=${Math.min(Math.max(limite | 0, 1), 500)}`);
    return Array.isArray(datos) ? datos : [];
  }

  // Cambia la categoría, el nombre o si la cuenta está activa. Los permisos los decide la base de datos.
  async cambiarPerfil(id, cambios) {
    const { datos } = await this.sesion.pedir('PATCH', `perfiles?id=eq.${filtro(id)}`, { cuerpo: cambios, prefer: 'return=representation' });
    if (!Array.isArray(datos) || datos.length !== 1) throw new ErrorSupabase('No se pudo cambiar: no tienes permiso o la cuenta no existe.', { estado: 403 });
    return datos[0];
  }

  // ---- Documentos ----
  // Crea el enlace de subida de una postulante. El código completo solo se ve ahora: la base guarda su huella.
  async crearEnlace(clave, dias = 30) {
    const { datos } = await this.sesion.pedir('POST', 'rpc/crear_enlace_subida', { cuerpo: { p_clave: clave, p_dias: dias } });
    return datos;
  }

  // Enlace para que la postulante corrija datos con alerta. campos: { campo: valorActual }.
  async crearEnlaceDatos(clave, campos, dias = 14) {
    const { datos } = await this.sesion.pedir('POST', 'rpc/crear_enlace_datos', { cuerpo: { p_clave: clave, p_campos: campos, p_dias: dias } });
    return datos;
  }

  // Propuestas de corrección que las postulantes enviaron y nadie ha resuelto.
  async correccionesPendientes() {
    const { datos } = await this.sesion.pedir('GET', 'correcciones_pendientes?select=id,clave,campos,creado_en&estado=eq.pendiente&order=creado_en.asc&limit=500');
    return datos || [];
  }

  async resolverCorreccion(id, aceptada) {
    const { datos } = await this.sesion.pedir('POST', 'rpc/resolver_correccion', { cuerpo: { p_id: id, p_aceptada: !!aceptada } });
    return datos === true;
  }

  async documentos(clave) {
    const { datos } = await this.sesion.pedir('GET', `documentos?select=id,tipo,bytes,tipo_mime,subido_en,borrado_en&clave=eq.${filtro(clave)}&order=subido_en.desc`);
    return datos || [];
  }

  // Archivo de un documento (solo si no fue borrado). La base de datos decide si esta persona puede verlo.
  async archivo(id) {
    const { datos } = await this.sesion.pedir('GET', `documentos?select=ruta,tipo_mime,borrado_en&id=eq.${filtro(id)}`);
    const d = datos && datos[0];
    if (!d || d.borrado_en) throw new ErrorSupabase('Ese documento no está disponible.', { estado: 404 });
    const r = await this.sesion.pedir('GET', `/storage/v1/object/authenticated/documentos/${d.ruta.split('/').map(encodeURIComponent).join('/')}`, { binario: true });
    return { bytes: r.bytes, tipo: d.tipo_mime };
  }

  // Deja lista, en el almacenamiento privado, la carta de solicitud ya completada para que la postulante la descargue desde su enlace.
  async prepararCarta(clave, pdf) {
    const fd = new FormData();
    fd.set('accion', 'preparar_carta'); fd.set('clave', clave);
    fd.set('carta', new Blob([pdf], { type: 'application/pdf' }), 'carta.pdf');
    await this.sesion.pedir('POST', '/functions/v1/documentos', { cuerpo: fd });
  }

  // Deja lista, en el almacenamiento privado, la carta de bienvenida de esa persona (PDF con su nombre) para que la descargue desde su enlace.
  async prepararBienvenida(clave, pdf) {
    const fd = new FormData();
    fd.set('accion', 'preparar_carta'); fd.set('tipo', 'bienvenida'); fd.set('clave', clave);
    fd.set('carta', new Blob([pdf], { type: 'application/pdf' }), 'carta.pdf');
    await this.sesion.pedir('POST', '/functions/v1/documentos', { cuerpo: fd });
  }

  // Enlace único para que la socia descargue su carta de bienvenida. El código completo solo se ve ahora: la base guarda su huella.
  async crearEnlaceBienvenida(clave, dias = 60) {
    const { datos } = await this.sesion.pedir('POST', 'rpc/crear_enlace_bienvenida', { cuerpo: { p_clave: clave, p_dias: dias } });
    return datos;
  }

  // Resumen de lo recibido por postulante: { [clave]: { recibidos, ultimo, carnet, carnetBorrado } } (para avisar qué hay por revisar).
  async resumenDocumentos() {
    const res = {};
    for (let desde = 0; ; desde += PAGINA) {
      const { datos } = await this.sesion.pedir('GET', `documentos?select=clave,tipo,subido_en,borrado_en&order=subido_en.asc&limit=${PAGINA}&offset=${desde}`);
      for (const d of datos || []) {
        const r = res[d.clave] || (res[d.clave] = { recibidos: 0, ultimo: '', carnet: false, carnetBorrado: false });
        r.recibidos++;
        if (d.subido_en > r.ultimo) r.ultimo = d.subido_en;
        if (d.tipo === 'carnet') { if (d.borrado_en) r.carnetBorrado = true; else r.carnet = true; }
      }
      if (!datos || datos.length < PAGINA) break;
    }
    return res;
  }

  // Borra la copia del carnet (lo hace una función del servidor, que revisa el rol).
  borrarCarnet(id) { return this.sesion.funcion('documentos', { accion: 'borrar_carnet', id }); }

  // Últimos cambios, con el nombre de quien los hizo. Si se da una clave, solo los de esa postulación.
  async historial({ clave, limite = 100 } = {}) {
    const donde = clave ? `&clave=eq.${filtro(clave)}` : '';
    const { datos } = await this.sesion.pedir('GET', `historial?select=id,creado_en,usuario_nombre,clave,accion,detalle&order=id.desc&limit=${Math.min(limite, 500)}${donde}`);
    return datos || [];
  }
}

module.exports = { Almacen };

});

definir("lib/supabase", function (module, exports, require, __dirname, Buffer) {
// Dónde se recuerda la sesión (solo el código de renovación, nunca la contraseña): en un archivo del computador o,
// en la versión web, en el almacenamiento del navegador. Es un objeto { leer(), guardar(texto), borrar() }.
function persistenciaEnArchivo(ruta) {
  const fs = require('fs'), path = require('path'); // solo se cargan si de verdad se usa un archivo
  return {
    leer() { try { return fs.readFileSync(ruta, 'utf8'); } catch { return null; } },
    guardar(texto) { fs.mkdirSync(path.dirname(ruta), { recursive: true }); fs.writeFileSync(ruta, texto); },
    borrar() { try { fs.unlinkSync(ruta); } catch { /* no existía */ } },
  };
}

// Cliente mínimo de Supabase (sin librerías): inicia sesión con correo y contraseña, mantiene la sesión
// al día y hace las peticiones a la base de datos con el permiso de la persona que inició sesión.
// Las reglas de quién puede ver o cambiar qué las aplica Supabase (RLS), no esta app.
// La clave que se usa aquí es la PÚBLICA (publishable); nunca la clave secreta.

class ErrorSupabase extends Error {
  constructor(mensaje, { estado = 500, codigo = null, sesion = false } = {}) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.sesion = sesion; // true: la sesión no sirve, hay que volver a ingresar
  }
}

// Categorías: administradora (todo), secretaria (trabajo diario) y directiva (solo consulta).
const ROLES_CON_ACCESO = ['admin', 'secretaria', 'directiva'];
const ROLES_QUE_EDITAN = ['admin', 'secretaria'];

// Mensajes en español para lo que Supabase devuelve en inglés.
function traducir(estado, cuerpo) {
  const cod = cuerpo && (cuerpo.error_code || cuerpo.code);
  if (cod === 'invalid_credentials') return 'Correo o contraseña incorrectos.';
  if (cod === 'over_request_rate_limit' || estado === 429) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  if (cod === '42501') return 'No tienes permiso para hacer esto.';
  if (cod === '23514') return 'La base de datos rechazó los datos por no cumplir las reglas.';
  if (cod === '23505') return 'Ese registro ya existe.';
  if (cod === 'P0001' && cuerpo.message) return cuerpo.message; // avisos escritos por nuestra propia base (por ejemplo, la última administradora)
  if (cod === 'same_password') return 'La contraseña nueva debe ser distinta de la actual.';
  if (cod === 'weak_password') return 'Esa contraseña es demasiado débil. Usa una más larga y menos obvia.';
  if (estado === 401) return 'La sesión venció. Vuelve a iniciar sesión.';
  if (estado === 403) return 'No tienes permiso para hacer esto.';
  if (cuerpo && typeof cuerpo.error === 'string' && estado !== 401) return cuerpo.error; // mensajes ya escritos por nuestras funciones
  const m = cuerpo && (cuerpo.msg || cuerpo.message || cuerpo.error_description);
  return m ? `Supabase respondió: ${m}` : `Supabase respondió con error ${estado}.`;
}

class Sesion {
  constructor({ url, clave, archivo = null, persistencia = null, fetchFn = (...a) => fetch(...a), ahora = () => Date.now() }) {
    if (!url || !clave) throw new Error('Falta la dirección o la clave pública del proyecto de Supabase.');
    this.url = url.replace(/\/+$/, '');
    this.clave = clave;
    this.persistencia = persistencia || (archivo ? persistenciaEnArchivo(archivo) : null);
    this.fetch = fetchFn;
    this.ahora = ahora;
    this.tokens = null;   // { acceso, refresco, vence (ms) }
    this.usuario = null;  // { id, correo, nombre, rol }
    this._refrescando = null;
  }

  // ---------- Estado ----------
  get activa() { return !!(this.tokens && this.usuario); }
  get publico() { return this.activa ? { id: this.usuario.id, correo: this.usuario.correo, nombre: this.usuario.nombre, rol: this.usuario.rol, cambiarClave: !!this.usuario.cambiarClave } : null; }
  tieneAcceso() { return this.activa && ROLES_CON_ACCESO.includes(this.usuario.rol); }
  puedeEditar() { return this.activa && ROLES_QUE_EDITAN.includes(this.usuario.rol); }
  esAdmin() { return this.activa && this.usuario.rol === 'admin'; }

  // ---------- Persistencia (solo el código de renovación, nunca la contraseña) ----------
  _guardar() {
    if (!this.persistencia) return;
    this.persistencia.guardar(JSON.stringify({ refresco: this.tokens.refresco, correo: this.usuario && this.usuario.correo }));
  }
  _olvidar() {
    this.tokens = null; this.usuario = null;
    if (this.persistencia) this.persistencia.borrar();
  }

  // ---------- Peticiones crudas ----------
  async _http(metodo, ruta, { cuerpo, acceso, prefer, extra, binario = false } = {}) {
    const esForm = typeof FormData !== 'undefined' && cuerpo instanceof FormData; // el navegador/Node pone solo el tipo y el límite
    const cabeceras = { apikey: this.clave, ...(esForm ? {} : { 'Content-Type': 'application/json' }), ...extra };
    if (acceso) cabeceras.Authorization = `Bearer ${acceso}`;
    if (prefer) cabeceras.Prefer = prefer;
    let r;
    try {
      r = await this.fetch(this.url + ruta, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : (esForm ? cuerpo : JSON.stringify(cuerpo)), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new ErrorSupabase('No se pudo conectar con Supabase. Revisa la conexión a internet.', { estado: 503, codigo: 'sin_conexion' });
    }
    if (binario && r.ok) return { estado: r.status, ok: true, datos: null, bytes: new Uint8Array(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'application/octet-stream' };
    const texto = await r.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
    return { estado: r.status, datos, ok: r.ok };
  }

  _recibirTokens(d) {
    this.tokens = { acceso: d.access_token, refresco: d.refresh_token, vence: this.ahora() + (Number(d.expires_in) || 3600) * 1000 };
  }

  async _cargarPerfil() {
    const r = await this._http('GET', '/rest/v1/perfiles?select=id,nombre,rol,activo,cambiar_clave&id=eq.' + encodeURIComponent(this._uid), { acceso: this.tokens.acceso });
    if (!r.ok) throw new ErrorSupabase(traducir(r.estado, r.datos), { estado: r.estado });
    const p = Array.isArray(r.datos) && r.datos[0];
    return p && p.activo !== false ? p : null;
  }

  async _establecer(d, correo) {
    this._recibirTokens(d);
    this._uid = d.user && d.user.id;
    const p = await this._cargarPerfil();
    if (!p) {
      this._olvidar();
      throw new ErrorSupabase('Tu cuenta existe pero no tiene un perfil activo en AMAGRO. Pide a la administradora que la habilite.', { estado: 403, sesion: true });
    }
    this.usuario = { id: p.id, correo: (d.user && d.user.email) || correo, nombre: p.nombre, rol: p.rol, cambiarClave: !!p.cambiar_clave };
    this._guardar();
  }

  // ---------- Ingreso y salida ----------
  async ingresar(correo, contrasena) {
    if (typeof correo !== 'string' || !correo.trim() || typeof contrasena !== 'string' || !contrasena) {
      throw new ErrorSupabase('Escribe el correo y la contraseña.', { estado: 400 });
    }
    const r = await this._http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email: correo.trim(), password: contrasena } });
    if (!r.ok) throw new ErrorSupabase(traducir(r.estado, r.datos), { estado: r.estado === 400 ? 401 : r.estado, codigo: r.datos && r.datos.error_code });
    await this._establecer(r.datos, correo.trim());
    return this.publico;
  }

  // Retoma la sesión guardada en el disco (al iniciar la app). Devuelve true si quedó activa.
  async retomar() {
    if (!this.persistencia) return false;
    let guardado;
    try { guardado = JSON.parse(this.persistencia.leer()); } catch { return false; }
    if (!guardado || typeof guardado.refresco !== 'string') return false;
    this.tokens = { acceso: '', refresco: guardado.refresco, vence: 0 };
    try {
      await this._renovar();
      return true;
    } catch (e) {
      if (e.sesion) this._olvidar();   // el código ya no sirve
      else { this.tokens = null; }     // sin internet: se conserva el archivo para el próximo intento
      return false;
    }
  }

  async salir() {
    const acceso = this.tokens && this.tokens.acceso;
    this._olvidar();
    if (acceso) { try { await this._http('POST', '/auth/v1/logout', { acceso }); } catch { /* da igual: ya se olvidó localmente */ } }
  }

  // Cambia el código de renovación por una sesión nueva. Si varias peticiones lo piden a la vez, se hace una sola vez
  // (el código de renovación de Supabase se usa una vez).
  _renovar() {
    if (this._refrescando) return this._refrescando;
    this._refrescando = (async () => {
      const r = await this._http('POST', '/auth/v1/token?grant_type=refresh_token', { cuerpo: { refresh_token: this.tokens.refresco } });
      if (!r.ok) {
        const definitivo = r.estado >= 400 && r.estado < 500 && r.estado !== 429;
        throw new ErrorSupabase(definitivo ? 'La sesión venció. Vuelve a iniciar sesión.' : traducir(r.estado, r.datos), { estado: definitivo ? 401 : r.estado, sesion: definitivo });
      }
      await this._establecer(r.datos, this.usuario && this.usuario.correo);
    })().finally(() => { this._refrescando = null; });
    return this._refrescando;
  }

  // ---------- Peticiones a la base de datos ----------
  // Devuelve { datos, estado }. Lanza ErrorSupabase si Supabase rechaza la petición.
  async pedir(metodo, ruta, { cuerpo, prefer, binario = false } = {}) {
    const destino = ruta.startsWith('/') ? ruta : '/rest/v1/' + ruta; // sin barra inicial: tabla de la base de datos
    if (!this.tokens) throw new ErrorSupabase('Hay que iniciar sesión.', { estado: 401, sesion: true });
    if (this.tokens.vence - this.ahora() < 60000) await this._renovar().catch(e => { if (e.sesion) { this._olvidar(); } throw e; });
    let r = await this._http(metodo, destino, { cuerpo, prefer, binario, acceso: this.tokens.acceso });
    if (r.estado === 401 && this.tokens) { // el token venció antes de lo esperado: se renueva una vez y se repite
      await this._renovar().catch(e => { if (e.sesion) { this._olvidar(); } throw e; });
      r = await this._http(metodo, destino, { cuerpo, prefer, binario, acceso: this.tokens.acceso });
    }
    if (!r.ok) {
      const caduco = r.estado === 401;
      if (caduco) this._olvidar();
      throw new ErrorSupabase(traducir(r.estado, r.datos), { estado: r.estado, codigo: r.datos && r.datos.code, sesion: caduco });
    }
    return { datos: r.datos, estado: r.estado, bytes: r.bytes, tipo: r.tipo };
  }

  // La persona cambia su propia contraseña. Al cambiarla, la base quita la marca de "debe cambiarla".
  async cambiarClave(nueva) {
    await this.pedir('PUT', '/auth/v1/user', { cuerpo: { password: nueva } });
    const p = await this._cargarPerfil();
    if (p && this.usuario) this.usuario.cambiarClave = !!p.cambiar_clave;
  }

  // Llama a una Edge Function con la sesión de la persona (la función vuelve a comprobar su rol).
  async funcion(nombre, cuerpo) {
    const { datos } = await this.pedir('POST', `/functions/v1/${nombre}`, { cuerpo });
    return datos;
  }
}

module.exports = { Sesion, ErrorSupabase, persistenciaEnArchivo, ROLES_CON_ACCESO, ROLES_QUE_EDITAN, traducir };

});

definir("lib/api", function (module, exports, require, __dirname, Buffer) {
const { procesarCSV } = require('./procesar');
const { urlExportacion } = require('./hoja');
const { REGIONES } = require('./normalizar');
const { ETAPAS } = require('./etapas');
const { validarCampos, validarRespaldo, avisoRespaldo } = require('./ediciones');
const { PASOS, PLAZO_RESPUESTA_DIAS, validarPaso } = require('./pasos');
const { ErrorSupabase } = require('./supabase');
const { leerSocias, planificar, camposAAplicar } = require('./socias');
const { camposConAlerta, evaluarPropuesta, valorActual } = require('./correcciones');
const { proponer, planDeAplicacion } = require('./duplicados');
const noAceptacion = require('./cartaNoAceptacion');
const bienvenida = require('./cartaBienvenida');

// La API de la aplicación: atiende las peticiones /api/... de la pantalla. El MISMO código corre en dos lugares:
//  - en el computador (server.js), y
//  - dentro del navegador (versión web), donde la pantalla le habla directo a Supabase.
// No usa nada propio de Node: lo que depende del entorno (archivos, PDF, Thunderbird, descarga de la planilla) llega en "entorno".
//
// entorno (todo opcional):
//   config() / guardarConfig(obj)  datos propios de ese equipo (por ejemplo, cuándo se descargó el último respaldo)
//   hojaLocal() -> { texto, fecha } | null      planilla guardada solo en ese equipo (versión antigua)
//   ejemplo() -> texto | null                   datos de ejemplo cuando no hay planilla
//   descargarHoja(url) -> texto                 cómo se baja la planilla de Google
//   logo() -> bytes | null                      logo de AMAGRO (hoy no se usa: la carta de solicitud la firma la postulante, así que va sin logo;
//                                               queda para la futura carta de bienvenida)
//   carta { generarCarta, nombreArchivo }       generador del PDF de la carta
//   migracion { pendientes() -> obj | null, hecho() }   correcciones que quedaron en el equipo de antes
//   copiaLocal(ediciones) / copias() -> n       copia de seguridad antes de restaurar un respaldo
//   thunderbird { info(), abrir(datos) }        solo en el computador
//
// Devuelve { estado, json } | { estado, texto, tipo, cabeceras } | { estado, bytes, tipo, cabeceras }.

const NO_ENCONTRADA = 'No se encontró a esa postulante. Actualiza la planilla e inténtalo de nuevo.';
const ROLES_VALIDOS = ['admin', 'secretaria', 'directiva'];
// Lo único que puede hacer la categoría Directiva (consultar).
const SOLO_CONSULTA = new Set(['GET /api/postulaciones', 'GET /api/historial', 'GET /api/documentos', 'GET /api/documento/ver', 'POST /api/carta', 'GET /api/correo/info', 'POST /api/mi-clave']);

// Cada entrada de las ediciones: { campos: {correcciones}, pasos?: {pasos de admisión}, modificado }.
const soloCampos = ed => Object.fromEntries(Object.entries(ed).map(([k, v]) => [k, v.campos || {}]));
const soloPasos = ed => Object.fromEntries(Object.entries(ed).filter(([, v]) => v.pasos).map(([k, v]) => [k, v.pasos]));

// ¿Esta postulante tiene documentos recibidos que nadie ha revisado? Se da por revisada cuando está marcado el paso
// "Revisada por secretaría" en una fecha igual o posterior a la última subida; si sube de nuevo después, vuelve a pendiente.
function pendienteDeRevision(docs, pasos) {
  if (!docs || !docs.recibidos) return false;
  const rev = pasos && pasos.revisada;
  return !rev || docs.ultimo.slice(0, 10) > rev.fecha;
}

const largoUtf8 = s => new TextEncoder().encode(s).length;
const ok = json => ({ estado: 200, json });
const fallo = (estado, error, extra = {}) => ({ estado, json: { error, ...extra } });

function crearApi({ sesion, almacen, proyecto, entorno = {} }) {
  const E = { config: () => ({}), guardarConfig() {}, hojaLocal: () => null, ejemplo: () => null, logo: () => null, ...entorno };
  const paginaSubida = () => (proyecto && proyecto.paginaSubida) || '';
  const analizar = texto => { try { return { cuerpo: JSON.parse(texto) }; } catch { return { error: fallo(400, 'Petición inválida.') }; } };

  // Enlace de la planilla: vive en Supabase (lo ven todas). Si aún no está allí pero este equipo tiene uno de antes,
  // se usa ese y, si quien lo pide es administradora, se sube para dejarlo compartido.
  async function urlHoja() {
    const compartida = await almacen.leerHojaUrl();
    if (compartida) return compartida;
    const local = E.config().hojaUrl || '';
    if (local && sesion.esAdmin()) { try { await almacen.guardarHojaUrl(local); } catch { /* se reintentará la próxima vez */ } }
    return local;
  }

  // La planilla es la copia compartida del último "Actualizar" de cualquiera. Si aún no hay ninguna, se usa la que
  // este equipo tenía de antes (hasta que alguien pulse "Actualizar"), o los datos de ejemplo.
  async function leerOrigen() {
    const hojaUrl = await urlHoja();
    const hoja = await almacen.leerHoja();
    if (hoja) return { fuente: `Planilla (última actualización: ${new Date(hoja.actualizado).toLocaleString('es-CL')})`, esEjemplo: false, texto: hoja.contenido, hojaUrl };
    const local = E.hojaLocal();
    if (local) return { fuente: `Planilla guardada solo en este computador (${new Date(local.fecha).toLocaleString('es-CL')}): pulsa "Actualizar" para compartirla`, esEjemplo: false, texto: local.texto, hojaUrl };
    const ejemplo = E.ejemplo();
    if (ejemplo) return { fuente: 'DATOS DE EJEMPLO (ficticios)', esEjemplo: true, texto: ejemplo, hojaUrl };
    return { fuente: 'Todavía no hay planilla: pulsa "Actualizar" para cargarla.', esEjemplo: false, texto: '', hojaUrl };
  }

  async function respuestaDatos(o) {
    const [ediciones, documentos] = await Promise.all([almacen.leerEdiciones(), almacen.resumenDocumentos()]);
    const r = procesarCSV(o.texto, new Date(), soloCampos(ediciones), soloPasos(ediciones));
    for (const reg of r.registros) {
      const docs = documentos[reg.clave] || null;
      reg.docs = docs;
      reg.pendienteRevision = !reg.inactiva && pendienteDeRevision(docs, reg.pasos); // lo no activo no genera avisos
    }
    return {
      fuente: o.fuente,
      hojaUrl: o.hojaUrl,
      regiones: REGIONES,
      etapas: ETAPAS,
      pasosDef: PASOS,
      plazoRespuestaDias: PLAZO_RESPUESTA_DIAS,
      usuario: sesion.publico,
      paginaSubida: !!paginaSubida(),
      correoEnvio: (proyecto && proyecto.correoEnvio) || '',
      urlApp: (proyecto && proyecto.urlApp) || '',
      ...r,
    };
  }
  const datosActuales = async () => respuestaDatos(await leerOrigen());
  const buscarRegistro = async clave => typeof clave === 'string' && (await datosActuales()).registros.find(r => r.clave === clave);
  const urlPagina = ruta => `${paginaSubida().replace(/[#/]+$/, '')}${ruta}`;
  // Direcciones de los tres PDF de los estatutos (viven en la página de subida), o nada si no está configurada.
  const enlacesEstatutos = () => (paginaSubida() ? { resumen: urlPagina('/resumen-estatutos-amagro-ag.pdf'), lectura: urlPagina('/estatutos-lectura-amagro-ag.pdf'), copiaNotarial: urlPagina('/estatutos-amagro-ag.pdf') } : {});

  async function enrutar({ metodo, url, cuerpo }) {
    const ruta = metodo + ' ' + url.split('?')[0];
    const consulta = new URL(url, 'http://x').searchParams;

    // ---------- Sesión ----------
    if (ruta === 'GET /api/sesion') {
      return ok({ configurado: !!sesion, activa: !!sesion && sesion.tieneAcceso(), usuario: sesion ? sesion.publico : null, sinAcceso: !!sesion && sesion.activa && !sesion.tieneAcceso() });
    }
    if (!sesion) return fallo(503, 'Falta configurar el proyecto de Supabase.');

    if (ruta === 'POST /api/ingresar') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const u = await sesion.ingresar(a.cuerpo.correo, a.cuerpo.contrasena);
      if (!sesion.tieneAcceso()) {
        await sesion.salir();
        return fallo(403, `Tu cuenta (${u.nombre}, rol "${u.rol}") todavía no tiene acceso a esta aplicación.`);
      }
      return ok({ ok: true, usuario: u });
    }
    if (ruta === 'POST /api/salir') { await sesion.salir(); return ok({ ok: true }); }

    // ---------- Todo lo demás exige una sesión con permiso ----------
    if (!sesion.tieneAcceso()) return fallo(401, 'Hay que iniciar sesión.', { sesion: false });
    // Con una contraseña temporal, lo único que se puede hacer es cambiarla.
    if (sesion.usuario.cambiarClave && ruta !== 'POST /api/mi-clave') return fallo(403, 'Antes de seguir, cambia tu contraseña.', { cambiarClave: true });
    // La directiva solo consulta: lo demás se rechaza aquí (y además la base de datos no la deja escribir).
    if (!sesion.puedeEditar() && !SOLO_CONSULTA.has(ruta)) return fallo(403, 'Tu categoría (Directiva) solo puede consultar la información.');

    // Cambia la contraseña de quien tiene la sesión abierta.
    if (ruta === 'POST /api/mi-clave') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const n = a.cuerpo && a.cuerpo.nueva;
      if (typeof n !== 'string' || n.length < 10) return fallo(400, 'La contraseña debe tener al menos 10 caracteres.');
      if (largoUtf8(n) > 72) return fallo(400, 'La contraseña es demasiado larga (máximo 72 caracteres).');
      if (n.toLowerCase() === String(sesion.usuario.correo).toLowerCase() || /^(.)\1+$/.test(n)) return fallo(400, 'Elige una contraseña menos obvia.');
      await sesion.cambiarClave(n);
      return ok({ ok: true, usuario: sesion.publico });
    }

    // ---------- Cuentas de usuarias: solo la administradora ----------
    if (url.startsWith('/api/usuarios')) {
      if (!sesion.esAdmin()) return fallo(403, 'Solo la administradora puede administrar usuarias.');
      if (ruta === 'GET /api/usuarios') return ok(await almacen.usuarios());
      if (ruta === 'GET /api/usuarios/registro') return ok({ registro: await almacen.registroCuentas() });
      const a = analizar(cuerpo); if (a.error) return a.error;
      const c = a.cuerpo || {};
      if (ruta === 'POST /api/usuarios/crear') return ok(await almacen.crearUsuario(c));
      if (ruta === 'POST /api/usuarios/clave') return ok(await almacen.restablecerClave(c.id));
      if (ruta === 'POST /api/usuarios/perfil') {
        const cambios = {};
        if (c.rol !== undefined) { if (!ROLES_VALIDOS.includes(c.rol)) return fallo(400, 'La categoría no es válida.'); cambios.rol = c.rol; }
        if (c.activo !== undefined) { if (typeof c.activo !== 'boolean') return fallo(400, 'Dato inválido.'); cambios.activo = c.activo; }
        if (c.nombre !== undefined) { const n = String(c.nombre).replace(/\s+/g, ' ').trim(); if (n.length < 2 || n.length > 120) return fallo(400, 'El nombre debe tener entre 2 y 120 letras.'); cambios.nombre = n; }
        if (typeof c.id !== 'string' || !/^[0-9a-f-]{36}$/.test(c.id) || !Object.keys(cambios).length) return fallo(400, 'Datos inválidos.');
        await almacen.cambiarPerfil(c.id, cambios);
        return ok({ ok: true });
      }
    }

    if (ruta === 'GET /api/postulaciones') return ok(await datosActuales());

    // Guarda el enlace de la planilla (solo se valida que sea un enlace de Google Sheets).
    if (ruta === 'POST /api/config') {
      if (!sesion.esAdmin()) return fallo(403, 'Solo la administradora puede cambiar el enlace de la planilla.');
      const { hojaUrl } = JSON.parse(cuerpo);
      urlExportacion(hojaUrl);
      await almacen.guardarHojaUrl(hojaUrl.trim());
      return ok({ ok: true });
    }

    // Botón "Actualizar": descarga la planilla y compara con la copia anterior.
    if (ruta === 'POST /api/actualizar') {
      const hojaUrl = await urlHoja();
      if (!hojaUrl) return fallo(400, 'Primero la administradora debe configurar el enlace de la planilla.');
      if (!E.descargarHoja) return fallo(501, 'Este equipo no puede descargar la planilla.');
      const previa = await almacen.leerHoja();
      const antes = previa ? procesarCSV(previa.contenido).registros.length : 0;
      const texto = await E.descargarHoja(hojaUrl);
      const despues = procesarCSV(texto).registros.length;
      if (despues === 0) return fallo(400, 'La planilla descargada no tiene filas.');
      await almacen.guardarHoja(texto);
      return ok({ nuevos: Math.max(despues - antes, 0), total: despues, primera: antes === 0, ...(await datosActuales()) });
    }

    // Procesa un CSV subido desde el navegador; no se guarda.
    if (ruta === 'POST /api/procesar') return ok(await respuestaDatos({ fuente: 'Archivo subido', hojaUrl: await urlHoja(), texto: cuerpo }));

    // Guarda correcciones de una postulación. Solo se aceptan campos de la lista y textos cortos.
    if (ruta === 'POST /api/editar') {
      const { clave, cambios } = JSON.parse(cuerpo);
      if (typeof clave !== 'string' || !clave || !cambios || typeof cambios !== 'object') return fallo(400, 'Datos de edición inválidos.');
      const { limpios, error } = validarCampos(cambios);
      if (error) return fallo(400, error);
      await almacen.editarCampos(clave, limpios);
      return ok(await datosActuales());
    }

    // Deshace las correcciones de datos de una postulación y vuelve a los datos de la planilla.
    // Los pasos de admisión no se tocan: son registro de lo que se hizo, no correcciones.
    if (ruta === 'POST /api/restaurar') {
      const { clave } = JSON.parse(cuerpo);
      if (typeof clave !== 'string' || !clave) return fallo(400, 'Datos inválidos.');
      await almacen.restaurar(clave);
      return ok(await datosActuales());
    }

    // Marca o desmarca un paso de admisión de una postulante, con su fecha y una nota opcional.
    if (ruta === 'POST /api/paso') {
      const c = JSON.parse(cuerpo);
      if (!(await buscarRegistro(c.clave))) return fallo(404, NO_ENCONTRADA);
      const v = validarPaso(c);
      if (v.error) return fallo(400, v.error);
      await almacen.marcarPaso(c.clave, v.id, v.hecho, v.entrada);
      return ok(await datosActuales());
    }

    // ---------- Documentos de las postulantes ----------
    // Crea el enlace de subida. El código se muestra una sola vez: no queda guardado en ninguna parte.
    if (ruta === 'POST /api/enlace') {
      const { clave, fecha } = JSON.parse(cuerpo);
      const registro = await buscarRegistro(clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!paginaSubida()) return fallo(400, 'Falta configurar la dirección de la página de subida (paginaSubida).');
      if (!E.carta) return fallo(501, 'Este equipo no puede preparar la carta.');
      // La carta ya completada queda lista para que la persona la descargue desde la propia página de subida.
      await almacen.prepararCarta(clave, await E.carta.generarCarta(registro, { fecha: fecha === true }));
      const e = await almacen.crearEnlace(clave, 30);
      return ok({ url: urlPagina(`/#${e.token}`), vence_en: e.vence_en });
    }
    if (ruta === 'GET /api/documentos') {
      const clave = consulta.get('clave');
      if (!clave) return fallo(400, 'Falta la postulante.');
      return ok({ documentos: await almacen.documentos(clave), paginaSubida: !!paginaSubida() });
    }
    if (ruta === 'GET /api/documento/ver') {
      const a = await almacen.archivo(consulta.get('id') || '');
      return { estado: 200, bytes: a.bytes, tipo: a.tipo, cabeceras: { 'Content-Disposition': 'inline', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } };
    }
    if (ruta === 'POST /api/documento/borrar-carnet') {
      const { id } = JSON.parse(cuerpo);
      await almacen.borrarCarnet(id);
      return ok({ ok: true });
    }

    // Actualizar el listado con la planilla de socias de AMAGRO. Solo la administradora.
    // Vista previa: no guarda nada, solo dice qué cambiaría. Aplicar: recalcula el plan y guarda lo confirmado.
    if (ruta === 'POST /api/socias/vista-previa' || ruta === 'POST /api/socias/aplicar') {
      if (!sesion.esAdmin()) return fallo(403, 'Solo la administradora puede importar la planilla de socias.');
      const a = analizar(cuerpo); if (a.error) return a.error;
      const c = a.cuerpo || {};
      let texto = typeof c.csv === 'string' ? c.csv : '';
      if (!texto.trim()) {
        if (!c.url) return fallo(400, 'Elige el archivo o pega el enlace de la planilla de socias.');
        if (!E.descargarHoja) return fallo(501, 'Este equipo no puede descargar la planilla.');
        try { texto = await E.descargarHoja(c.url); } catch (e) { return fallo(400, e.message); }
      }
      const leidas = leerSocias(texto);
      if (leidas.error) return fallo(400, leidas.error);
      const plan = planificar(leidas.socias, (await datosActuales()).registros);
      if (ruta === 'POST /api/socias/vista-previa') {
        return ok({ resumen: plan.resumen, revisiones: plan.revisiones, conflictos: plan.conflictos, sinCoincidencia: plan.sinCoincidencia, noActivas: plan.noActivas, avisos: leidas.avisos });
      }
      const aceptadas = Array.isArray(c.aceptadas) ? c.aceptadas.filter(x => typeof x === 'string') : [];
      const porClave = camposAAplicar(plan, aceptadas);
      for (const campos of Object.values(porClave)) {
        const v = validarCampos(campos);
        if (v.error) return fallo(400, v.error);
      }
      const r = await almacen.editarVarios(porClave);
      return ok({ aplicadas: r.ok, fallidas: r.fallidas.length, aceptadas: aceptadas.length, ...(await datosActuales()) });
    }

    // ---------- Cargos y condición de socia fundadora ----------
    // Se manda la lista COMPLETA de cargos de hoy (sin historial) y/o si es socia fundadora. Todo se valida en validarCampos y queda
    // en el historial como cualquier otra corrección de la ficha.
    if (ruta === 'POST /api/cargos') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const { clave, cargos, fundadora } = a.cuerpo || {};
      const registro = await buscarRegistro(clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      const cambios = {};
      if (cargos !== undefined) cambios.cargos = JSON.stringify(cargos);
      if (fundadora !== undefined) { if (typeof fundadora !== 'boolean') return fallo(400, 'Dato inválido.'); cambios.fundadora = fundadora ? 'si' : 'no'; }
      if (!Object.keys(cambios).length) return fallo(400, 'No hay nada que cambiar.');
      const v = validarCampos(cambios);
      if (v.error) return fallo(400, v.error);
      await almacen.editarCampos(registro.clave, v.limpios);
      return ok(await datosActuales());
    }

    // ---------- Postulaciones activas / no activas ----------
    // Dejar de gestionar una postulación la oculta del listado y de los avisos; no se borra y se puede reactivar.
    if (ruta === 'POST /api/activa') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const { claves, activa } = a.cuerpo || {};
      if (typeof activa !== 'boolean' || !Array.isArray(claves) || !claves.length || claves.length > 1000 || claves.some(x => typeof x !== 'string' || !x)) return fallo(400, 'Datos inválidos.');
      const existentes = new Set((await datosActuales()).registros.map(r => r.clave));
      const validas = [...new Set(claves)].filter(c => existentes.has(c));
      if (!validas.length) return fallo(404, NO_ENCONTRADA);
      const r = activa
        ? await almacen.quitarCampoVarios(validas, 'inactiva')
        : await almacen.editarVarios(Object.fromEntries(validas.map(c => [c, { inactiva: 'si' }])));
      return ok({ cambiadas: r.ok, fallidas: r.fallidas.length, ...(await datosActuales()) });
    }

    // ---------- Duplicados de socias ----------
    // Propuesta: para cada persona que ya es socia y tiene más de una postulación, queda como principal la más reciente.
    // Aplicar solo marca las otras como duplicadas (no borra nada) y se puede deshacer una por una.
    if (ruta === 'GET /api/duplicados') return ok(proponer((await datosActuales()).registros));
    if (ruta === 'POST /api/duplicados/aplicar') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const principales = Array.isArray((a.cuerpo || {}).principales) ? a.cuerpo.principales.filter(x => typeof x === 'string') : [];
      if (!principales.length) return fallo(400, 'No hay grupos para aplicar.');
      const plan = planDeAplicacion((await datosActuales()).registros, principales);
      if (plan.error) return fallo(409, plan.error);
      for (const campos of Object.values(plan.porClave)) { const v = validarCampos(campos); if (v.error) return fallo(400, v.error); }
      const r = await almacen.editarVarios(plan.porClave);
      return ok({ marcadas: r.ok, fallidas: r.fallidas.length, ...(await datosActuales()) });
    }
    if (ruta === 'POST /api/duplicados/deshacer') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const registro = await buscarRegistro((a.cuerpo || {}).clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!registro.duplicadaDe) return fallo(400, 'Esa postulación no está marcada como duplicada.');
      await almacen.quitarCampo(registro.clave, 'duplicada');
      return ok(await datosActuales());
    }

    // ---------- Corrección de datos por enlace ----------
    // Crea el enlace con los datos que tienen alerta. El código se muestra una sola vez.
    if (ruta === 'POST /api/enlace-datos') {
      const { clave } = JSON.parse(cuerpo);
      const registro = await buscarRegistro(clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!paginaSubida()) return fallo(400, 'Falta configurar la dirección de la página de subida (paginaSubida).');
      const campos = camposConAlerta(registro);
      if (!Object.keys(campos).length) return fallo(400, 'Esta persona no tiene datos con alerta que pueda corregir ella misma.');
      const e = await almacen.crearEnlaceDatos(clave, campos, 14);
      return ok({ url: urlPagina(`/datos.html#${e.token}`), vence_en: e.vence_en, campos: Object.keys(campos) });
    }

    // Propuestas enviadas por las postulantes, con lo que hay hoy en la ficha y si lo propuesto es válido.
    if (ruta === 'GET /api/correcciones') {
      const [pend, actuales] = await Promise.all([almacen.correccionesPendientes(), datosActuales()]);
      const porClave = new Map(actuales.registros.filter(r => !r._encabezado).map(r => [r.clave, r]));
      return ok({ correcciones: pend.map(c => {
        const r = porClave.get(c.clave);
        return { id: c.id, clave: c.clave, fila: r ? r.fila : null, nombre: r ? r.nombre : '(ya no está en la planilla)', creado_en: c.creado_en,
          campos: Object.entries(c.campos).map(([campo, nuevo]) => ({ campo, hoy: r ? valorActual(r, campo) : '', nuevo, ...evaluarPropuesta(campo, nuevo) })) };
      }) });
    }

    // Acepta (todos o los campos elegidos) o descarta una propuesta. Lo aceptado se aplica a la ficha como una corrección más.
    if (ruta === 'POST /api/correcciones/resolver') {
      const { id, aceptar } = JSON.parse(cuerpo);
      const pend = (await almacen.correccionesPendientes()).find(c => c.id === id);
      if (!pend) return fallo(404, 'Esa propuesta ya fue resuelta o no existe.');
      const elegidos = Array.isArray(aceptar) ? aceptar.filter(k => typeof k === 'string' && k in pend.campos) : [];
      if (elegidos.length) {
        const v = validarCampos(Object.fromEntries(elegidos.map(k => [k, pend.campos[k]])));
        if (v.error) return fallo(400, v.error);
        await almacen.editarCampos(pend.clave, v.limpios);
      }
      await almacen.resolverCorreccion(id, elegidos.length > 0);
      return ok({ aplicados: elegidos.length, ...(await datosActuales()) });
    }

    // Cuántas postulantes tienen documentos por revisar. La pantalla lo consulta cada rato para avisar cuando llega algo nuevo.
    if (ruta === 'GET /api/pendientes') {
      const [ediciones, documentos, correcciones] = await Promise.all([almacen.leerEdiciones(), almacen.resumenDocumentos(), almacen.correccionesPendientes()]);
      const claves = Object.keys(documentos).filter(k => pendienteDeRevision(documentos[k], (ediciones[k] || {}).pasos)).sort();
      return ok({ pendientes: claves.length, correcciones: correcciones.length, firma: claves.map(k => k + '@' + documentos[k].ultimo).join('|') + '#' + correcciones.map(c => c.id).sort().join(',') });
    }

    // Historial de cambios (quién cambió qué y cuándo). Con ?clave=... solo el de esa postulante.
    if (ruta === 'GET /api/historial') {
      const clave = consulta.get('clave') || undefined;
      return ok({ historial: await almacen.historial({ clave, limite: clave ? 100 : 200 }) });
    }

    // Correcciones que quedaron guardadas en el equipo de antes de usar Supabase: ¿hay algo que subir?
    if (ruta === 'GET /api/migracion') {
      const local = E.migracion ? E.migracion.pendientes() : null;
      return ok({ pendientes: local ? Object.keys(local).length : 0 });
    }
    if (ruta === 'POST /api/migracion') {
      if (!sesion.esAdmin()) return fallo(403, 'Solo la administradora puede subir las correcciones antiguas.');
      const local = E.migracion ? E.migracion.pendientes() : null;
      if (!local) return fallo(400, 'No hay correcciones antiguas que subir.');
      const { respaldo, error } = validarRespaldo(local);
      if (error) return fallo(400, error);
      const r = await almacen.importar(respaldo);
      E.migracion.hecho(); // se conserva, pero ya no se vuelve a ofrecer
      return ok({ ...r, ...(await datosActuales()) });
    }

    // Estado del respaldo, para mostrarlo en el panel.
    if (ruta === 'GET /api/respaldo/info') {
      const ediciones = await almacen.leerEdiciones();
      const { ultimoRespaldo } = E.config();
      return ok({
        correcciones: Object.keys(ediciones).length,
        copias: E.copias ? E.copias() : 0,
        ultima: null,
        ultimoRespaldo: ultimoRespaldo || null,
        aviso: avisoRespaldo(ediciones, ultimoRespaldo),
        puedeRestaurar: sesion.esAdmin(),
      });
    }

    // Descarga las correcciones actuales como archivo y anota cuándo, para el recordatorio.
    if (ruta === 'GET /api/respaldo') {
      const ediciones = await almacen.leerEdiciones();
      E.guardarConfig({ ...E.config(), ultimoRespaldo: new Date().toISOString() });
      const dia = new Date().toISOString().slice(0, 10);
      return { estado: 200, texto: JSON.stringify(ediciones, null, 2), tipo: 'application/json; charset=utf-8', cabeceras: { 'Content-Disposition': `attachment; filename="amagro-correcciones-${dia}.json"` } };
    }

    // Deja las correcciones iguales al archivo de respaldo (reemplaza TODO, para todas las usuarias).
    // Solo la administradora. Antes se guarda una copia de lo que había.
    if (ruta === 'POST /api/respaldo/restaurar') {
      if (!sesion.esAdmin()) return fallo(403, 'Solo la administradora puede restaurar un respaldo.');
      let datos;
      try { datos = JSON.parse(cuerpo); } catch { return fallo(400, 'El archivo no es un JSON válido.'); }
      const { respaldo, error } = validarRespaldo(datos);
      if (error) return fallo(400, error);
      if (E.copiaLocal) await E.copiaLocal(await almacen.leerEdiciones());
      const r = await almacen.reemplazarTodo(respaldo);
      return ok({ ...r, ...(await datosActuales()) });
    }

    // Carta de solicitud en PDF, prellenada con los datos actuales de la ficha (incluidas las correcciones).
    // Va por POST para que el RUT, el correo y demás datos no queden escritos en la dirección web.
    if (ruta === 'POST /api/carta') {
      const { clave, fecha } = JSON.parse(cuerpo);
      const registro = await buscarRegistro(clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!E.carta) return fallo(501, 'Este equipo no puede preparar la carta.');
      return { estado: 200, bytes: await E.carta.generarCarta(registro, { fecha: fecha === true }), tipo: 'application/pdf',
        cabeceras: { 'Content-Disposition': `attachment; filename="${E.carta.nombreArchivo(registro.nombre)}"`, 'Cache-Control': 'no-store' } };
    }

    // Carta de no aceptación por el perfil de socias (mujeres del mundo privado). Solo para postulaciones en etapa «No califica».
    // El texto sale de un solo lugar (lib/cartaNoAceptacion.js): el correo y el PDF dicen lo mismo.
    if (ruta === 'GET /api/carta-no-aceptacion/texto' || ruta === 'POST /api/carta-no-aceptacion') {
      const registro = await buscarRegistro(ruta.startsWith('GET') ? consulta.get('clave') : (analizar(cuerpo).cuerpo || {}).clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (registro.etapa !== 'No califica') return fallo(400, 'Esta carta solo se prepara para postulaciones en la etapa «No califica».');
      if (ruta.startsWith('GET')) return ok({ ...noAceptacion.correo(registro), carnetPendiente: !!(registro.docs && registro.docs.carnet) });
      return { estado: 200, bytes: await noAceptacion.generar(registro, { logo: await E.logo() }), tipo: 'application/pdf',
        cabeceras: { 'Content-Disposition': 'attachment; filename="' + noAceptacion.nombreArchivo(registro.nombre) + '"', 'Cache-Control': 'no-store' } };
    }

    // Carta de bienvenida: solo para postulaciones con el paso «Aprobada por el directorio». Un correo corto con la carta
    // y los enlaces al resumen de los estatutos y a los estatutos completos (el texto sale de lib/cartaBienvenida.js).
    if (ruta === 'GET /api/carta-bienvenida/texto') {
      const registro = await buscarRegistro(consulta.get('clave'));
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!(registro.pasos && registro.pasos.aprobada)) return fallo(400, 'La carta de bienvenida se prepara cuando la postulación tiene marcado el paso «Aprobada por el directorio».');
      const enlaces = enlacesEstatutos();
      return ok({ ...bienvenida.correo(registro, enlaces), enlaces });
    }

    // Enlace único a la carta de bienvenida de esa persona: deja lista su carta (PDF con logo y su nombre) y crea el enlace.
    // La página bienvenida.html (en la página de subida) la entrega con ese enlace. Vale 60 días y se puede abrir varias veces.
    if (ruta === 'POST /api/enlace-bienvenida') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const registro = await buscarRegistro((a.cuerpo || {}).clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!(registro.pasos && registro.pasos.aprobada)) return fallo(400, 'La carta de bienvenida se prepara cuando la postulación tiene marcado el paso «Aprobada por el directorio».');
      if (!paginaSubida()) return fallo(400, 'Falta configurar la dirección de la página de subida (paginaSubida).');
      await almacen.prepararBienvenida(registro.clave, await bienvenida.generar(registro, { logo: await E.logo(), enlaces: enlacesEstatutos() }));
      const e = await almacen.crearEnlaceBienvenida(registro.clave, 60);
      return ok({ url: urlPagina(`/bienvenida.html#${e.token}`), vence_en: e.vence_en });
    }
    // Vista previa de esa misma carta en PDF (no deja nada guardado).
    if (ruta === 'POST /api/carta-bienvenida') {
      const a = analizar(cuerpo); if (a.error) return a.error;
      const registro = await buscarRegistro((a.cuerpo || {}).clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      if (!(registro.pasos && registro.pasos.aprobada)) return fallo(400, 'La carta de bienvenida se prepara cuando la postulación tiene marcado el paso «Aprobada por el directorio».');
      return { estado: 200, bytes: await bienvenida.generar(registro, { logo: await E.logo(), enlaces: enlacesEstatutos() }), tipo: 'application/pdf',
        cabeceras: { 'Content-Disposition': 'attachment; filename="' + bienvenida.nombreArchivo(registro.nombre) + '"', 'Cache-Control': 'no-store' } };
    }

    // Thunderbird: solo existe en el computador (en la web no hay).
    if (ruta === 'GET /api/correo/info') return ok({ thunderbird: !!(E.thunderbird && E.thunderbird.info()) });
    if (ruta === 'POST /api/carta/correo') {
      if (!E.thunderbird) return fallo(404, 'No se encontró Thunderbird en este computador.', { sinThunderbird: true });
      const { clave, fecha, asunto, cuerpo: texto } = JSON.parse(cuerpo);
      const registro = await buscarRegistro(clave);
      if (!registro) return fallo(404, NO_ENCONTRADA);
      return E.thunderbird.abrir({ registro, fecha: fecha === true, asunto, cuerpo: texto, fallo, ok });
    }

    return { estado: 404, texto: 'No encontrado', tipo: 'text/plain; charset=utf-8' };
  }

  // Punto de entrada: atiende una petición y siempre devuelve una respuesta (los errores también).
  return async function atender({ metodo, url, cuerpo = '' }) {
    try {
      return await enrutar({ metodo, url, cuerpo });
    } catch (e) {
      if (e instanceof ErrorSupabase) return fallo(e.estado >= 400 && e.estado < 600 ? e.estado : 500, e.message, e.sesion ? { sesion: false } : {});
      return fallo(500, e.message);
    }
  };
}

module.exports = { crearApi, pendienteDeRevision, SOLO_CONSULTA, ROLES_VALIDOS };

});

definir("lib/pdf", function (module, exports, require, __dirname, Buffer) {
// Escritor mínimo de PDF, sin dependencias externas: texto con fuentes estándar (Helvetica), líneas e
// una imagen opcional (PNG o JPEG). Pensado para documentos de una página como la carta de solicitud.
const zlib = require('zlib');

// ---- Fuentes: anchos de Helvetica y Helvetica-Bold (milésimas de em) para los códigos 32..126 ----
const ANCHO_NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const ANCHO_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];
const ESPECIALES = { '°': 400, '•': 350, '¿': 611, '¡': 333, 'º': 365, 'ª': 370, '–': 556, '—': 1000, '…': 1000, '“': 333, '”': 333, '‘': 222, '’': 222 };

function anchoCaracter(ch, negrita) {
  const tabla = negrita ? ANCHO_NEGRITA : ANCHO_NORMAL;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tabla[c - 32];
  if (ESPECIALES[ch] !== undefined) return ESPECIALES[ch];
  if ('íìîïÍÌÎÏ'.includes(ch)) return 278;
  const base = ch.normalize('NFD').charCodeAt(0); // "ñ" -> "n", "é" -> "e"
  return base >= 32 && base <= 126 ? tabla[base - 32] : tabla['n'.charCodeAt(0) - 32];
}

// Ancho en puntos de un texto con la fuente y tamaño dados.
function medir(texto, tam, negrita = false) {
  let suma = 0;
  for (const ch of String(texto)) suma += anchoCaracter(ch, negrita);
  return (suma * tam) / 1000;
}

// ---- Codificación WinAnsi (cp1252), la que usa la fuente: tildes, ñ, ¿, °, viñetas ----
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b,
  'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99,
  'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

// Devuelve una cadena donde cada carácter es un byte (0-255), lista para escribir como 'latin1'.
function aWinAnsi(texto) {
  let s = '';
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c < 32) s += ' ';
    else if (c < 128) s += ch;
    else if (CP1252[ch] !== undefined) s += String.fromCharCode(CP1252[ch]);
    else if (c >= 0xa0 && c <= 0xff) s += ch;
    else s += '?';
  }
  return s;
}

const cadenaPdf = texto => '(' + aWinAnsi(texto).replace(/[\\()]/g, '\\$&') + ')';
const num = n => String(Math.round(n * 100) / 100);

// ---- Imágenes ----
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Decodifica un PNG (sin entrelazado) a RGB de 8 bits, más un canal de transparencia si lo tiene.
function decodificarPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  let p = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), tipo = buf.toString('latin1', p + 4, p + 8), datos = buf.subarray(p + 8, p + 8 + len);
    if (tipo === 'IHDR') ihdr = { w: datos.readUInt32BE(0), h: datos.readUInt32BE(4), prof: datos[8], color: datos[9], entrelazado: datos[12] };
    else if (tipo === 'PLTE') plte = datos;
    else if (tipo === 'tRNS') trns = datos;
    else if (tipo === 'IDAT') idat.push(datos);
    else if (tipo === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr || !idat.length) throw new Error('PNG incompleto');
  if (ihdr.entrelazado) throw new Error('PNG entrelazado no soportado: guárdalo sin entrelazado');
  const { w, h, prof, color } = ihdr;
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!canales || ![1, 2, 4, 8, 16].includes(prof)) throw new Error('Tipo de PNG no soportado');

  const bitsPx = canales * prof, bpp = Math.max(1, bitsPx >> 3), fila = Math.ceil((w * bitsPx) / 8);
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) {
    const filtro = crudo[y * (fila + 1)], o = y * fila, s = y * (fila + 1) + 1;
    for (let i = 0; i < fila; i++) {
      const x = crudo[s + i];
      const a = i >= bpp ? px[o + i - bpp] : 0, b = y > 0 ? px[o - fila + i] : 0, c = i >= bpp && y > 0 ? px[o - fila + i - bpp] : 0;
      px[o + i] = (filtro === 0 ? x : filtro === 1 ? x + a : filtro === 2 ? x + b : filtro === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }

  const muestra = (y, x, k) => { // valor del canal k del píxel (x, y), llevado a 8 bits
    const o = y * fila;
    if (prof === 8) return px[o + x * canales + k];
    if (prof === 16) return px[o + (x * canales + k) * 2];
    const bit = x * prof; // prof < 8: un solo canal
    return (px[o + (bit >> 3)] >> (8 - prof - (bit & 7))) & ((1 << prof) - 1);
  };
  const tieneAlfa = color === 4 || color === 6 || (color === 3 && trns);
  const rgb = Buffer.alloc(w * h * 3), alfa = tieneAlfa ? Buffer.alloc(w * h) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r, g, bl, a = 255;
      if (color === 3) {
        const idx = muestra(y, x, 0);
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; bl = plte[idx * 3 + 2];
        if (trns && idx < trns.length) a = trns[idx];
      } else if (color === 0 || color === 4) {
        const v = muestra(y, x, 0);
        r = g = bl = prof < 8 ? Math.round((v * 255) / ((1 << prof) - 1)) : v;
        if (color === 4) a = muestra(y, x, 1);
      } else {
        r = muestra(y, x, 0); g = muestra(y, x, 1); bl = muestra(y, x, 2);
        if (color === 6) a = muestra(y, x, 3);
      }
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = bl;
      if (alfa) alfa[i] = a;
    }
  }
  return { tipo: 'png', ancho: w, alto: h, rgb, alfa };
}

// Lee las dimensiones de un JPEG; los datos se incrustan tal cual (el PDF sabe decodificarlos).
function leerJpeg(buf) {
  let p = 2;
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { p += m === 0xff ? 1 : 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const componentes = buf[p + 9];
      if (componentes !== 1 && componentes !== 3) throw new Error('JPEG en CMYK no soportado: guárdalo como RGB');
      return { tipo: 'jpeg', ancho: buf.readUInt16BE(p + 7), alto: buf.readUInt16BE(p + 5), componentes, datos: buf };
    }
    p += 2 + len;
  }
  throw new Error('JPEG inválido');
}

function leerImagen(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf); // puede llegar como Uint8Array (por ejemplo, desde el navegador)
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return decodificarPng(buf);
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return leerJpeg(buf);
  throw new Error('La imagen debe ser PNG o JPEG');
}

// ---- Lienzo: acumula las operaciones de dibujo de una página. Las coordenadas "y" se miden desde arriba. ----
class Lienzo {
  constructor(ancho = 612, alto = 792) {
    this.ancho = ancho; this.alto = alto; this.ops = [];
  }
  y(arriba) { return this.alto - arriba; }
  texto(x, yBase, texto, { negrita = false, tam = 11, palabra = 0 } = {}) {
    this.ops.push(`BT /${negrita ? 'F2' : 'F1'} ${num(tam)} Tf ${num(palabra)} Tw ${num(x)} ${num(this.y(yBase))} Td ${cadenaPdf(texto)} Tj ET`);
  }
  linea(x1, y1, x2, y2, grosor = 0.6) {
    this.ops.push(`${num(grosor)} w ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S`);
  }
  imagen(x, yArriba, w, h) {
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(yArriba + h))} cm /Im1 Do Q`);
  }
}

// ---- Ensamblado del archivo ----
function crearPdf(lienzo, { imagen = null, titulo = '' } = {}) {
  const partes = [], offsets = [];
  let largo = 0;
  const poner = x => { const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'latin1'); partes.push(b); largo += b.length; };
  const objeto = (n, cuerpo) => { offsets[n] = largo; poner(`${n} 0 obj\n`); poner(cuerpo); poner('\nendobj\n'); };
  const flujo = (dict, datos) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${datos.length} >>\nstream\n`, 'latin1'), datos, Buffer.from('\nendstream', 'latin1')]);
  const fuente = base => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;

  poner('%PDF-1.4\n%âãÏÓ\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${lienzo.ancho} ${lienzo.alto}] `
    + `/Resources << /Font << /F1 4 0 R /F2 5 0 R >>${imagen ? ' /XObject << /Im1 7 0 R >>' : ''} >> /Contents 6 0 R >>`);
  objeto(4, fuente('Helvetica'));
  objeto(5, fuente('Helvetica-Bold'));
  objeto(6, flujo('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(lienzo.ops.join('\n'), 'latin1'))));
  let siguiente = 7;
  if (imagen) {
    const base = `/Type /XObject /Subtype /Image /Width ${imagen.ancho} /Height ${imagen.alto} /BitsPerComponent 8`;
    if (imagen.tipo === 'jpeg') {
      objeto(siguiente++, flujo(`${base} /ColorSpace ${imagen.componentes === 1 ? '/DeviceGray' : '/DeviceRGB'} /Filter /DCTDecode`, imagen.datos));
    } else {
      objeto(siguiente++, flujo(`${base} /ColorSpace /DeviceRGB /Filter /FlateDecode${imagen.alfa ? ' /SMask 8 0 R' : ''}`, zlib.deflateSync(imagen.rgb)));
      if (imagen.alfa) objeto(siguiente++, flujo(`${base} /ColorSpace /DeviceGray /Filter /FlateDecode`, zlib.deflateSync(imagen.alfa)));
    }
  }
  const info = siguiente++;
  objeto(info, `<< /Title ${cadenaPdf(titulo)} /Producer (AMAGRO AG) >>`);

  const inicioXref = largo;
  let xref = `xref\n0 ${siguiente}\n0000000000 65535 f \n`;
  for (let n = 1; n < siguiente; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  poner(xref);
  poner(`trailer\n<< /Size ${siguiente} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

// Igual que crearPdf, pero con varias páginas (una lista de lienzos). La imagen (el logo) se comparte: cada página que la use la dibuja con /Im1.
function crearPdfPaginas(lienzos, { imagen = null, titulo = '' } = {}) {
  const partes = [], offsets = [];
  let largo = 0;
  const poner = x => { const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'latin1'); partes.push(b); largo += b.length; };
  const objeto = (n, cuerpo) => { offsets[n] = largo; poner(`${n} 0 obj\n`); poner(cuerpo); poner('\nendobj\n'); };
  const flujo = (dict, datos) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${datos.length} >>\nstream\n`, 'latin1'), datos, Buffer.from('\nendstream', 'latin1')]);
  const fuente = base => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;

  // Numeración: 1 catálogo, 2 páginas, 3-4 fuentes, 5 (y 6) imagen, luego cada página con su contenido, y al final la información.
  const idImagen = 5, hayAlfa = !!(imagen && imagen.tipo !== 'jpeg' && imagen.alfa);
  const primeraPagina = imagen ? (hayAlfa ? 7 : 6) : 5;
  const idPagina = i => primeraPagina + 2 * i, idContenido = i => primeraPagina + 2 * i + 1;
  const info = primeraPagina + 2 * lienzos.length;

  poner('%PDF-1.4\n%âãÏÓ\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${lienzos.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] /Count ${lienzos.length} >>`);
  objeto(3, fuente('Helvetica'));
  objeto(4, fuente('Helvetica-Bold'));
  if (imagen) {
    const base = `/Type /XObject /Subtype /Image /Width ${imagen.ancho} /Height ${imagen.alto} /BitsPerComponent 8`;
    if (imagen.tipo === 'jpeg') {
      objeto(idImagen, flujo(`${base} /ColorSpace ${imagen.componentes === 1 ? '/DeviceGray' : '/DeviceRGB'} /Filter /DCTDecode`, imagen.datos));
    } else {
      objeto(idImagen, flujo(`${base} /ColorSpace /DeviceRGB /Filter /FlateDecode${hayAlfa ? ' /SMask 6 0 R' : ''}`, zlib.deflateSync(imagen.rgb)));
      if (hayAlfa) objeto(6, flujo(`${base} /ColorSpace /DeviceGray /Filter /FlateDecode`, zlib.deflateSync(imagen.alfa)));
    }
  }
  lienzos.forEach((l, i) => {
    objeto(idPagina(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${l.ancho} ${l.alto}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imagen ? ` /XObject << /Im1 ${idImagen} 0 R >>` : ''} >> /Contents ${idContenido(i)} 0 R >>`);
    objeto(idContenido(i), flujo('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(l.ops.join('\n'), 'latin1'))));
  });
  objeto(info, `<< /Title ${cadenaPdf(titulo)} /Producer (AMAGRO AG) >>`);

  const inicioXref = largo, total = info + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  poner(xref);
  poner(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

module.exports = { Lienzo, crearPdf, crearPdfPaginas, leerImagen, decodificarPng, medir, aWinAnsi };

});

definir("lib/carta", function (module, exports, require, __dirname, Buffer) {
// Genera la carta de solicitud de ingreso en PDF, prellenada con los datos de la postulante.
// El PDF no se puede editar fácilmente, así que la persona solo la imprime, firma y devuelve.
// El texto y el diseño siguen la carta original de AMAGRO. Si cambia la redacción o los estatutos, se edita aquí.
const fs = require('fs');
const path = require('path');
const { Lienzo, crearPdf, leerImagen, medir } = require('./pdf');
const { sinTildes } = require('./normalizar');

const DESTINATARIA = { tratamiento: 'Sra.', nombre: 'Maritrini Lapuente', cargo: 'Presidenta AMAGRO AG' };

const PARRAFOS_INICIO = [
  'Por medio de la presente me dirijo a Ud. para manifestarle mi interés por ingresar como socia a la primera Asociación Gremial de Mujeres del Agro en Chile - AMAGRO AG.',
  'Comparto la visión de AMAGRO AG de ser un referente nacional e internacional en el desarrollo integral de las mujeres en el agro, representarnos y visibilizarnos, generando redes de contacto y apoyo para potenciar nuestro desarrollo.',
  'Por otra parte, estoy en conocimiento de que pertenecer como socia a AMAGRO AG implica mi compromiso con los Estatutos Gremiales, especialmente:',
];
const TITULO_ARTICULO = 'Artículo 10° - Las socias tienen las siguientes obligaciones:';
// Como en la carta original, las obligaciones van seguidas en un solo párrafo, separadas por viñetas.
const OBLIGACIONES = [
  'Mantener actualizada toda información personal proporcionada a la asociación gremial.',
  'Conocer y cumplir los estatutos de la asociación gremial.',
  'Asistir a las Asambleas y a las sesiones del Directorio a las cuales sea citada.',
  'Pagar oportunamente las cuotas ordinarias y extraordinarias que se fijen de acuerdo con los estatutos (cuota ordinaria mensual de $10.000.-).',
  'Cumplir los acuerdos válidamente adoptados por la Asamblea y el Directorio.',
  'Desempeñar los cargos para los cuales sea elegida por la Asamblea.',
  'Mantener una conducta irreprochable y no ofensiva por cualquier medio, con la asociación gremial, sus socias y con el directorio.',
];
const PARRAFO_CIERRE = 'Según esto, cumpliendo con la formalidad requerida, adjunto copia de mi carnet de identidad por ambos lados. Esperando buena acogida por parte del directorio y agradeciendo su consideración, se despide cordialmente,';

// ---- Formato de los datos ----
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

// "AILYN DEL PILAR MEDINA" -> "Ailyn del Pilar Medina" (las preposiciones quedan en minúscula salvo al inicio)
function titulo(texto) {
  const s = String(texto || '').trim().toLowerCase()
    .replace(/(^|[\s\-´'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return s.split(' ').map((p, i) => (i > 0 && PARTICULAS.has(p.toLowerCase()) ? p.toLowerCase() : p)).join(' ');
}

function nombreArchivo(nombre) {
  const base = sinTildes(String(nombre || '')).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `Carta_solicitud_${titulo(base.replace(/_/g, ' ')).replace(/ /g, '_') || 'postulante'}.pdf`;
}

function hoyCL(ahora = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(ahora.getDate())}-${p(ahora.getMonth() + 1)}-${ahora.getFullYear()}`;
}

// El logo es opcional: se usa el primer archivo assets/logo.png, logo.jpg o logo.jpeg que exista.
function leerLogo(carpeta = path.join(__dirname, '..', 'assets')) {
  for (const nombre of ['logo.png', 'logo.jpg', 'logo.jpeg']) {
    const ruta = path.join(carpeta, nombre);
    if (fs.existsSync(ruta)) return fs.readFileSync(ruta);
  }
  return null;
}

// ---- Diseño de la página (tamaño carta, en puntos) ----
const PAGINA = { ancho: 612, alto: 792 };
const MARGEN = 85;
const ANCHO = PAGINA.ancho - 2 * MARGEN;
const TAM = 11;
const INTERLINEA = 13.6;
const SEPARACION = 9;
const FILA_CAMPOS = 22;
const LOGO_MAX = { ancho: 170, alto: 78 };

// Reparte las palabras en líneas que quepan en el ancho dado.
function envolver(texto, ancho, tam, negrita) {
  const lineas = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && medir(prueba, tam, negrita) > ancho) { lineas.push(actual); actual = palabra; }
    else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

// Dibuja un párrafo (justificado salvo su última línea) y devuelve la nueva posición vertical.
function parrafo(lienzo, y, texto, { negrita = false, justificar = true, despues = SEPARACION } = {}) {
  const lineas = envolver(texto, ANCHO, TAM, negrita);
  lineas.forEach((l, i) => {
    const espacios = l.split(' ').length - 1;
    const sobra = ANCHO - medir(l, TAM, negrita);
    const palabra = justificar && i < lineas.length - 1 && espacios > 0 ? sobra / espacios : 0;
    lienzo.texto(MARGEN, y + i * INTERLINEA + 10.4, l, { negrita, tam: TAM, palabra });
  });
  return y + lineas.length * INTERLINEA + despues;
}

// Un campo "Etiqueta: ______" con el dato escrito sobre la línea. Si el dato no cabe, se achica la letra.
function campo(lienzo, x, ancho, y, etiqueta, valor) {
  const base = y + 10.4;
  lienzo.texto(x, base, `${etiqueta}:`, { tam: TAM });
  const desde = x + medir(`${etiqueta}: `, TAM), hasta = x + ancho;
  lienzo.linea(desde, base + 2.5, hasta, base + 2.5, 0.6);
  if (!valor) return;
  let tam = TAM, texto = valor;
  while (tam > 8 && medir(texto, tam, true) > hasta - desde - 4) tam -= 0.5;
  while (texto.length > 1 && medir(texto, tam, true) > hasta - desde - 4) texto = texto.slice(0, -2).trimEnd() + '…';
  lienzo.texto(desde + 2, base, texto, { negrita: true, tam });
}

// Arma las filas de campos como en la original (Rut y Domicilio juntos, Región y Teléfono, Email y Fecha).
// Si el domicilio es muy largo para compartir fila, pasa a una fila propia para no cortarlo.
function filasDeCampos(d) {
  const domicilio = [titulo(d.direccion), titulo(d.comuna)].filter(Boolean).join(', ');
  const campos = {
    nombre: ['Nombre', titulo(d.nombre)],
    rut: ['Rut', d.rut || ''],
    domicilio: ['Domicilio', domicilio],
    region: ['Región', titulo(d.region)],
    telefono: ['Teléfono', d.telefono || ''],
    email: ['Email', String(d.correo || '').toLowerCase()],
    fecha: ['Fecha', d.fecha || ''],
  };
  const dispuesto = 442 - 130 - 14 - medir('Domicilio: ', TAM) - 4;
  const domicilioCabe = medir(domicilio, 8.5, true) <= dispuesto;
  const f = k => campos[k];
  return domicilioCabe
    ? [[[...f('nombre'), 442]], [[...f('rut'), 130], [...f('domicilio'), 298]], [[...f('region'), 215], [...f('telefono'), 213]], [[...f('email'), 290], [...f('fecha'), 138]]]
    : [[[...f('nombre'), 442]], [[...f('rut'), 215], [...f('telefono'), 213]], [[...f('domicilio'), 442]], [[...f('region'), 215], [...f('fecha'), 213]], [[...f('email'), 442]]];
}

// Dibuja la carta completa y devuelve { lienzo, imagen, finalY }.
function dibujarCarta(d, logoBytes) {
  const lienzo = new Lienzo(PAGINA.ancho, PAGINA.alto);
  let imagen = null;
  let y = 54;

  if (logoBytes) {
    try {
      imagen = leerImagen(logoBytes);
      const escala = Math.min(LOGO_MAX.ancho / imagen.ancho, LOGO_MAX.alto / imagen.alto);
      const w = imagen.ancho * escala, h = imagen.alto * escala;
      lienzo.imagen((PAGINA.ancho - w) / 2, y, w, h);
      y += h + 18;
    } catch { imagen = null; } // un logo dañado no debe impedir generar la carta
  }

  for (const l of [DESTINATARIA.tratamiento, DESTINATARIA.nombre, DESTINATARIA.cargo]) {
    lienzo.texto(MARGEN, y + 10.4, l, { tam: TAM });
    y += INTERLINEA;
  }
  y += 2 * INTERLINEA;

  for (const t of PARRAFOS_INICIO) y = parrafo(lienzo, y, t);
  y = parrafo(lienzo, y, TITULO_ARTICULO, { negrita: true, justificar: false, despues: INTERLINEA });
  y = parrafo(lienzo, y, OBLIGACIONES.map(t => `• ${t}`).join(' '));
  y = parrafo(lienzo, y, PARRAFO_CIERRE, { despues: 2 * INTERLINEA - 1 });

  for (const fila of filasDeCampos(d)) {
    let x = MARGEN;
    for (const [etiqueta, valor, ancho] of fila) {
      campo(lienzo, x, ancho, y, etiqueta, valor);
      x += ancho + 14;
    }
    y += FILA_CAMPOS;
  }

  const yFirma = Math.max(y + 46, 706);
  lienzo.linea(206, yFirma, 406, yFirma, 0.7);
  return { lienzo, imagen, finalY: yFirma };
}

// datos: { nombre, rut, direccion, comuna, region, telefono, correo }. opciones.fecha: true = incluir la fecha de hoy.
function generarCarta(datos, { fecha = false, ahora = new Date(), logo = null } = {}) {
  const d = { ...datos, fecha: fecha ? hoyCL(ahora) : '' };
  const { lienzo, imagen } = dibujarCarta(d, logo);
  return crearPdf(lienzo, { imagen, titulo: 'Carta de solicitud de ingreso - AMAGRO AG' });
}

module.exports = { generarCarta, nombreArchivo, titulo, hoyCL, leerLogo, dibujarCarta, DESTINATARIA, MARGEN, ANCHO };

});

definir("lib/cartaNoAceptacion", function (module, exports, require, __dirname, Buffer) {
// Carta de no aceptación por el perfil de socias (solo mujeres del mundo privado). Es la ÚNICA carta de no aceptación que prepara
// la aplicación; las demás situaciones las comunica el Directorio por su cuenta. El texto lo revisó y aprobó AMAGRO.
// Lleva el logo (la envía la asociación) y se usa en dos formas: el PDF para adjuntar y el texto del correo (el mismo contenido).
const { Lienzo, crearPdf, leerImagen, medir } = require('./pdf');
const { titulo, MARGEN, ANCHO } = require('./carta');
const { sinTildes } = require('./normalizar');

// Cada párrafo es una lista de trozos { t: texto, b: negrita }.
const t = (texto, b = false) => ({ t: texto, b });
const PARRAFOS = [
  [t('Te agradecemos sinceramente el interés en ser parte de AMAGRO AG y el tiempo que dedicaste a tu solicitud de ingreso.')],
  [t('Lamentamos comunicarte que tu solicitud '), t('no pudo ser aceptada', true), t(', pues el perfil de socias que incluyen nuestros estatutos (publicado en el formulario de postulación) establece que AMAGRO AG representa a mujeres del mundo '), t('privado', true), t(' vinculadas al agro, por lo que no incluye a quienes trabajan en el sector público.')],
  [t('Esta decisión no se trata de una evaluación personal ni de tu trayectoria, por lo cual si tu situación laboral cambia en el futuro, puedes volver a postular.')],
  [t('Respecto de tus datos: '), t('la copia de tu carnet de identidad ya fue eliminada', true), t(' y no se conserva para resguardar la seguridad de tus datos.')],
  [t('Si tienes dudas, puedes escribirnos a '), t('socias@amagroag.cl', true), t('.')],
  [t('Te deseamos mucho éxito.')],
];
const DESPEDIDA = ['Hasta pronto,', '', 'Equipo', 'AMAGRO AG'];
const CIUDAD = 'Santiago';
const ASUNTO = 'AMAGRO AG · Respuesta a tu solicitud de ingreso';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (ahora = new Date()) => `${ahora.getDate()} de ${MESES[ahora.getMonth()]} de ${ahora.getFullYear()}`;

const sinFormato = p => p.map(x => x.t).join('');
const nombreDe = registro => titulo(registro.nombre) || 'postulante';

function nombreArchivo(nombre) {
  const base = sinTildes(String(nombre || '')).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `Carta_respuesta_${titulo(base.replace(/_/g, ' ')).replace(/ /g, '_') || 'postulante'}.pdf`;
}

// Texto para el correo (sin la línea de ciudad y fecha: el correo ya trae la fecha).
function correo(registro) {
  const correoInvalido = !registro.correo || registro.alertas.some(a => /^Correo inválido/.test(a));
  return {
    correoInvalido,
    destinatario: correoInvalido ? '' : registro.correo,
    asunto: ASUNTO,
    cuerpo: [`Estimada ${nombreDe(registro)}:`, '', ...PARRAFOS.flatMap(p => [sinFormato(p), '']), ...DESPEDIDA].join('\n'),
  };
}

// ---- PDF (tamaño carta, igual que la carta de solicitud) ----
const TAM = 11, INTERLINEA = 14.5, SEPARACION = 10;
const LOGO_MAX = { ancho: 150, alto: 82 };

// Párrafo con palabras en negrita, alineado a la izquierda. Devuelve la nueva posición vertical.
// Lo que va pegado en el texto (por ejemplo, «aceptada» + «, pues») se dibuja pegado y nunca se corta entre líneas.
function parrafoRico(lienzo, y, trozos, despues = SEPARACION) {
  const unidades = [];
  let pegada = false; // ¿lo siguiente continúa la palabra anterior? (el trozo anterior no terminó en espacio)
  for (const x of trozos) {
    const partes = x.t.split(/(s+)/);
    for (const p of partes) {
      if (!p) continue;
      if (/^s+$/.test(p)) { pegada = false; continue; }
      const pieza = { w: p, b: x.b, ancho: medir(p, TAM, x.b) };
      if (pegada && unidades.length) unidades[unidades.length - 1].push(pieza); else unidades.push([pieza]);
      pegada = true;
    }
  }
  const espacio = medir(' ', TAM);
  const lineas = [];
  let linea = [], largo = 0;
  for (const u of unidades) {
    const ancho = u.reduce((n, p) => n + p.ancho, 0);
    if (linea.length && largo + espacio + ancho > ANCHO) { lineas.push(linea); linea = []; largo = 0; }
    largo += (linea.length ? espacio : 0) + ancho;
    linea.push(u);
  }
  if (linea.length) lineas.push(linea);
  lineas.forEach((l, i) => {
    let x = MARGEN;
    for (const u of l) {
      for (const p of u) { lienzo.texto(x, y + i * INTERLINEA + 10.4, p.w, { negrita: p.b, tam: TAM }); x += p.ancho; }
      x += espacio;
    }
  });
  return y + lineas.length * INTERLINEA + despues;
}

function generar(registro, { ahora = new Date(), logo = null } = {}) {
  const lienzo = new Lienzo(612, 792);
  let imagen = null, y = 58;
  if (logo) {
    try {
      imagen = leerImagen(logo);
      const escala = Math.min(LOGO_MAX.ancho / imagen.ancho, LOGO_MAX.alto / imagen.alto);
      const w = imagen.ancho * escala, h = imagen.alto * escala;
      lienzo.imagen(MARGEN, y, w, h);
      y += h + 28;
    } catch { imagen = null; } // un logo dañado no impide generar la carta
  }
  y = parrafoRico(lienzo, y, [t(`${CIUDAD}, ${fechaLarga(ahora)}`)], SEPARACION + 4);
  y = parrafoRico(lienzo, y, [t(`Estimada ${nombreDe(registro)}:`)], SEPARACION + 4);
  for (const p of PARRAFOS) y = parrafoRico(lienzo, y, p, SEPARACION + 3);
  y += 8;
  for (const l of DESPEDIDA) { y = l ? parrafoRico(lienzo, y, [t(l)], 0) : y + INTERLINEA; }
  return crearPdf(lienzo, { imagen, titulo: 'Respuesta a la solicitud de ingreso - AMAGRO AG' });
}

module.exports = { generar, correo, nombreArchivo, fechaLarga, PARRAFOS, ASUNTO };

});

definir("lib/redactor", function (module, exports, require, __dirname, Buffer) {
// Redactor: escribe texto corrido en un PDF de tamaño carta y pasa a la página siguiente cuando se acaba el espacio.
// Soporta negrita dentro del párrafo. Lo que va pegado en el texto (por ejemplo «aceptada» + «, pues») se dibuja pegado y no se
// corta entre líneas. Sin dependencias de Node (corre igual en el navegador).
const { Lienzo, medir } = require('./pdf');

const t = (texto, b = false) => ({ t: texto, b });

class Redactor {
  constructor({ ancho = 612, alto = 792, margen = 85, arriba = 58, abajo = 60, tam = 11, interlinea = 14.5 } = {}) {
    Object.assign(this, { ancho, alto, margen, arriba, abajo, tam, interlinea });
    this.anchoUtil = ancho - 2 * margen;
    this.paginas = [];
    this.nueva();
  }
  nueva() {
    this.lienzo = new Lienzo(this.ancho, this.alto);
    this.paginas.push(this.lienzo);
    this.y = this.arriba;
  }
  // Hace lugar para `alto` puntos; si no cabe, empieza otra página.
  reservar(alto) { if (this.y + alto > this.alto - this.abajo) this.nueva(); }
  espacio(alto) { this.y += alto; }

  // Párrafo con negrita (lista de trozos { t, b }). `tam` opcional para texto más chico (por ejemplo, direcciones web).
  parrafo(trozos, { despues = 10, tam = this.tam, sangria = 0 } = {}) {
    const unidades = [];
    let pegada = false; // ¿lo siguiente continúa la palabra anterior?
    for (const x of trozos) {
      for (const p of x.t.split(/(\s+)/)) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { pegada = false; continue; }
        const pieza = { w: p, b: x.b, ancho: medir(p, tam, x.b) };
        if (pegada && unidades.length) unidades[unidades.length - 1].push(pieza); else unidades.push([pieza]);
        pegada = true;
      }
    }
    const espacio = medir(' ', tam), disponible = this.anchoUtil - sangria;
    const lineas = [];
    let linea = [], largo = 0;
    for (const u of unidades) {
      const ancho = u.reduce((n, p) => n + p.ancho, 0);
      if (linea.length && largo + espacio + ancho > disponible) { lineas.push(linea); linea = []; largo = 0; }
      largo += (linea.length ? espacio : 0) + ancho;
      linea.push(u);
    }
    if (linea.length) lineas.push(linea);
    const alto = tam / this.tam * this.interlinea;
    // Una línea suelta no se deja sola al final ni al comienzo de una página: se reservan al menos dos.
    this.reservar(alto * Math.min(lineas.length, 2));
    for (const l of lineas) {
      this.reservar(alto);
      let x = this.margen + sangria;
      for (const u of l) {
        for (const p of u) { this.lienzo.texto(x, this.y + tam * 0.95, p.w, { negrita: p.b, tam }); x += p.ancho; }
        x += espacio;
      }
      this.y += alto;
    }
    this.y += despues;
  }
  linea(texto, opciones = {}) { this.parrafo([t(texto, opciones.negrita)], { despues: 0, ...opciones }); }
  // Dibuja una imagen (el logo) a la izquierda, sin salirse del máximo dado.
  imagen(imagen, { maxAncho = 150, maxAlto = 82 } = {}) {
    const escala = Math.min(maxAncho / imagen.ancho, maxAlto / imagen.alto);
    const w = imagen.ancho * escala, h = imagen.alto * escala;
    this.lienzo.imagen(this.margen, this.y, w, h);
    this.y += h;
  }
}

module.exports = { Redactor, t };

});

definir("lib/cartaBienvenida", function (module, exports, require, __dirname, Buffer) {
// Carta de bienvenida a quien el Directorio aprobó. Tiene dos formas, con el mismo texto (revisado por el Directorio):
//  - el PDF con logo y el nombre de la persona (varias páginas), que ella descarga desde un enlace único; y
//  - un correo corto que le avisa y le da ese enlace, más los enlaces a los estatutos.
//
// PENDIENTE: la información de la cuota social y los datos para pagar. Se agregará cuando se defina la forma de pago
// (por ejemplo, con Flow). Para sumarla basta con poner texto en SECCION_PAGO: va en el PDF y en el correo.
const { titulo } = require('./carta');
const { crearPdfPaginas, leerImagen } = require('./pdf');
const { Redactor, t } = require('./redactor');
const { fechaLarga } = require('./cartaNoAceptacion');
const { sinTildes } = require('./normalizar');

const ASUNTO = '¡Bienvenida a AMAGRO AG!';
const MARCA_CARTA = '[ENLACE_CARTA_BIENVENIDA]'; // en el texto del correo; se reemplaza por el enlace único al enviarlo
const SECCION_PAGO = null; // ej.: 'Cuota social: ...\n\nDatos para el pago: ...'
const CIUDAD = 'Santiago';

const CARTA = [
  '¡Con mucha alegría te damos la más cordial bienvenida a AMAGRO A.G.!',
  'Nos complace comunicarte que nuestro Directorio ha aprobado tu incorporación a esta gran comunidad de mujeres que aman el agro y trabajan por transformar su futuro.',
  'AMAGRO, la primera Asociación Gremial de Mujeres del Agro en Chile, nace para representar, conectar y visibilizar a las mujeres de nuestro sector. Hoy, nuestro propósito va más allá: consolidarnos como una plataforma de oportunidades y desarrollo integral para las mujeres del agro y del mundo rural, impulsando sus talentos, fortaleciendo sus liderazgos y contribuyendo a su crecimiento personal, profesional, social y económico.',
  'Creemos en el poder de la colaboración. Por eso, construimos redes y alianzas con instituciones públicas, privadas, gremiales y académicas para compartir conocimientos, abrir oportunidades, promover la innovación y la sustentabilidad, y hacer que nuestra voz sea escuchada en los espacios donde se toman las decisiones que impactan al sector.',
  'Estamos convencidas de que cuando una mujer crece, se fortalece su familia, progresa su comunidad y se construye un mejor futuro para Chile.',
  'En AMAGRO, cada socia aporta su experiencia, sus talentos y su visión. Queremos que encuentres aquí un espacio de encuentro, apoyo y oportunidades, donde juntas podamos generar un impacto real.',
];
const TITULO_INFO = 'Información importante para tu incorporación';
// En la carta original decía «Adjuntamos nuestros Estatutos y una carta resumen»; como no se adjunta nada, se cambió por enlaces.
const ESTATUTOS_INTRO = 'te dejamos un resumen con sus principales disposiciones, derechos y obligaciones, y los Estatutos completos, para tu conocimiento y consulta:';
const DIRECTORIO = [
  'Presidenta: Maritrini Lapuente',
  'Vicepresidenta: Sandra Zolezzi',
  'Tesorera: Carolina Uquillas',
  'Secretaria: Liliana Camelio',
  'Directora: María Eugenia Arévalo',
];
const CIERRE = [
  'Para cualquier consulta, puedes escribirnos a socias@amagroag.cl.',
  'Nos llena de entusiasmo contar contigo. Te invitamos a participar activamente, compartir tus ideas y ser protagonista de este proyecto que construimos entre todas.',
];
const FIRMA = ['Con mucho cariño,', '', 'Directorio AMAGRO A.G.', 'Asociación Gremial de Mujeres del Agro de Chile', '', 'AMAGRO, ¡MUJERES QUE AMAN EL AGRO!'];

const nombreDe = registro => titulo(registro.nombre) || 'socia';

// Los tres enlaces de los estatutos, como líneas de texto. enlaces: { resumen, lectura, copiaNotarial }.
function listaEstatutos(enlaces = {}) {
  return [
    ...(enlaces.resumen ? [`• Resumen de los Estatutos: ${enlaces.resumen}`] : []),
    ...(enlaces.lectura ? [`• Estatutos completos (versión de lectura): ${enlaces.lectura}`] : []),
    ...(enlaces.copiaNotarial ? [`• Copia notarial (escaneada), que es el documento oficial: ${enlaces.copiaNotarial}`] : []),
  ];
}

// Correo corto: avisa, da el enlace a la carta (MARCA_CARTA) y los enlaces a los estatutos.
function correo(registro, enlaces = {}) {
  const correoInvalido = !registro.correo || registro.alertas.some(a => /^Correo inválido/.test(a));
  const lista = listaEstatutos(enlaces);
  const cuerpo = [
    `Estimada ${nombreDe(registro)},`, '',
    '¡Bienvenida a AMAGRO AG! Con mucha alegría te comunicamos que nuestro Directorio ha aprobado tu incorporación.', '',
    'Aquí está tu carta de bienvenida, con más información para tu incorporación:', MARCA_CARTA, '',
    ...(lista.length ? ['Estatutos gremiales: ' + ESTATUTOS_INTRO, ...lista, ''] : []),
    ...(SECCION_PAGO ? [SECCION_PAGO, ''] : []),
    CIERRE[0], '',
    ...FIRMA,
  ].join('\n');
  return { correoInvalido, destinatario: correoInvalido ? '' : registro.correo, asunto: ASUNTO, cuerpo, pagoIncluido: !!SECCION_PAGO, marca: MARCA_CARTA };
}

function nombreArchivo(nombre) {
  const base = sinTildes(String(nombre || '')).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `Carta_bienvenida_${titulo(base.replace(/_/g, ' ')).replace(/ /g, '_') || 'socia'}.pdf`;
}

// PDF de la carta completa, con logo y el nombre de la persona.
function generar(registro, { ahora = new Date(), logo = null, enlaces = {} } = {}) {
  const r = new Redactor();
  let imagen = null;
  if (logo) {
    try { imagen = leerImagen(logo); r.imagen(imagen); r.espacio(26); } catch { imagen = null; } // un logo dañado no impide generar la carta
  }
  r.parrafo([t(`${CIUDAD}, ${fechaLarga(ahora)}`)], { despues: 14 });
  r.parrafo([t(`Estimada ${nombreDe(registro)},`)], { despues: 14 });
  CARTA.forEach((p, i) => r.parrafo([t(p, i === 0)], { despues: 13 }));
  r.parrafo([t(TITULO_INFO, true)], { despues: 8 });
  r.parrafo([t('Estatutos gremiales: ', true), t(ESTATUTOS_INTRO)], { despues: 6 });
  for (const l of listaEstatutos(enlaces)) r.parrafo([t(l)], { despues: 4, tam: 9, sangria: 10 });
  r.espacio(8);
  if (SECCION_PAGO) for (const p of SECCION_PAGO.split(/\n\n+/)) r.parrafo([t(p)], { despues: 10 });
  r.reservar(120); // el título y la lista del Directorio no se separan entre páginas
  r.parrafo([t('Nuestro Directorio', true)], { despues: 4 });
  DIRECTORIO.forEach(l => r.parrafo([t(l)], { despues: 2 }));
  r.espacio(12);
  CIERRE.forEach(p => r.parrafo([t(p)], { despues: 13 }));
  FIRMA.forEach((l, i) => (l ? r.parrafo([t(l, i === FIRMA.length - 1)], { despues: 0 }) : r.espacio(14.5)));
  return crearPdfPaginas(r.paginas, { imagen, titulo: 'Carta de bienvenida - AMAGRO AG' });
}

module.exports = { correo, generar, nombreArchivo, listaEstatutos, ASUNTO, MARCA_CARTA };

});

// Versión web: la pantalla de siempre, pero sin servidor. Aquí se arma la API (lib/api.js) dentro del navegador, con la
// sesión de cada persona guardada en el propio navegador, y se hace que las llamadas "/api/..." de la pantalla vayan a ella.
// Los permisos los hace cumplir Supabase (la base de datos y las funciones), no este código.
function iniciarAdaptador(req) {
  const cfg = window.AMAGRO_WEB || {};
  const { Sesion } = req('lib/supabase');
  const { Almacen } = req('lib/almacen');
  const { crearApi } = req('lib/api');
  const carta = req('lib/carta');
  const fetchReal = window.fetch.bind(window);

  const guardado = {
    leer: clave => { try { return window.localStorage.getItem(clave); } catch { return null; } },
    guardar: (clave, t) => { try { window.localStorage.setItem(clave, t); } catch { /* sin almacenamiento: no se recuerda la sesión */ } },
    borrar: clave => { try { window.localStorage.removeItem(clave); } catch { /* nada */ } },
  };
  const persistencia = { leer: () => guardado.leer('amagro-sesion'), guardar: t => guardado.guardar('amagro-sesion', t), borrar: () => guardado.borrar('amagro-sesion') };

  const sesion = new Sesion({ url: cfg.url, clave: cfg.clavePublica, persistencia });
  const almacen = new Almacen(sesion);
  const proyecto = { url: cfg.url, clave: cfg.clavePublica, paginaSubida: cfg.paginaSubida || '', correoEnvio: cfg.correoEnvio || '', urlApp: cfg.urlApp || '' };

  // El logo del PDF se convierte a JPEG (el PDF lo incrusta tal cual, sin necesitar descomprimir nada).
  let logo;
  async function logoJpeg() {
    if (logo !== undefined) return logo;
    try {
      const r = await fetchReal(cfg.logo || 'logo.png');
      const imagen = await createImageBitmap(await r.blob());
      const lienzo = document.createElement('canvas');
      lienzo.width = imagen.width; lienzo.height = imagen.height;
      const g = lienzo.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, lienzo.width, lienzo.height);
      g.drawImage(imagen, 0, 0);
      const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', 0.92));
      logo = new Uint8Array(await blob.arrayBuffer());
    } catch { logo = null; } // sin logo la carta sale igual
    return logo;
  }

  const entorno = {
    config: () => { try { return JSON.parse(guardado.leer('amagro-config') || '{}'); } catch { return {}; } },
    guardarConfig: c => guardado.guardar('amagro-config', JSON.stringify(c)),
    logo: logoJpeg,
    carta: { generarCarta: carta.generarCarta, nombreArchivo: carta.nombreArchivo },
    // El navegador no puede bajar la planilla de Google (lo impide por seguridad): lo hace una función de Supabase.
    descargarHoja: async url => (await sesion.funcion('documentos', { accion: 'hoja_descargar', url })).texto,
    // Antes de reemplazar todo con un respaldo, se baja una copia de lo que había.
    copiaLocal: ediciones => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(ediciones, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `amagro-antes-de-restaurar-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };

  const api = crearApi({ sesion, almacen, proyecto, entorno });

  const aRespuesta = r => (r.json !== undefined
    ? new Response(JSON.stringify(r.json), { status: r.estado, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
    : new Response(r.bytes !== undefined ? r.bytes : r.texto, { status: r.estado, headers: { 'Content-Type': r.tipo, ...(r.cabeceras || {}) } }));

  // Las llamadas a "/api/..." van a la API de arriba; todo lo demás sigue su camino normal.
  window.fetch = async (entrada, init = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    if (!url.startsWith('/api/')) return fetchReal(entrada, init);
    return aRespuesta(await api({ metodo: (init.method || 'GET').toUpperCase(), url, cuerpo: typeof init.body === 'string' ? init.body : '' }));
  };

  // La pantalla espera esto antes de preguntar si hay una sesión abierta.
  window.AMAGRO_LISTO = sesion.retomar().catch(() => false);
  window.AMAGRO_INTERNO = { sesion, almacen, api };
}

window.AMAGRO_MODULO = cargar;
iniciarAdaptador(cargar);
})();
