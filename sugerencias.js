// Sugerencias de personas para crear cuentas: se toman de la lista de socias que ya está cargada en pantalla, para no
// tener que escribir nombres ni correos a mano. Sirve en el navegador (window.Sugerencias) y en las pruebas (require).
(function (raiz) {
  const sinTildes = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clave = s => sinTildes(s).toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

  // "MARÍA DE LOS ÁNGELES PÉREZ" -> "María de los Ángeles Pérez"
  function nombrePropio(texto) {
    return String(texto ?? '').trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
      .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  // Personas distintas de la lista (una vez cada una, aunque haya postulado más de una vez), con su correo más reciente.
  // Por defecto solo las socias; con todas = true, cualquiera de la planilla.
  function personas(registros, { todas = false } = {}) {
    const porPersona = new Map();
    for (const r of registros || []) {
      if (r._encabezado || !r.nombre) continue;
      if (!todas && r.etapa !== 'Socia') continue;
      const rut = String(r.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
      const id = rut.length >= 7 ? 'r' + rut : 'n' + clave(r.nombre);
      const previo = porPersona.get(id);
      if (!previo || String(r.postulacion).localeCompare(String(previo.postulacion)) >= 0) porPersona.set(id, r);
    }
    return [...porPersona.values()]
      .map(r => ({ nombre: nombrePropio(r.nombre), correo: String(r.correo || '').trim().toLowerCase(), fila: r.fila, etapa: r.etapa }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  // La persona cuyo nombre es exactamente el escrito (sin tildes ni mayúsculas), si hay una sola.
  function buscar(lista, texto) {
    const k = clave(texto);
    if (!k) return null;
    const coinciden = lista.filter(p => clave(p.nombre) === k);
    return coinciden.length === 1 ? coinciden[0] : null;
  }

  // Las personas cuyo nombre contiene TODAS las partes escritas, en cualquier orden y sin importar tildes ni mayúsculas.
  // "uquil caro" encuentra a "Carolina Uquillas Herrera". Primero las que empiezan igual. Con menos de 2 letras no propone nada.
  function filtrar(lista, texto, max = 8) {
    const partes = clave(texto).split(' ').filter(Boolean);
    if (partes.join('').length < 2) return [];
    return lista
      .filter(p => { const k = clave(p.nombre); return partes.every(t => k.includes(t)); })
      .sort((a, b) => (clave(b.nombre).startsWith(partes[0]) - clave(a.nombre).startsWith(partes[0])) || a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, max);
  }

  const api = { personas, buscar, filtrar, nombrePropio, clave };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Sugerencias = api;
})(typeof window !== 'undefined' ? window : globalThis);
