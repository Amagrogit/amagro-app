let datos = [];
// Los campos de solo lectura (por ejemplo, el enlace recién creado) se seleccionan al hacer clic, para copiarlos fácil.
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input[readonly]')) e.target.select(); });
let seleccion = null;
const ETAPAS = ['Pendiente de carta', 'Con documentos', 'Aprobada', 'Socia', 'Renuncia', 'No califica', 'Sin gestión'];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const claseEtapa = e => 'e-' + e.replace(/\s+/g, '-');
const dinero = n => n == null ? '' : '$' + Number(n).toLocaleString('es-CL');
const fechaCL = iso => iso ? iso.split('-').reverse().join('-') : '';
const pagoTexto = d => [d.ingreso != null ? dinero(d.ingreso) : '', d.modalidad].filter(Boolean).join(' · ');

let regiones = [];
let editando = false;
let orden = { campo: null, dir: 0 }; // dir: 1 ascendente, -1 descendente, 0 sin orden (el de la planilla)
const MODALIDADES = ['', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const SITUACIONES = ['', 'INDEPENDIENTE', 'DEPENDIENTE'];

function cargar(resp, conservar) {
  if (resp.error) { $('fuente').textContent = 'Error: ' + resp.error; return; }
  const previo = { region: $('region').value, etapa: $('etapa').value, sel: seleccion };
  datos = resp.registros;
  regiones = resp.regiones || regiones;
  pasosDef = resp.pasosDef || pasosDef;
  subidaDisponible = !!resp.paginaSubida;
  correoEnvio = resp.correoEnvio || '';
  plazoRespuesta = resp.plazoRespuestaDias || plazoRespuesta;
  $('hojaUrl').value = resp.hojaUrl || '';
  $('fuente').innerHTML = 'Fuente: ' + (resp.fuente.includes('EJEMPLO') ? '<b>' + esc(resp.fuente) + '</b>' : esc(resp.fuente));
  $('avisos').innerHTML = resp.columnasNoEncontradas.length && !/^Todavía no hay planilla/.test(resp.fuente)
    ? '<div class="aviso">No se encontraron estas columnas en el archivo: <b>' + esc(resp.columnasNoEncontradas.join(', ')) + '</b>. Revisa los encabezados.</div>' : '';
  const regs = [...new Set(datos.map(d => d.region).filter(Boolean))].sort();
  $('region').innerHTML = '<option value="">Todas las regiones</option>' + regs.map(r => `<option>${esc(r)}</option>`).join('');
  const cuenta = {};
  datos.forEach(d => { cuenta[d.etapa] = (cuenta[d.etapa] || 0) + 1; });
  $('etapa').innerHTML = '<option value="">Todas las etapas</option>' +
    ETAPAS.filter(e => cuenta[e]).map(e => `<option value="${esc(e)}">${esc(e)} (${cuenta[e]})</option>`).join('');
  // Al guardar una edición se conservan los filtros y la ficha abierta
  for (const id of ['region', 'etapa']) {
    if ([...$(id).options].some(o => o.value === previo[id])) $(id).value = previo[id];
  }
  editando = false;
  if (conservar && datos.some(x => x.fila === previo.sel)) { pintar(); abrirFicha(previo.sel, false, true); }
  else cerrarFicha();
  revisarAvisoRespaldo();
  actualizarAvisoDocs(datos.filter(x => x.pendienteRevision).length);
}

function pintar() {
  const q = $('buscar').value.toLowerCase(), f = $('filtro').value, reg = $('region').value, et = $('etapa').value;
  const dias = Number($('periodo').value);
  const desde = dias ? Date.now() - dias * 864e5 : null;
  const vis = datos.filter(d =>
    (!q || [d.nombre, d.rut, d.empresa, d.comuna, d.correo].join(' ').toLowerCase().includes(q)) &&
    (f === 'todas' || (f === 'duplicadas' ? d.relacionadas.length > 0 : f === 'sinrespuesta' ? !!d.seguimiento : f === 'porrevisar' ? !!d.pendienteRevision : (f === 'alertas') === (d.alertas.length > 0))) &&
    (!reg || d.region === reg) && (!et || d.etapa === et) &&
    (!desde || (d.postulacion && Date.parse(d.postulacion) >= desde)));
  // Orden: las filas sin dato quedan siempre al final, sea cual sea la dirección.
  if (orden.dir) {
    vis.sort((a, b) => {
      const x = a[orden.campo], y = b[orden.campo];
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return orden.dir * (orden.campo === 'nombre' ? x.localeCompare(y, 'es') : (x < y ? -1 : x > y ? 1 : 0));
    });
  }
  document.querySelectorAll('#encabezadoTabla .orden').forEach(b => {
    b.querySelector('span').textContent = b.dataset.orden === orden.campo && orden.dir ? (orden.dir === 1 ? '▲' : '▼') : '';
  });
  const con = datos.filter(d => d.alertas.length).length;
  $('resumen').innerHTML =
    `<div class="tarjeta"><div class="n">${datos.length}</div>postulaciones</div>` +
    `<div class="tarjeta"><div class="n">${vis.length}</div>en esta lista</div>` +
    `<div class="tarjeta bien"><div class="n">${datos.length - con}</div>sin alertas</div>` +
    `<div class="tarjeta mal"><div class="n">${con}</div>con alertas</div>`;
  $('filas').innerHTML = vis.length ? vis.map(d => `
    <tr class="${d.fila === seleccion ? 'sel' : ''}">
      <td><button class="enlace corto-b" data-fila="${d.fila}" title="${esc(d.nombre)}">${esc(d.nombre) || '(sin nombre)'}</button>${d.editados.length ? '<span class="ed" title="Editada en la app">✎</span>' : ''}${d.pendienteRevision ? ' <span class="chip nuevo" title="Envió documentos: falta revisarlos">📎 por revisar</span>' : ''}${d.relacionadas.length ? `<br><span class="chip" title="Otras filas: ${esc(d.relacionadas.map(o => o.fila).join(', '))}">⧉ ${d.relacionadas.length + 1} postulaciones</span>` : ''}</td>
      <td class="fecha">${d.postulacion
        ? `<span title="${esc(d.postulacion.length > 10 ? 'Hora de envío: ' + d.postulacion.slice(11, 16) : 'Sin hora registrada')}">${esc(fechaCL(d.postulacion.slice(0, 10)))}</span>`
        : (d.marca ? `<span class="fecha-texto" title="${esc(d.marca)}">${esc(d.marca)}</span>` : '<span class="nada">—</span>')}</td>
      <td class="fecha">${esc(d.rut)}</td>
      <td>${d.empresa ? `<span class="corto" title="${esc(d.empresa)}">${esc(d.empresa)}</span>` : ''}</td>
      <td><span class="corto corto-reg" title="${esc([d.region, d.comuna].filter(Boolean).join(' · '))}">${esc(d.region)}</span>${d.comuna ? `<small class="corto corto-reg">${esc(d.comuna)}</small>` : ''}</td>
      <td><span class="chip ${claseEtapa(d.etapa)}">${esc(d.etapa)}</span>${d.cargos.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</td>
      <td class="fecha">${puntosPasos(d)}</td>
      <td>${esc(pagoTexto(d)) || '<span class="nada">—</span>'}</td>
      <td>${d.alertas.length ? `<span class="chip mal" title="${esc(d.alertas.join('\n'))}">⚠ ${d.alertas.length}</span>` : '<span class="chip ok">OK</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="vacio">Sin resultados</td></tr>';
}

// ---- Ficha ----
const NADA = '<span class="nada">—</span>';
const dato = v => v ? esc(v) : NADA;

// Cada campo sabe cómo mostrarse (ver), con qué valor parte la edición (val) y qué control usa (tipo).
const campo = (k, et, extra = {}) => ({ k, et, tipo: 'texto', ver: d => dato(d[k]), val: d => d[k] ?? '', ...extra });
const secciones = () => [
  { titulo: 'Contacto', campos: [
    campo('nombre', 'Nombre'),
    campo('rut', 'RUT'),
    campo('correo', 'Correo'),
    campo('telefono', 'Teléfono'),
    campo('nacimiento', 'Nacimiento', { tipo: 'fecha', ver: d => d.nacimiento ? `${esc(fechaCL(d.nacimiento))} (${d.edad} años)` : NADA }),
    campo('direccion', 'Dirección'),
    campo('region', 'Región', { tipo: 'lista', opciones: () => regiones }),
    campo('comuna', 'Comuna'),
  ] },
  { titulo: 'Perfil', campos: [
    campo('profesion', 'Profesión'),
    campo('situacion', 'Situación', { tipo: 'lista', opciones: () => SITUACIONES }),
    campo('empresa', 'Empresa'),
    campo('origen', 'Nos conoció por'),
  ] },
  { titulo: 'Gestión', campos: [
    campo('etapa', 'Etapa', { tipo: 'lista', opciones: () => ETAPAS, ver: d => esc(d.etapa) }),
    campo('resultado', 'Resultado'),
    campo('inscripcion', 'N° de inscripción'),
  ] },
  { titulo: 'Pagos', campos: [
    campo('modalidad', 'Modalidad', { tipo: 'lista', opciones: () => MODALIDADES }),
    campo('ingreso', 'Ingreso', { tipo: 'numero', ver: d => d.ingreso != null ? esc(dinero(d.ingreso)) : NADA, val: d => d.ingreso ?? '' }),
  ] },
  { titulo: 'Asamblea', campos: [
    campo('citacion', 'Citación'),
    campo('asistencia', 'Asistencia'),
  ] },
];

function controlEdicion(d, c) {
  const ini = String(c.val(d));
  const attrs = `data-campo="${c.k}" data-ini="${esc(ini)}"`;
  if (c.tipo === 'lista') {
    const ops = c.opciones();
    const todas = ops.includes(ini) ? ops : [ini, ...ops];
    return `<select ${attrs}>${todas.map(o => `<option value="${esc(o)}"${o === ini ? ' selected' : ''}>${esc(o) || '(sin dato)'}</option>`).join('')}</select>`;
  }
  const tipo = { fecha: 'date', numero: 'number' }[c.tipo] || 'text';
  return `<input type="${tipo}"${c.tipo === 'numero' ? ' min="0"' : ''} ${attrs} value="${esc(ini)}">`;
}

function filaCampo(d, c) {
  if (editando) return `<dt>${c.et}</dt><dd>${controlEdicion(d, c)}</dd>`;
  const marca = d.editados.includes(c.k)
    ? `<span class="ed" title="${esc('Original en la planilla: ' + (d.originales[c.k] || '(vacío)'))}">✎</span>` : '';
  return `<dt>${c.et}</dt><dd>${c.ver(d)}${marca}</dd>`;
}

// ---- Pasos de admisión: lista de verificación con fecha y nota por paso ----
// En el listado: un punto por paso (lleno = hecho), y una marca si la carta lleva días sin respuesta.
function puntosPasos(d) {
  const puntos = pasosDef.map(p => {
    const e = d.pasos[p.id];
    return `<span class="punto${e ? ' on' : ''}" title="${esc(p.etiqueta + ': ' + (e ? fechaCL(e.fecha) : 'pendiente'))}"></span>`;
  }).join('');
  const seg = d.seguimiento ? ` <span class="chip mal" title="Carta enviada hace ${d.seguimiento.dias} días, sin respuesta">⏰ ${d.seguimiento.dias} d</span>` : '';
  return `<span class="puntos" title="${d.progreso} de ${pasosDef.length} pasos hechos">${puntos}</span>${seg}`;
}

let pasosDef = [];       // lista de pasos, la entrega el servidor
let correoEnvio = '';        // cuenta de Gmail desde la que se envían los correos (la define supabase/proyecto.json)
let subidaDisponible = false; // ¿está configurada la página donde la postulante sube sus documentos?
let plazoRespuesta = 15; // días sin respuesta a la carta antes de avisar
const hoyLocalISO = () => { const a = new Date(), p = n => String(n).padStart(2, '0'); return `${a.getFullYear()}-${p(a.getMonth() + 1)}-${p(a.getDate())}`; };

function bloquePasos(d) {
  const seg = d.seguimiento
    ? `<p class="seguimiento">⏰ La carta se envió hace ${d.seguimiento.dias} días y todavía no hay respuesta. Conviene hacer seguimiento.</p>` : '';
  const filas = pasosDef.map(p => {
    const e = d.pasos[p.id];
    return `<div class="paso-fila${e ? ' hecho' : ''}">
      <label${p.ayuda ? ` title="${esc(p.ayuda)}"` : ''}><input type="checkbox" data-paso="${p.id}"${e ? ' checked' : ''}> ${esc(p.etiqueta)}</label>
      ${e ? `<input type="date" data-paso-fecha="${p.id}" value="${esc(e.fecha)}" max="${hoyLocalISO()}" aria-label="Fecha: ${esc(p.etiqueta)}">
      <input type="text" class="nota-paso" data-paso-nota="${p.id}" value="${esc(e.nota)}" maxlength="300" placeholder="nota (opcional)" aria-label="Nota: ${esc(p.etiqueta)}">` : ''}
    </div>`;
  }).join('');
  return `<section><h3>Pasos de admisión <span class="sub" style="text-transform:none;letter-spacing:0">${d.progreso} de ${pasosDef.length}</span></h3>${seg}${filas}</section>`;
}

// Guarda un paso en el servidor y vuelve a dibujar la ficha con el resultado (la ficha conserva su posición).
async function guardarPaso(id, hecho, cambios = {}) {
  const d = datos.find(x => x.fila === seleccion);
  if (!d) return null;
  const actual = d.pasos[id] || {};
  const cuerpo = { clave: d.clave, paso: id, hecho };
  if (hecho) { cuerpo.fecha = cambios.fecha ?? actual.fecha ?? hoyLocalISO(); cuerpo.nota = cambios.nota ?? actual.nota ?? ''; }
  const r = await post('/api/paso', cuerpo);
  if (r.error) { mostrar(r.error, true); abrirFicha(seleccion, false, true); return null; }
  cargar(r, true);
  return r;
}

function abrirFicha(numero, editar = false, conservarPosicion = false) {
  const d = datos.find(x => x.fila === numero);
  if (!d) return;
  const posicion = $('ficha').scrollTop;
  seleccion = numero;
  editando = editar;
  const obsEditada = d.editados.includes('observaciones')
    ? `<span class="ed" title="${esc('Original en la planilla: ' + (d.originales.observaciones || '(vacío)'))}">✎</span>` : '';
  $('ficha').innerHTML = `
    <div class="cab">
      <div>
        <h2>${esc(d.nombre) || '(sin nombre)'}</h2>
        <span class="chip ${claseEtapa(d.etapa)}">${esc(d.etapa)}</span>${d.cargos.map(c => `<span class="chip">${esc(c)}</span>`).join('')}
        <div class="sub">Fila ${d.fila} de la planilla · postuló el ${d.postulacion ? esc(fechaCL(d.postulacion.slice(0, 10)) + (d.postulacion.length > 10 ? ' a las ' + d.postulacion.slice(11, 16) : '')) : (esc(d.marca) || '—')}</div>
      </div>
      <div class="cab-botones">
        ${editando ? '' : '<button class="sec btn-peq" id="editarFicha">✎ Editar</button>'}
        <button class="cerrar" id="cerrarFicha" aria-label="Cerrar">×</button>
      </div>
    </div>
    ${d.editados.length && !editando ? `<section class="editada">Esta ficha tiene ${d.editados.length} campo(s) corregido(s) en la app (marcados con ✎). La planilla de Google no se modifica.
      <button class="sec btn-peq" id="restaurarEd">Deshacer correcciones</button></section>` : ''}
    ${editando ? '' : bloquePasos(d)}
    ${d.relacionadas.length ? `<section><h3>Otras postulaciones de la misma persona</h3>
      ${d.relacionadas.map(o => `<div style="margin-bottom:6px"><button class="enlace" data-ir="${o.fila}">Fila ${o.fila}</button>
        <span class="chip ${claseEtapa(o.etapa)}">${esc(o.etapa)}</span>
        <div class="sub">${esc(o.marca) || 'sin fecha'} · ${esc(o.nombre)}</div></div>`).join('')}
    </section>` : ''}
    ${secciones().map(s => `<section><h3>${s.titulo}</h3><dl>
      ${s.campos.map(c => filaCampo(d, c)).join('')}
      ${s.titulo === 'Gestión' ? `<dt>Texto original</dt><dd>${dato(d.gestion)}</dd>` : ''}
    </dl></section>`).join('')}
    <section><h3>Motivación para postular</h3>${d.motivacion ? `<div class="texto">${esc(d.motivacion)}</div>` : NADA}</section>
    <section><h3>Observaciones ${obsEditada}</h3>${editando
      ? `<textarea data-campo="observaciones" data-ini="${esc(d.observaciones)}">${esc(d.observaciones)}</textarea>`
      : (d.observaciones ? `<div class="texto">${esc(d.observaciones)}</div>` : NADA)}</section>
    ${editando ? '' : bloqueCarta(d)}
    ${editando ? '' : '<section><h3>Historial de cambios</h3><div id="histFicha" class="sub">Cargando…</div></section>'}
    <section><h3>Alertas de calidad de datos</h3>${d.alertas.length ? d.alertas.map(a => `<span class="chip mal">${esc(a)}</span>`).join('') : '<span class="chip ok">Sin alertas</span>'}
      ${editando ? '' : bloqueMensaje(d)}</section>
    ${editando ? '<div class="pie"><button id="guardarEd">Guardar cambios</button><button class="sec" id="cancelarEd">Cancelar</button></div>' : ''}`;
  $('ficha').classList.add('abierta');
  $('ficha').setAttribute('aria-hidden', 'false');
  $('ficha').scrollTop = conservarPosicion ? posicion : 0;
  if (!editando) { cargarHistorialFicha(d.clave); cargarDocumentos(d); }
  if (document.body.classList.contains('lectura')) $('ficha').querySelectorAll('.paso-fila input').forEach(el => { el.disabled = true; });
  pintar();
}

// ---- Carta de solicitud prellenada (PDF): vista previa y correo para la postulante ----
// Avisos antes de enviar: datos con alertas (saldrían tal cual) y datos que faltan (queda la línea en blanco).
function avisosCarta(d) {
  const faltan = [['Nombre', d.nombre], ['RUT', d.rut], ['Domicilio', d.direccion], ['Región', d.region], ['Teléfono', d.telefono], ['Correo', d.correo]]
    .filter(([, v]) => !v).map(([k]) => k);
  const dudosos = [...new Set(d.alertas.flatMap(a =>
    /^RUT inválido/.test(a) ? ['RUT'] : /^Teléfono/.test(a) ? ['teléfono'] : /^(Región no|Marcó más de una región)/.test(a) ? ['región'] : /^Correo inválido/.test(a) ? ['correo'] : []))];
  return (dudosos.length ? `<p class="sub" style="color:var(--alerta);margin:0 0 6px">Revisa antes de enviarla: ${esc(dudosos.join(', '))} ${dudosos.length > 1 ? 'tienen' : 'tiene'} alertas y saldrían tal como están en la ficha.</p>` : '')
    + (faltan.length ? `<p class="sub" style="margin:0 0 6px">Faltan datos (quedarán en blanco para escribirlos a mano): ${esc(faltan.join(', '))}.</p>` : '');
}

function bloqueCarta(d) {
  return `<section><h3>Carta y documentos</h3>
    ${avisosCarta(d)}
    <button class="sec btn-peq" id="verCarta">📄 Ver carta y preparar correo</button>
    <p class="sub" style="margin:6px 0 10px">Se muestra en pantalla, ya con los datos de la ficha. El correo incluye el enlace para que la persona suba su carta firmada y su carnet.</p>
    <div id="docsFicha" class="sub">Cargando…</div>
  </section>`;
}

let cartaActual = null; // { d, correo, url, nombre }
let temporizadorCarta;
function estadoCarta(texto, error) {
  const el = $('cartaEstado');
  clearTimeout(temporizadorCarta);
  el.textContent = texto || '';
  el.style.color = error ? 'var(--alerta)' : 'var(--verde)';
  if (texto && !error) temporizadorCarta = setTimeout(() => { el.textContent = ''; }, 8000);
}

// Pide el PDF al servidor. Devuelve { blob, nombre }.
async function pedirCarta(d, fecha) {
  const r = await fetch('/api/carta', { method: 'POST', body: JSON.stringify({ clave: d.clave, fecha }) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || 'No se pudo generar la carta.');
  const nombre = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'Carta_solicitud.pdf';
  return { blob: await r.blob(), nombre };
}

function liberarVistaCarta() {
  if (cartaActual && cartaActual.url) URL.revokeObjectURL(cartaActual.url);
  if (cartaActual) cartaActual.url = null;
}

// (Re)genera la vista previa: es el mismo PDF que luego se descarga, así que lo que se ve es lo que se envía.
async function cargarVistaCarta() {
  if (!cartaActual) return;
  const actual = cartaActual;
  estadoCarta('Generando la carta…');
  try {
    const { blob, nombre } = await pedirCarta(actual.d, $('cartaFecha').checked);
    if (cartaActual !== actual) return; // se cerró la ventana mientras se generaba
    liberarVistaCarta();
    actual.url = URL.createObjectURL(blob);
    actual.nombre = nombre;
    $('vistaCarta').src = actual.url + '#toolbar=0&navpanes=0';
    $('cartaNuevaPestana').href = actual.url;
    estadoCarta('');
  } catch (e) {
    estadoCarta(e.message, true);
  }
}

// Si hay Thunderbird, ese botón es el principal (abre el correo con la carta ya adjunta);
// el de correo genérico queda como alternativa, que descarga la carta para adjuntarla a mano.
function configurarBotonesCorreo() {
  const c = cartaActual;
  if (!c) return;
  const hayCorreo = !!c.correo.destinatario, conThunderbird = hayCorreo && c.thunderbird && !c.conEnlace;
  $('abrirGmail').hidden = !(hayCorreo && c.conEnlace);
  $('abrirThunderbird').hidden = !conThunderbird;
  const generico = $('abrirCartaCorreo');
  generico.hidden = !hayCorreo || c.conEnlace;
  generico.classList.toggle('sec', conThunderbird);
  generico.textContent = conThunderbird ? 'Abrir en otro correo (descarga la carta)' : '✉ Abrir en mi correo y descargar la carta';
  configurarRegistroEnvio();
}

// Registro de que la carta se envió. La app no puede ver si el correo salió, pero sí cuándo se abre desde aquí:
// en ese momento anota el paso "Carta enviada" con la fecha de hoy. Si ya estaba anotado, no cambia la fecha.
function configurarRegistroEnvio() {
  const c = cartaActual;
  if (!c) return;
  const e = c.d.pasos && c.d.pasos.cartaEnviada;
  $('deshacerCartaEnviada').hidden = !e;
  $('cartaRegistroAyuda').hidden = !!e;
  $('cartaYaEnviada').hidden = !e;
  if (e) $('cartaYaEnviada').textContent = `✓ Carta anotada como enviada el ${fechaCL(e.fecha)}.`;
}

// Devuelve true si el paso quedó anotado (ahora o antes).
async function anotarEnvio() {
  const actual = cartaActual;
  if (!actual) return false;
  if (!actual.d.pasos.cartaEnviada) {
    const r = await guardarPaso('cartaEnviada', true, { fecha: hoyLocalISO(), nota: 'correo abierto desde la app' });
    if (!r) return false;
    if (cartaActual !== actual) return true;
    actual.d = datos.find(x => x.fila === seleccion) || actual.d; // la ficha se volvió a dibujar con los datos nuevos
  }
  configurarRegistroEnvio();
  return true;
}

async function deshacerEnvio() {
  const actual = cartaActual;
  if (!actual) return;
  $('deshacerCartaEnviada').disabled = true;
  const r = await guardarPaso('cartaEnviada', false);
  $('deshacerCartaEnviada').disabled = false;
  if (!r || cartaActual !== actual) return;
  actual.d = datos.find(x => x.fila === seleccion) || actual.d;
  configurarRegistroEnvio();
  estadoCarta('Se quitó la marca de "Carta enviada" de la ficha.');
}

function abrirModalCarta() {
  const d = datos.find(x => x.fila === seleccion);
  if (!d) return;
  const correo = construirCorreoCarta(d, undefined, subidaDisponible);
  const actual = cartaActual = { d, correo, url: null, nombre: null, thunderbird: false, enlace: null, textoInicial: correo.cuerpo, conEnlace: subidaDisponible };
  $('cartaEnlaceFila').hidden = !subidaDisponible;
  $('cartaConEnlace').checked = true;
  $('cartaAvisos').innerHTML = avisosCarta(d);
  $('cartaPara').textContent = correo.destinatario || '—';
  $('cartaAsunto').textContent = correo.asunto;
  $('cartaCuerpo').value = correo.cuerpo;
  $('cartaSinCorreo').hidden = !correo.correoInvalido;
  configurarBotonesCorreo();
  $('cartaFecha').checked = false;
  estadoCarta('');
  $('vistaCarta').src = 'about:blank';
  $('modalCarta').hidden = false;
  $('abrirCartaCorreo').hidden ? $('descargarCartaPdf').focus() : $('abrirCartaCorreo').focus();
  cargarVistaCarta();
  fetch('/api/correo/info').then(r => r.json()).then(i => {
    if (cartaActual !== actual) return;
    actual.thunderbird = !!i.thunderbird;
    configurarBotonesCorreo();
    if (actual.thunderbird && !$('abrirThunderbird').hidden) $('abrirThunderbird').focus();
  }).catch(() => { /* sin Thunderbird detectado: queda la opción genérica */ });
}

// Si el texto lleva la marca del enlace, crea el enlace de subida (una sola vez por ventana) y la reemplaza.
// Devuelve el texto final, o null si no se pudo crear el enlace.
async function cuerpoFinal() {
  const actual = cartaActual;
  const texto = $('cartaCuerpo').value;
  if (!texto.includes(MARCA_ENLACE)) return texto;
  if (!actual.enlace) {
    const r = await post('/api/enlace', { clave: actual.d.clave, fecha: $('cartaFecha').checked });
    if (r.error) { estadoCarta('No se pudo crear el enlace de subida: ' + r.error, true); return null; }
    actual.enlace = r;
    enlaceNuevo = { clave: actual.d.clave, url: r.url, vence: r.vence_en };
    const d = fichaActual();
    if (d && d.clave === actual.d.clave) cargarDocumentos(d);
  }
  return texto.split(MARCA_ENLACE).join(actual.enlace.url);
}

// Abre Gmail (web) con el mensaje ya escrito. La ventana se abre al instante, dentro del clic, para que el navegador
// no la bloquee, y se completa cuando el enlace de subida está creado.
async function abrirEnGmail() {
  const actual = cartaActual;
  if (!actual) return;
  const ventana = window.open('', '_blank');
  if (ventana) ventana.opener = null;
  estadoCarta('Preparando el correo…');
  const cuerpo = await cuerpoFinal();
  if (cuerpo === null || cartaActual !== actual) { if (ventana) ventana.close(); return; }
  if (!ventana) return estadoCarta('El navegador bloqueó la ventana nueva. Permite las ventanas emergentes para esta página e inténtalo de nuevo.', true);
  ventana.location.href = urlGmail({ destinatario: actual.correo.destinatario, asunto: actual.correo.asunto, cuerpo, cuenta: correoEnvio });
  const recordar = cuerpo.includes('[Nombre de quien envía]') ? ' Recuerda reemplazar [Nombre de quien envía] en la firma.' : '';
  const anotada = await anotarEnvio();
  estadoCarta('✓ Se abrió Gmail en otra pestaña con el mensaje listo, para ' + actual.correo.destinatario + '. Revisa y pulsa Enviar' + (correoEnvio ? ' (sale desde ' + correoEnvio + '; si Gmail pide ingresar a esa cuenta, hazlo una vez y quedará abierta).' : ' (Gmail usa la cuenta que tengas abierta en el navegador).') + (anotada ? ' Quedó anotado como enviado en la ficha.' : '') + recordar);
}

// Pide al servidor que abra Thunderbird con el correo y la carta adjunta. No envía nada.
async function abrirEnThunderbird() {
  const actual = cartaActual;
  if (!actual) return;
  const boton = $('abrirThunderbird');
  boton.disabled = true;
  setTimeout(() => { boton.disabled = false; }, 4000); // evita abrir dos ventanas por un doble clic
  estadoCarta('Preparando el correo…');
  const cuerpo = await cuerpoFinal();
  if (cuerpo === null || cartaActual !== actual) return;
  const recordar = cuerpo.includes('[Nombre de quien envía]') ? ' Recuerda reemplazar [Nombre de quien envía] en la firma.' : '';
  estadoCarta('Abriendo Thunderbird…');
  try {
    const r = await fetch('/api/carta/correo', {
      method: 'POST',
      body: JSON.stringify({ clave: actual.d.clave, fecha: $('cartaFecha').checked, asunto: actual.correo.asunto, cuerpo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.sinThunderbird && cartaActual === actual) { actual.thunderbird = false; configurarBotonesCorreo(); }
      return estadoCarta((j.error || 'No se pudo abrir Thunderbird.') + (j.sinThunderbird ? ' Usa la otra opción.' : ''), true);
    }
    const anotada = await anotarEnvio();
    estadoCarta(`✓ Se abrió Thunderbird con la carta adjunta, para ${j.para}. Revisa el mensaje y pulsa Enviar.${anotada ? ' La carta quedó anotada como enviada en la ficha.' : ''}${recordar}`);
  } catch (e) {
    estadoCarta('No se pudo abrir Thunderbird: ' + e.message, true);
  }
}

function cerrarModalCarta() {
  liberarVistaCarta();
  $('vistaCarta').src = 'about:blank';
  $('modalCarta').hidden = true;
  cartaActual = null;
}

function descargarPdfActual() {
  if (!cartaActual || !cartaActual.url) { estadoCarta('La carta aún se está generando: espera un momento.', true); return false; }
  const a = document.createElement('a');
  a.href = cartaActual.url; a.download = cartaActual.nombre; a.click();
  return true;
}

// ---- Mensaje para la postulante (la app lo prepara; lo envía una persona) ----
function bloqueMensaje(d) {
  const m = construirMensaje(d);
  if (!m.hayPuntos) {
    return m.correoInvalido
      ? `<p class="sub" style="margin:8px 0 0">El correo registrado no es válido: hay que contactar a esta persona por teléfono${d.telefono ? ' (' + esc(d.telefono) + ')' : ''}.</p>`
      : '';
  }
  return '<div style="margin-top:10px"><button class="sec btn-peq" id="prepararMensaje">✉ Preparar mensaje para la postulante</button></div>';
}

// El mensaje se muestra en una ventana emergente, para no tener que desplazar la ficha.
let mensajeActual = null;
let temporizadorEstado;
function estadoModal(texto, error) {
  const el = $('modalEstado');
  clearTimeout(temporizadorEstado);
  el.textContent = texto || '';
  el.style.color = error ? 'var(--alerta)' : 'var(--verde)';
  if (texto && !error) temporizadorEstado = setTimeout(() => { el.textContent = ''; }, 6000);
}
function abrirModalMensaje() {
  const d = datos.find(x => x.fila === seleccion);
  if (!d) return;
  const base = construirMensaje(d);
  const conEnlace = subidaDisponible && base.hayPuntos; // el enlace solo sirve si hay algo que la persona pueda corregir
  mensajeActual = conEnlace ? construirMensaje(d, true) : base;
  mensajeActual.conEnlace = conEnlace; mensajeActual.enlace = null; mensajeActual.textoInicial = mensajeActual.cuerpo; mensajeActual.d = d;
  $('msgEnlaceFila').hidden = !conEnlace;
  $('msgConEnlace').checked = conEnlace;
  $('abrirGmailMsg').hidden = !base.destinatario;
  $('msgPara').textContent = mensajeActual.destinatario || '—';
  $('msgAsunto').textContent = mensajeActual.asunto;
  $('msgCuerpo').value = mensajeActual.cuerpo;
  $('modalAviso').hidden = !mensajeActual.correoInvalido;
  $('abrirCorreo').hidden = !mensajeActual.destinatario;
  estadoModal('');
  $('modalMensaje').hidden = false;
  $('copiarMensaje').focus();
}
function cerrarModalMensaje() {
  $('modalMensaje').hidden = true;
  mensajeActual = null;
}

async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch {
    const t = document.createElement('textarea');
    t.value = texto; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

function cerrarFicha() {
  seleccion = null;
  editando = false;
  $('ficha').classList.remove('abierta');
  $('ficha').setAttribute('aria-hidden', 'true');
  pintar();
}

const camposModificados = () =>
  [...document.querySelectorAll('#ficha [data-campo]')].filter(el => el.value !== el.dataset.ini);

// Si hay cambios sin guardar, pide confirmación antes de salir de la ficha.
function puedeSalir() {
  return !editando || !camposModificados().length || confirm('Hay cambios sin guardar. ¿Descartarlos?');
}

async function guardarEdicion() {
  const d = datos.find(x => x.fila === seleccion);
  const cambios = {};
  camposModificados().forEach(el => { cambios[el.dataset.campo] = el.value; });
  if (!Object.keys(cambios).length) return abrirFicha(seleccion);
  const r = await post('/api/editar', { clave: d.clave, cambios });
  if (r.error) return mostrar(r.error, true);
  cargar(r, true);
  mostrar('Cambios guardados. La planilla de Google no se modificó.');
}

async function deshacerEdiciones() {
  const d = datos.find(x => x.fila === seleccion);
  if (!confirm('¿Volver a los datos originales de la planilla para esta persona?')) return;
  const r = await post('/api/restaurar', { clave: d.clave });
  if (r.error) return mostrar(r.error, true);
  cargar(r, true);
  mostrar('Se restauraron los datos de la planilla.');
}

$('filas').addEventListener('click', e => {
  const b = e.target.closest('[data-fila]');
  if (b && puedeSalir()) abrirFicha(Number(b.dataset.fila));
});
$('ficha').addEventListener('click', e => {
  const on = id => e.target.closest('#' + id);
  if (on('cerrarFicha')) { if (puedeSalir()) cerrarFicha(); return; }
  if (on('editarFicha')) return abrirFicha(seleccion, true);
  if (on('cancelarEd')) { if (puedeSalir()) abrirFicha(seleccion); return; }
  if (on('guardarEd')) return guardarEdicion();
  if (on('restaurarEd')) return deshacerEdiciones();
  if (on('prepararMensaje')) return abrirModalMensaje();
  if (on('verCarta')) return abrirModalCarta();
  if (on('crearEnlace')) return crearEnlaceSubida();
  const ver = e.target.closest('[data-ver-doc]');
  if (ver) return verDocumento(ver.dataset.verDoc, ver.closest('.hist-fila').querySelector('b').textContent);
  if (on('copiarEnlace')) return copiarEnlace(false);
  if (on('copiarMensajeEnlace')) return copiarEnlace(true);
  const borrar = e.target.closest('[data-borrar-carnet]');
  if (borrar) return borrarCarnet(borrar.dataset.borrarCarnet);
  const ir = e.target.closest('[data-ir]');
  if (ir && puedeSalir()) abrirFicha(Number(ir.dataset.ir));
});

// Los pasos se guardan al instante: al marcar, al cambiar la fecha y al terminar de escribir la nota.
$('ficha').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.paso) return guardarPaso(t.dataset.paso, t.checked);
  if (t.dataset.pasoFecha) {
    if (!t.value) return abrirFicha(seleccion, false, true); // fecha vacía: se deja la anterior
    return guardarPaso(t.dataset.pasoFecha, true, { fecha: t.value });
  }
  if (t.dataset.pasoNota !== undefined) return guardarPaso(t.dataset.pasoNota, true, { nota: t.value });
});

$('modalMensaje').addEventListener('click', e => {
  const on = id => e.target.closest('#' + id);
  if (e.target === $('modalMensaje') || on('cerrarModal')) return cerrarModalMensaje();
  if (!mensajeActual) return;
  const recordarDe = cuerpo => cuerpo.includes('[Nombre de quien envía]') ? ' Recuerda reemplazar [Nombre de quien envía] antes de enviarlo.' : '';
  if (on('copiarAsunto')) {
    return copiarTexto(mensajeActual.asunto).then(ok => ok ? estadoModal('✓ Asunto copiado.') : estadoModal('No se pudo copiar automáticamente. El asunto es: ' + mensajeActual.asunto, true));
  }
  if (on('abrirGmailMsg')) {
    // La ventana se abre al instante (dentro del clic) para que el navegador no la bloquee; se completa al tener el enlace.
    const actual = mensajeActual;
    const ventana = window.open('', '_blank');
    if (ventana) ventana.opener = null;
    return cuerpoFinalMensaje().then(cuerpo => {
      if (cuerpo === null || mensajeActual !== actual) { if (ventana) ventana.close(); return; }
      if (!ventana) return estadoModal('El navegador bloqueó la ventana nueva. Permite las ventanas emergentes para esta página e inténtalo de nuevo.', true);
      ventana.location.href = urlGmail({ destinatario: actual.destinatario, asunto: actual.asunto, cuerpo, cuenta: correoEnvio });
      estadoModal('✓ Se abrió Gmail en otra pestaña' + (correoEnvio ? ' (sale desde ' + correoEnvio + ')' : '') + '. Revisa y pulsa Enviar.' + recordarDe(cuerpo));
    });
  }
  if (on('abrirCorreo')) {
    return cuerpoFinalMensaje().then(cuerpo => {
      if (cuerpo === null) return;
      location.href = `mailto:${mensajeActual.destinatario}?subject=${encodeURIComponent(mensajeActual.asunto)}&body=${encodeURIComponent(cuerpo)}`;
      estadoModal('Se abrió tu programa de correo con el mensaje.' + recordarDe(cuerpo));
    });
  }
  if (on('copiarMensaje')) {
    return cuerpoFinalMensaje().then(cuerpo => {
      if (cuerpo === null) return;
      if (cuerpo !== $('msgCuerpo').value) $('msgCuerpo').value = cuerpo; // se ve el enlace ya puesto
      return copiarTexto(cuerpo).then(ok => {
        if (ok) return estadoModal('✓ Mensaje copiado.' + recordarDe(cuerpo));
        // Plan B: dejar el texto seleccionado para que baste con presionar Ctrl+C
        $('msgCuerpo').focus(); $('msgCuerpo').select();
        estadoModal('No se pudo copiar automáticamente. El texto quedó seleccionado: presiona Ctrl+C.', true);
      });
    });
  }
});

// Si el texto lleva la marca del enlace, crea el enlace de corrección (una sola vez por ventana) y la reemplaza.
// Devuelve el texto final, o null si no se pudo crear.
async function cuerpoFinalMensaje() {
  const m = mensajeActual;
  const texto = $('msgCuerpo').value;
  if (!texto.includes(MARCA_ENLACE_DATOS)) return texto;
  if (!m.enlace) {
    const r = await post('/api/enlace-datos', { clave: m.d.clave });
    if (r.error) { estadoModal('No se pudo crear el enlace: ' + r.error, true); return null; }
    m.enlace = r;
  }
  return texto.split(MARCA_ENLACE_DATOS).join(m.enlace.url);
}
$('msgConEnlace').addEventListener('change', () => {
  const m = mensajeActual;
  if (!m) return;
  if ($('msgCuerpo').value !== m.textoInicial) { // el texto se editó a mano: no se pisa
    estadoModal('Editaste el texto: agrega o quita a mano la línea ' + MARCA_ENLACE_DATOS + ' donde quieras el enlace.');
    $('msgConEnlace').checked = $('msgCuerpo').value.includes(MARCA_ENLACE_DATOS);
    return;
  }
  const nuevo = construirMensaje(m.d, $('msgConEnlace').checked);
  m.textoInicial = nuevo.cuerpo; m.conEnlace = $('msgConEnlace').checked;
  $('msgCuerpo').value = nuevo.cuerpo;
  estadoModal('');
});

$('modalCarta').addEventListener('click', e => {
  const on = id => e.target.closest('#' + id);
  if (e.target === $('modalCarta') || on('cerrarCarta')) return cerrarModalCarta();
  if (!cartaActual) return;
  const cuerpo = $('cartaCuerpo').value;
  const recordar = cuerpo.includes('[Nombre de quien envía]') ? ' Recuerda reemplazar [Nombre de quien envía] en la firma.' : '';
  if (on('descargarCartaPdf')) { if (descargarPdfActual()) estadoCarta(`✓ Descargada: ${cartaActual.nombre}`); return; }
  if (on('copiarCartaAsunto')) {
    return copiarTexto(cartaActual.correo.asunto).then(ok => ok ? estadoCarta('✓ Asunto copiado.') : estadoCarta('No se pudo copiar automáticamente. El asunto es: ' + cartaActual.correo.asunto, true));
  }
  if (on('copiarCartaMensaje')) {
    return cuerpoFinal().then(final => {
      if (final === null) return;
      if (final !== $('cartaCuerpo').value) $('cartaCuerpo').value = final; // se ve el enlace ya puesto
      return copiarTexto(final).then(ok => {
        if (ok) return estadoCarta('✓ Mensaje copiado.' + recordar);
        $('cartaCuerpo').focus(); $('cartaCuerpo').select();
        estadoCarta('No se pudo copiar automáticamente. El texto quedó seleccionado: presiona Ctrl+C.', true);
      });
    });
  }
  if (on('abrirGmail')) return abrirEnGmail();
  if (on('abrirThunderbird')) return abrirEnThunderbird();
  if (on('deshacerCartaEnviada')) return deshacerEnvio();
  if (on('abrirCartaCorreo')) {
    // Se descarga primero la carta (para que esté lista para adjuntar) y luego se abre el programa de correo.
    if (!descargarPdfActual()) return;
    const { destinatario, asunto } = cartaActual.correo;
    const nombre = cartaActual.nombre;
    const actual = cartaActual;
    return cuerpoFinal().then(cuerpo => {
      if (cuerpo === null || cartaActual !== actual) return;
      const recordar = cuerpo.includes('[Nombre de quien envía]') ? ' Recuerda reemplazar [Nombre de quien envía] en la firma.' : '';
      location.href = `mailto:${destinatario}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
      return anotarEnvio().then(anotada => estadoCarta(`Se abrió tu correo y se descargó ${nombre}: adjúntala al mensaje antes de enviarlo.${anotada ? ' La carta quedó anotada como enviada en la ficha.' : ''}${recordar}`));
    });
  }
});
$('cartaFecha').addEventListener('change', cargarVistaCarta);
$('cartaConEnlace').addEventListener('change', () => {
  const c = cartaActual;
  if (!c) return;
  if ($('cartaCuerpo').value !== c.textoInicial) { // el texto se editó a mano: no se pisa
    estadoCarta('Editaste el texto: agrega o quita a mano la línea ' + MARCA_ENLACE + ' donde quieras el enlace.');
    $('cartaConEnlace').checked = $('cartaCuerpo').value.includes(MARCA_ENLACE);
    return;
  }
  c.conEnlace = $('cartaConEnlace').checked;
  c.correo = construirCorreoCarta(c.d, undefined, c.conEnlace);
  c.textoInicial = c.correo.cuerpo;
  $('cartaCuerpo').value = c.correo.cuerpo;
  configurarBotonesCorreo();
  estadoCarta('');
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('modalDoc').hidden) return cerrarDocumento();
  if (!$('modalCarta').hidden) return cerrarModalCarta();
  if (!$('modalMensaje').hidden) return cerrarModalMensaje();
  if (!$('menuAjustes').hidden) { cerrarMenu(); $('btnMenu').focus(); return; }
  if (hayPanelAbierto()) return cerrarPaneles();
  if (seleccion === null || !puedeSalir()) return;
  if (editando) abrirFicha(seleccion); else cerrarFicha();
});

['buscar', 'filtro', 'region', 'etapa', 'periodo'].forEach(id => $(id).addEventListener('input', pintar));

// Orden por columna. Cada clic en el mismo encabezado recorre: primera dirección -> la opuesta -> sin orden.
// La fecha parte con las más recientes arriba; el nombre, de la A a la Z.
$('encabezadoTabla').addEventListener('click', e => {
  const b = e.target.closest('.orden');
  if (!b) return;
  const campo = b.dataset.orden, primera = campo === 'postulacion' ? -1 : 1;
  if (orden.campo !== campo) orden = { campo, dir: primera };
  else if (orden.dir === primera) orden = { campo, dir: -primera };
  else orden = { campo: null, dir: 0 };
  pintar();
});

// ---- Mensajes, configuración y actualización ----
// Los avisos se cierran solos (5 s los de éxito, 12 s los de error) o con un clic.
let temporizadorMensaje;
function mostrar(texto, error) {
  const m = $('mensaje');
  clearTimeout(temporizadorMensaje);
  m.hidden = !texto; m.textContent = texto || '';
  m.title = 'Clic para cerrar';
  m.style.cursor = 'pointer';
  m.style.background = error ? 'var(--alerta-bg)' : 'var(--ok-bg)';
  m.style.borderColor = error ? 'var(--alerta)' : 'var(--verde)';
  if (texto) temporizadorMensaje = setTimeout(() => { m.hidden = true; }, error ? 12000 : 5000);
}
$('mensaje').addEventListener('click', () => mostrar(''));

async function post(url, cuerpo) {
  let r;
  try { r = await fetch(url, { method: 'POST', body: JSON.stringify(cuerpo || {}), signal: AbortSignal.timeout(120000) }); }
  catch { return { error: 'No se pudo hablar con la aplicación (se cortó o tardó demasiado). Revisa que la ventana negra siga abierta e inténtalo de nuevo.' }; }
  try { return await r.json(); }
  catch { return { error: 'La aplicación respondió algo inesperado (código ' + r.status + '). Lo más probable es que haya que cerrar la ventana negra y abrir de nuevo Iniciar AMAGRO.bat para que tome la versión nueva.' }; }
}

// Solo un panel abierto a la vez; se cierran al terminar la tarea, al abrir el otro o con Esc.
const PANELES = ['panelConfig', 'panelRespaldo', 'panelHistorial', 'panelSocias', 'panelCorrecciones', 'panelUsuarias'];
const cerrarPaneles = () => PANELES.forEach(id => { $(id).hidden = true; });
const hayPanelAbierto = () => PANELES.some(id => !$(id).hidden);
function alternarPanel(id) {
  const abrir = $(id).hidden;
  cerrarPaneles();
  $(id).hidden = !abrir;
  return abrir;
}

$('configurar').addEventListener('click', () => alternarPanel('panelConfig'));

$('guardarUrl').addEventListener('click', async () => {
  const r = await post('/api/config', { hojaUrl: $('hojaUrl').value });
  if (r.error) return mostrar(r.error, true);
  cerrarPaneles();
  mostrar('Enlace guardado. Pulsa "Actualizar".');
});

$('actualizar').addEventListener('click', async () => {
  const b = $('actualizar'); b.disabled = true; b.textContent = 'Actualizando…';
  try {
    const r = await post('/api/actualizar');
    if (r.error) {
      mostrar(r.error, true);
      if (r.error.includes('configura')) { cerrarPaneles(); $('panelConfig').hidden = false; }
    } else {
      cerrarPaneles();
      cargar(r);
      mostrar(r.primera ? `Planilla cargada: ${r.total} postulaciones.`
        : r.nuevos ? `${r.nuevos} postulación(es) nueva(s). Total: ${r.total}.` : `Sin cambios. Total: ${r.total}.`);
    }
  } catch (e) { mostrar('No se pudo actualizar: ' + e.message, true); }
  b.disabled = false; b.textContent = '↻ Actualizar';
});

$('subirCsv').addEventListener('click', () => $('archivo').click());

// ---- Menú del engranaje ----
// Se cierra al elegir una opción, al hacer clic fuera o con Esc.
function cerrarMenu() {
  $('menuAjustes').hidden = true;
  $('btnMenu').setAttribute('aria-expanded', 'false');
}
$('btnMenu').addEventListener('click', e => {
  e.stopPropagation();
  const abrir = $('menuAjustes').hidden;
  $('menuAjustes').hidden = !abrir;
  $('btnMenu').setAttribute('aria-expanded', String(abrir));
  if (abrir) $('menuAjustes').querySelector('.item').focus();
});
$('menuAjustes').addEventListener('click', e => { if (e.target.closest('.item')) cerrarMenu(); });
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) cerrarMenu(); });

// ---- Respaldo de correcciones ----
async function cargarInfoRespaldo() {
  try {
    const i = await (await fetch('/api/respaldo/info')).json();
    const bajado = i.ultimoRespaldo ? new Date(i.ultimoRespaldo).toLocaleString('es-CL') : 'nunca';
    $('respaldoInfo').textContent = `${i.correcciones} postulación(es) con correcciones o pasos registrados · último respaldo descargado en este computador: ${bajado}`;
    $('subirRespaldoLabel').hidden = !i.puedeRestaurar;
  } catch { $('respaldoInfo').textContent = 'No se pudo leer el estado del respaldo.'; }
}

// Recordatorio: aparece si hay correcciones sin respaldar desde hace 7 días o más.
// "Recordar más tarde" lo oculta hasta que se vuelva a abrir la página.
let avisoPospuesto = false;
function mostrarAvisoRespaldo(aviso) {
  const caja = $('avisoRespaldo');
  if (!aviso || avisoPospuesto) { caja.hidden = true; return; }
  const n = aviso.pendientes;
  $('avisoRespaldoTexto').textContent = aviso.nunca
    ? `Tienes ${n} postulación(es) con correcciones y nunca has descargado un respaldo (la primera tiene ${aviso.dias} días).`
    : `Hace ${aviso.dias} días que no descargas un respaldo, y tienes ${n} postulación(es) con cambios desde entonces.`;
  caja.hidden = false;
}
async function revisarAvisoRespaldo() {
  try { mostrarAvisoRespaldo((await (await fetch('/api/respaldo/info')).json()).aviso); }
  catch { /* sin aviso si no se puede consultar */ }
}

async function descargarRespaldo() {
  const r = await fetch('/api/respaldo');
  if (!r.ok) { const j = await r.json().catch(() => ({})); return mostrar(j.error || 'No se pudo descargar el respaldo.', true); }
  const nombre = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'amagro-correcciones.json';
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  cerrarPaneles();
  $('avisoRespaldo').hidden = true;
  mostrar('Respaldo descargado. Guárdalo en un lugar seguro (pendrive o Drive).');
  setTimeout(revisarAvisoRespaldo, 1000); // la aplicación anota la descarga; se vuelve a consultar
}

$('respaldo').addEventListener('click', () => {
  if (alternarPanel('panelRespaldo')) cargarInfoRespaldo();
});
$('bajarRespaldo').addEventListener('click', descargarRespaldo);
$('avisoDescargar').addEventListener('click', descargarRespaldo);
$('avisoPosponer').addEventListener('click', () => { avisoPospuesto = true; $('avisoRespaldo').hidden = true; });

$('subirRespaldoLabel').addEventListener('click', () => $('archivoRespaldo').click());

$('archivoRespaldo').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!confirm('Esto reemplaza TODAS las correcciones actuales por las del archivo. Esto cambia los datos de TODAS las usuarias. Antes se guarda en este computador una copia de las actuales. ¿Continuar?')) return;
  const r = await fetch('/api/respaldo/restaurar', { method: 'POST', body: await f.text() }).then(x => x.json());
  if (r.error) return mostrar(r.error, true);
  cerrarPaneles();
  cargar(r, true);
  mostrar(`Respaldo restaurado: ${r.restauradas} postulación(es) con correcciones.`);
});

$('archivo').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const r = await fetch('/api/procesar', { method: 'POST', body: await f.text() });
  cargar(await r.json());
});

$('exportar').addEventListener('click', () => {
  const cols = ['fila','marca','postulacion','nombre','rut','nacimiento','edad','telefono','correo','region','comuna','direccion','profesion','situacion','empresa','origen','etapa','gestion','resultado','modalidad','ingreso','citacion','asistencia','motivacion','observaciones'];
  // Separador ";" porque Excel en español (Chile) separa las columnas con punto y coma;
  // con coma abre todo apilado en la columna A.
  const SEP = ';';
  // Una columna por paso de admisión, con la fecha en que se hizo (vacía si está pendiente), y la nota si la hay.
  const columnasPasos = pasosDef.flatMap(p => ['paso_' + p.id, 'nota_' + p.id]);
  const valoresPasos = d => pasosDef.flatMap(p => { const e = d.pasos[p.id]; return [e ? e.fecha : '', e ? e.nota : '']; });
  const filas = [[...cols, ...columnasPasos, 'cargos', 'alertas'].map(celdaCsv),
    ...datos.map(d => [...cols.map(c => d[c]), ...valoresPasos(d), d.cargos.join(' | '), d.alertas.join(' | ')].map(celdaCsv))];
  const csv = filas.map(f => f.join(SEP)).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'postulaciones_limpias.csv'; a.click();
});

// Entre comillas, y con un apóstrofe delante si el texto empieza como una fórmula (= @ + -),
// porque estos datos vienen de un formulario público y Excel ejecutaría la fórmula al abrirlo.
// Los teléfonos ("+56 9 …") y números negativos simples no se tocan.
function celdaCsv(v) {
  let s = String(v ?? '');
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s]+$/.test(s))) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// ---- Documentos: enlace de subida, carta firmada y carnet ----
const TIPO_DOC = { carta_firmada: 'Carta firmada', carnet: 'Copia de carnet' };
let enlaceNuevo = null; // { clave, url, vence }: el código solo se ve al crearlo
const fechaHoraCL = iso => new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
const mbDoc = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const fichaActual = () => datos.find(x => x.fila === seleccion);

async function cargarDocumentos(d) {
  const caja = $('docsFicha');
  if (!caja) return;
  try {
    const r = await fetch('/api/documentos?clave=' + encodeURIComponent(d.clave));
    const j = await r.json();
    const actual = fichaActual();
    if (!$('docsFicha') || !actual || actual.clave !== d.clave) return; // se cambió de ficha mientras cargaba
    if (j.error) { $('docsFicha').textContent = j.error; return; }
    $('docsFicha').className = '';
    $('docsFicha').innerHTML = pintarDocumentos(d, j);
  } catch { if ($('docsFicha')) $('docsFicha').textContent = 'No se pudieron cargar los documentos.'; }
}

function pintarDocumentos(d, { documentos, paginaSubida }) {
  const filas = documentos.map(x => {
    const borrado = x.borrado_en;
    const acciones = borrado
      ? `<span class="sub">borrado el ${esc(fechaHoraCL(x.borrado_en))}</span>`
      : `<button class="enlace" data-ver-doc="${esc(x.id)}">Ver</button>${x.tipo === 'carnet' ? ` · <button class="sec btn-peq" data-borrar-carnet="${esc(x.id)}" title="Se borra la copia del carnet y se marca la identidad como verificada">Identidad verificada: borrar carnet</button>` : ''}`;
    return `<div class="hist-fila"><b>${esc(TIPO_DOC[x.tipo] || x.tipo)}</b> · recibido el ${esc(fechaHoraCL(x.subido_en))} · ${esc(mbDoc(x.bytes))}<br>${acciones}</div>`;
  }).join('');
  const hayEnlace = enlaceNuevo && enlaceNuevo.clave === d.clave;
  const caja = hayEnlace ? `<div class="aviso" style="margin:8px 0 0">
      <b>Enlace listo</b> (sirve una sola vez y vence el ${esc(fechaCL(enlaceNuevo.vence.slice(0, 10)))}). Cópialo ahora: no se puede volver a ver.
      <input type="text" readonly value="${esc(enlaceNuevo.url)}" style="width:100%;margin:6px 0">
      <button class="btn-peq" id="copiarEnlace">Copiar enlace</button>
      <button class="sec btn-peq" id="copiarMensajeEnlace">Copiar mensaje con el enlace</button></div>` : '';
  const crear = paginaSubida
    ? `<button class="sec btn-peq" id="crearEnlace">🔗 ${documentos.length || hayEnlace ? 'Crear otro enlace de subida' : 'Crear enlace de subida sin enviar la carta'}</button>
       <p class="sub" style="margin:6px 0 0">La postulante sube su carta firmada y la copia de su carnet desde ese enlace. Uno nuevo deja sin efecto el anterior.</p>`
    : '<p class="sub">Falta configurar la dirección de la página de subida para poder crear enlaces.</p>';
  const pista = d.pendienteRevision ? '<p class="seguimiento" style="background:#e8f1fb;color:#0b57a4">📎 Estos documentos esperan revisión. Cuando los revises, marca el paso «Revisada por secretaría».</p>' : '';
  return pista + (filas || '<p class="sub" style="margin:0 0 8px">Todavía no ha subido documentos.</p>') + crear + caja;
}

// Descarga el documento con la sesión de la persona y lo muestra aquí mismo, en una ventana de la página
// (sin abrir pestañas nuevas, que el navegador podría bloquear).
let urlDocumento = null;
async function verDocumento(id, titulo) {
  const r = await fetch('/api/documento/ver?id=' + encodeURIComponent(id));
  if (!r.ok) { const j = await r.json().catch(() => ({})); return mostrar(j.error || 'No se pudo abrir el documento.', true); }
  const tipo = (r.headers.get('content-type') || '').split(';')[0];
  cerrarDocumento();
  urlDocumento = URL.createObjectURL(new Blob([await r.blob()], { type: tipo }));
  const esPdf = tipo === 'application/pdf';
  $('docMarco').hidden = !esPdf; $('docImagen').hidden = esPdf;
  if (esPdf) $('docMarco').src = urlDocumento; else $('docImagen').src = urlDocumento;
  $('docTitulo').textContent = titulo || 'Documento recibido';
  $('modalDoc').hidden = false;
  $('cerrarDoc').focus();
}
function cerrarDocumento() {
  $('modalDoc').hidden = true;
  $('docMarco').src = 'about:blank'; $('docImagen').removeAttribute('src');
  if (urlDocumento) { URL.revokeObjectURL(urlDocumento); urlDocumento = null; }
}
$('modalDoc').addEventListener('click', e => { if (e.target === $('modalDoc') || e.target.closest('#cerrarDoc')) cerrarDocumento(); });

async function crearEnlaceSubida() {
  const d = fichaActual();
  if (!d) return;
  if (!d.correo) mostrar('Esta persona no tiene correo en la ficha: tendrás que hacerle llegar el enlace por otro medio.');
  const r = await post('/api/enlace', { clave: d.clave });
  if (r.error) return mostrar(r.error, true);
  enlaceNuevo = { clave: d.clave, url: r.url, vence: r.vence_en };
  cargarDocumentos(d);
}

async function copiarEnlace(conMensaje) {
  if (!enlaceNuevo) return;
  const d = fichaActual();
  const nombre = d ? String(d.nombre || '').trim().split(/\s+/)[0] : '';
  const primer = nombre ? nombre[0].toUpperCase() + nombre.slice(1).toLowerCase() : 'postulante';
  const texto = conMensaje
    ? `Hola ${primer},\n\nGracias por postular a AMAGRO AG. Para continuar necesitamos tu carta de solicitud firmada y una copia de tu carnet de identidad (por ambos lados). Puedes subirlos desde el computador o el celular en este enlace:\n\n${enlaceNuevo.url}\n\nEl enlace sirve una sola vez y vence el ${fechaCL(enlaceNuevo.vence.slice(0, 10))}. Revisamos tu carnet solo para verificar tu identidad y después lo borramos.\n\nSaludos,\n[Nombre de quien envía]\nAMAGRO AG`
    : enlaceNuevo.url;
  const ok = await copiarTexto(texto);
  mostrar(ok ? (conMensaje ? 'Mensaje copiado. Recuerda reemplazar [Nombre de quien envía] antes de enviarlo.' : 'Enlace copiado.') : 'No se pudo copiar automáticamente: selecciona el enlace y presiona Ctrl+C.', !ok);
}

async function borrarCarnet(id) {
  const d = fichaActual();
  if (!d) return;
  if (!confirm('¿Confirmas que ya verificaste la identidad de ' + (d.nombre || 'esta persona') + '?\n\nSe BORRARÁ para siempre la copia del carnet y se marcará el paso «Identidad verificada». La carta firmada se conserva.')) return;
  const r = await post('/api/documento/borrar-carnet', { id });
  if (r.error) return mostrar(r.error, true);
  const p = await guardarPaso('identidad', true);
  if (p) mostrar('Carnet borrado e identidad verificada.');
}

// ---- Importar planilla de socias ----
let sociasCsv = ''; // texto del archivo elegido (si se usa archivo en vez de enlace)
const entradaSocias = () => ({ csv: sociasCsv, url: $('sociasUrl').value.trim() });

$('importarSocias').addEventListener('click', () => { cerrarMenu(); if (alternarPanel('panelSocias')) $('sociasResultado').innerHTML = ''; });
$('sociasArchivoLabel').addEventListener('click', () => $('sociasArchivo').click());
$('sociasArchivo').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  sociasCsv = await f.text();
  $('sociasUrl').value = '';
  $('sociasResultado').innerHTML = '<span class="sub">Archivo cargado: ' + esc(f.name) + '. Pulsa "Ver vista previa".</span>';
});
$('sociasUrl').addEventListener('input', () => { sociasCsv = ''; });

$('sociasVista').addEventListener('click', async () => {
  $('sociasResultado').textContent = 'Revisando la planilla…';
  const r = await post('/api/socias/vista-previa', entradaSocias());
  if (r.error) { $('sociasResultado').innerHTML = '<span style="color:var(--alerta)">' + esc(r.error) + '</span>'; return; }
  const s = r.resumen;
  const lineas = [
    '<b>' + s.encontradas + '</b> de ' + s.socias + ' socias están en el listado.',
    '<b>' + s.pasanASocia + '</b> personas pasarán a la etapa «Socia» (' + s.filasAfectadas + ' filas con cambios).',
    'Se anotará el N° de inscripción de <b>' + s.inscripciones + '</b> personas.',
  ];
  if (s.sinCoincidencia) lineas.push('<span style="color:var(--alerta)">' + s.sinCoincidencia + ' socias no están en el listado: ' + r.sinCoincidencia.map(x => esc(x.nombre || x.rut)).join(', ') + '.</span>');
  if (s.noActivas) lineas.push(s.noActivas + ' socias no están en estado ACTIVA y no se tocan: ' + r.noActivas.map(x => esc(x.nombre)).join(', ') + '.');
  if (s.conflictos) lineas.push('<span style="color:var(--alerta)">' + s.conflictos + ' filas figuran como Renuncia o No califica y NO se cambian:</span> ' + r.conflictos.map(x => esc(x.nombre) + ' (' + esc(x.etapa) + ', fila ' + x.fila + ')').join('; ') + '.');
  (r.avisos || []).forEach(a => lineas.push('<span class="sub">' + esc(a) + '</span>'));
  const revs = r.revisiones.length
    ? '<p style="margin:8px 0 2px"><b>Diferencias de datos para revisar</b> (marca las que quieras cambiar; las demás se dejan como están):</p>' +
      r.revisiones.map(x => '<label style="display:block;font-size:13px;padding:3px 0"><input type="checkbox" data-socia-rev="' + esc(x.id) + '"> fila ' + x.fila + ' · ' + esc(x.campo) + ': <span class="sub">hoy</span> ' + esc(x.hoy || '(vacío)') + ' → <span class="sub">planilla de socias</span> <b>' + esc(x.nuevo) + '</b></label>').join('')
    : '<p class="sub" style="margin:8px 0 2px">No hay diferencias de nombre ni de correo.</p>';
  $('sociasResultado').innerHTML = '<p style="margin:6px 0">' + lineas.join('<br>') + '</p>' + revs +
    '<div style="margin-top:8px"><button id="sociasAplicar">Aplicar cambios</button> <small>Queda todo en el historial y cada ficha se puede deshacer con «Deshacer correcciones».</small></div>';
});

$('sociasResultado').addEventListener('click', async e => {
  if (!e.target.closest('#sociasAplicar')) return;
  const aceptadas = [...document.querySelectorAll('[data-socia-rev]:checked')].map(x => x.dataset.sociaRev);
  if (!confirm('¿Aplicar los cambios al listado?\n\nSe actualizan las filas de las socias y ' + aceptadas.length + ' diferencia(s) de datos que marcaste.')) return;
  $('sociasAplicar').disabled = true;
  $('sociasResultado').insertAdjacentHTML('afterbegin', '<p class="sub">Aplicando… puede tardar un minuto.</p>');
  const r = await post('/api/socias/aplicar', { ...entradaSocias(), aceptadas });
  if (r.error) { mostrar(r.error, true); $('sociasAplicar').disabled = false; return; }
  cerrarPaneles();
  cargar(r, true);
  mostrar('Listo: se actualizaron ' + r.aplicadas + ' fichas' + (r.fallidas ? ' (' + r.fallidas + ' no se pudieron guardar: vuelve a intentar)' : '') + '.', !!r.fallidas);
});

// ---- Aviso de documentos por revisar ----
function actualizarAvisoDocs(n) {
  $('avisoDocs').hidden = !n;
  $('avisoDocsTexto').textContent = n === 1 ? '1 postulante envió documentos y espera revisión.' : n + ' postulantes enviaron documentos y esperan revisión.';
}
// ---- Correcciones enviadas por las postulantes ----
function actualizarAvisoCorrecciones(n) {
  $('avisoCorrecciones').hidden = !n;
  $('avisoCorreccionesTexto').textContent = n === 1 ? '1 postulante envió una corrección de sus datos.' : n + ' postulantes enviaron correcciones de sus datos.';
}
const ETIQUETA_CAMPO = { rut: 'RUT', nacimiento: 'Nacimiento', telefono: 'Teléfono', region: 'Región', correo: 'Correo', nombre: 'Nombre' };

async function cargarCorrecciones() {
  const lista = $('correccionesLista');
  const r = await fetch('/api/correcciones');
  const j = await r.json().catch(() => ({ error: 'No se pudo leer la lista.' }));
  if (!r.ok) { lista.textContent = j.error || 'No se pudo leer la lista.'; return; }
  actualizarAvisoCorrecciones(j.correcciones.length);
  if (!j.correcciones.length) { lista.textContent = 'No hay correcciones por revisar.'; return; }
  lista.innerHTML = j.correcciones.map(c => `<div class="hist-fila" data-correccion="${esc(c.id)}">
      <b>${esc(c.nombre)}</b> <span class="sub">fila ${c.fila ?? '—'} · enviada ${esc(fechaHoraCL(c.creado_en))}</span>
      ${c.campos.map(k => `<label style="display:block;padding:3px 0"><input type="checkbox" data-campo-correccion="${esc(k.campo)}"${k.valido ? ' checked' : ''}> ${esc(ETIQUETA_CAMPO[k.campo] || k.campo)}:
        <span class="sub">hoy</span> ${esc(k.hoy || '(vacío)')} → <b>${esc(k.vista || k.nuevo)}</b>
        ${k.valido ? '' : '<span class="chip mal" title="Lo propuesto sigue sin pasar las comprobaciones de la ficha">⚠ sigue con problema</span>'}</label>`).join('')}
      <div style="margin-top:4px"><button class="btn-peq" data-aceptar-correccion>Aceptar lo marcado</button>
      <button class="sec btn-peq" data-descartar-correccion>Descartar</button></div>
    </div>`).join('');
}
$('verCorrecciones').addEventListener('click', () => { if (alternarPanel('panelCorrecciones')) { $('correccionesLista').textContent = 'Cargando…'; cargarCorrecciones(); } });
$('correccionesLista').addEventListener('click', async e => {
  const bloque = e.target.closest('[data-correccion]');
  const aceptar = e.target.closest('[data-aceptar-correccion]'), descartar = e.target.closest('[data-descartar-correccion]');
  if (!bloque || (!aceptar && !descartar)) return;
  const marcados = aceptar ? [...bloque.querySelectorAll('[data-campo-correccion]:checked')].map(x => x.dataset.campoCorreccion) : [];
  if (aceptar && !marcados.length) return mostrar('No marcaste ningún dato. Para dejarla sin aplicar, pulsa Descartar.', true);
  bloque.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const r = await post('/api/correcciones/resolver', { id: bloque.dataset.correccion, aceptar: marcados });
  if (r.error) { mostrar(r.error, true); await cargarCorrecciones(); return; }
  cargar(r, true);
  mostrar(aceptar ? 'Listo: se actualizó la ficha (' + r.aplicados + ' dato' + (r.aplicados === 1 ? '' : 's') + ').' : 'Propuesta descartada. La ficha no cambió.');
  await cargarCorrecciones();
  if (!$('correccionesLista').querySelector('[data-correccion]')) cerrarPaneles();
});

$('verPorRevisar').addEventListener('click', () => {
  $('filtro').value = 'porrevisar';
  if (puedeSalir()) { cerrarFicha(); pintar(); }
});

// Cada minuto se consulta si llegó algo nuevo; si cambió y no se está escribiendo nada, se recarga la lista.
let firmaPendientes = null, temporizadorPendientes = null;
async function consultarPendientes() {
  try {
    const r = await fetch('/api/pendientes');
    if (!r.ok) return;
    const p = await r.json();
    actualizarAvisoDocs(p.pendientes);
    actualizarAvisoCorrecciones(p.correcciones || 0);
    if (!$('panelCorrecciones').hidden && firmaPendientes !== null && p.firma !== firmaPendientes) cargarCorrecciones();
    const cambio = firmaPendientes !== null && p.firma !== firmaPendientes;
    const ocupada = editando || !$('modalCarta').hidden || !$('modalMensaje').hidden;
    if (cambio && !ocupada) {
      const nuevos = p.pendientes > datos.filter(x => x.pendienteRevision).length;
      const d = await fetch('/api/postulaciones');
      if (d.ok) { cargar(await d.json(), true); if (nuevos) mostrar('Llegaron documentos nuevos: ' + p.pendientes + ' por revisar.'); else if (p.correcciones) mostrar('Hay correcciones de datos por revisar: ' + p.correcciones + '.'); }
      firmaPendientes = p.firma;
    } else if (!cambio) firmaPendientes = p.firma; // si estaba ocupada, se reintenta en la próxima vuelta
  } catch { /* sin conexión por ahora */ }
}
function iniciarConsultaPendientes() { clearInterval(temporizadorPendientes); firmaPendientes = null; consultarPendientes(); temporizadorPendientes = setInterval(consultarPendientes, 60000); }
function detenerConsultaPendientes() { clearInterval(temporizadorPendientes); temporizadorPendientes = null; }

// ---- Sesión ----
// Cualquier respuesta 401 (la sesión venció) vuelve a la pantalla de ingreso.
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (url, opciones) => {
  const r = await fetchOriginal(url, opciones);
  if (r.status === 401 && !String(url).startsWith('/api/ingresar')) mostrarLogin('Tu sesión venció. Vuelve a ingresar.');
  return r;
};

function mostrarLogin(aviso) {
  $('login').hidden = false;
  $('loginError').textContent = aviso || '';
  $('loginClave').value = '';
  $('usuario').textContent = '';
  usuarioActual = null;
  detenerConsultaPendientes();
  cerrarFicha(); cerrarPaneles();
  (aviso && $('loginCorreo').value ? $('loginClave') : $('loginCorreo')).focus();
}

const ROL = { admin: 'administradora', secretaria: 'secretaria', directiva: 'directiva (solo consulta)' };
const puedeEditarRol = rol => rol === 'admin' || rol === 'secretaria';
let usuarioActual = null;

async function entrarALaApp(usuario) {
  usuarioActual = usuario;
  $('login').hidden = true;
  document.body.classList.toggle('lectura', !!usuario && !puedeEditarRol(usuario.rol));
  $('usuario').textContent = usuario ? usuario.nombre + ' · ' + (ROL[usuario.rol] || usuario.rol) : '';
  // Con una contraseña temporal no se puede trabajar: primero se elige una propia.
  if (usuario && usuario.cambiarClave) return mostrarCambioClave(true);
  const esAdmin = !!usuario && usuario.rol === 'admin'; // el enlace de la planilla lo cambia solo la administradora
  $('hojaUrl').readOnly = !esAdmin; $('guardarUrl').hidden = !esAdmin;
  $('importarSocias').hidden = !esAdmin;
  $('verUsuarias').hidden = !esAdmin;
  $('usuario').textContent = usuario ? usuario.nombre + ' · ' + (ROL[usuario.rol] || usuario.rol) : '';
  const r = await fetch('/api/postulaciones');
  if (r.ok) { cargar(await r.json()); revisarMigracion(); if (puedeEditarRol(usuario.rol)) iniciarConsultaPendientes(); }
}

$('formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginEnviar').disabled = true; $('loginError').textContent = 'Ingresando…';
  try {
    const r = await fetchOriginal('/api/ingresar', { method: 'POST', body: JSON.stringify({ correo: $('loginCorreo').value, contrasena: $('loginClave').value }) });
    const j = await r.json();
    if (!r.ok) { $('loginError').textContent = j.error || 'No se pudo ingresar.'; $('loginClave').value = ''; return; }
    $('loginClave').value = ''; $('loginError').textContent = '';
    await entrarALaApp(j.usuario);
  } catch { $('loginError').textContent = 'No se pudo conectar con la aplicación.'; }
  finally { $('loginEnviar').disabled = false; }
});

$('cerrarSesion').addEventListener('click', async () => {
  cerrarMenu();
  await fetchOriginal('/api/salir', { method: 'POST', body: '{}' });
  datos = [];
  mostrarLogin('Sesión cerrada.');
});

// ---- Cambio de contraseña ----
let cambioForzado = false;
function mostrarCambioClave(forzado) {
  cambioForzado = !!forzado;
  $('cambioTitulo').textContent = forzado ? 'Elige tu contraseña' : 'Cambiar mi contraseña';
  $('cambioTexto').textContent = forzado
    ? 'Tu contraseña actual es temporal. Elige una nueva, que solo tú conozcas (mínimo 10 caracteres), para poder continuar.'
    : 'Elige una contraseña nueva (mínimo 10 caracteres).';
  $('cambioCancelar').hidden = !!forzado;
  $('claveNueva').value = ''; $('claveNueva2').value = ''; $('cambioError').textContent = '';
  $('cambioClave').hidden = false;
  $('claveNueva').focus();
}
$('cambiarMiClave').addEventListener('click', () => { cerrarMenu(); mostrarCambioClave(false); });
$('cambioCancelar').addEventListener('click', () => { $('cambioClave').hidden = true; });
$('formCambioClave').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('claveNueva').value, b = $('claveNueva2').value;
  if (a.length < 10) return ($('cambioError').textContent = 'La contraseña debe tener al menos 10 caracteres.');
  if (a !== b) return ($('cambioError').textContent = 'Las dos contraseñas no coinciden.');
  $('cambioEnviar').disabled = true; $('cambioError').textContent = 'Guardando…';
  const r = await post('/api/mi-clave', { nueva: a });
  $('cambioEnviar').disabled = false;
  if (r.error) return ($('cambioError').textContent = r.error);
  $('claveNueva').value = ''; $('claveNueva2').value = '';
  $('cambioClave').hidden = true;
  if (cambioForzado) await entrarALaApp(r.usuario); else mostrar('Contraseña cambiada.');
});

// ---- Usuarias y categorías (solo la administradora) ----
// Sugerencias al escribir el nombre: salen de la lista de socias ya cargada. Al elegir una se rellena el correo de la planilla
// (se puede cambiar), y se avisa si esa persona ya tiene cuenta.
let cuentasExistentes = [], sugeridas = [];
function cargarSugerencias() {
  sugeridas = Sugerencias.personas(datos, { todas: $('nuTodas').checked });
  $('nuSugerencias').innerHTML = sugeridas.map(p => '<option value="' + esc(p.nombre) + '" label="' + esc(p.correo) + '"></option>').join('');
  $('nuAyuda').textContent = sugeridas.length ? sugeridas.length + ' personas disponibles para elegir.' : 'No hay personas cargadas para sugerir: escribe el nombre y el correo a mano.';
}
function revisarElegida() {
  const p = Sugerencias.buscar(sugeridas, $('nuNombre').value);
  const correo = $('nuCorreo');
  if (p) {
    $('nuNombre').value = p.nombre;
    if (!correo.value || correo.dataset.auto === '1') { correo.value = p.correo; correo.dataset.auto = '1'; }
    $('nuAyuda').textContent = 'Elegida de la lista (fila ' + p.fila + '). Revisa el correo: es el que dejó en el formulario, y puede ser otro el que quieras usar.';
  }
  const yaTiene = cuentasExistentes.find(c => c.correo && c.correo.toLowerCase() === correo.value.trim().toLowerCase());
  if (yaTiene) $('nuAyuda').textContent = '⚠ ' + yaTiene.nombre + ' ya tiene una cuenta con ese correo.';
}
$('nuNombre').addEventListener('input', revisarElegida);
$('nuNombre').addEventListener('change', revisarElegida);
$('nuCorreo').addEventListener('input', () => { $('nuCorreo').dataset.auto = '0'; revisarElegida(); });
$('nuTodas').addEventListener('change', cargarSugerencias);

const NOMBRE_ROL = { admin: 'Administradora', secretaria: 'Secretaria', directiva: 'Directiva (solo consulta)' };
async function cargarUsuarias() {
  const caja = $('usuariasLista');
  const r = await fetch('/api/usuarios');
  const j = await r.json().catch(() => ({ error: 'No se pudo leer la lista.' }));
  if (!r.ok) { caja.textContent = j.error || 'No se pudo leer la lista.'; return; }
  cuentasExistentes = j.usuarios;
  caja.innerHTML = '<table class="tabla-usuarias"><thead><tr><th>Nombre</th><th>Correo</th><th>Categoría</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody>' +
    j.usuarios.map(u => '<tr data-usuaria="' + esc(u.id) + '"><td>' + esc(u.nombre) + (u.cambiarClave ? ' <span class="chip" title="Aún no cambia su contraseña temporal">clave temporal</span>' : '') + '</td><td>' + esc(u.correo) + '</td>' +
      '<td><select data-usuaria-rol>' + Object.entries(NOMBRE_ROL).map(([k, v]) => '<option value="' + k + '"' + (k === u.rol ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></td>' +
      '<td>' + (u.activo ? 'Activa' : '<b style="color:var(--alerta)">Desactivada</b>') + ' <button class="sec btn-peq" data-usuaria-activo="' + (u.activo ? '0' : '1') + '">' + (u.activo ? 'Desactivar' : 'Activar') + '</button></td>' +
      '<td>' + (u.ultimoIngreso ? esc(fechaHoraCL(u.ultimoIngreso)) : '<span class="sub">nunca</span>') + '</td>' +
      '<td><button class="sec btn-peq" data-usuaria-clave>Restablecer contraseña</button></td></tr>').join('') + '</tbody></table>' +
    (j.sinPerfil.length ? '<p class="sub">Cuentas sin categoría (no pueden entrar): ' + j.sinPerfil.map(u => esc(u.correo)).join(', ') + '</p>' : '');
}
function mostrarClaveTemporal(nombre, correo, clave) {
  const caja = $('claveTemporalCaja');
  caja.innerHTML = '<b>Contraseña temporal de ' + esc(nombre) + '</b> (' + esc(correo) + '): <span class="clave-temporal">' + esc(clave) + '</span> <button class="btn-peq" id="copiarClaveTemporal">Copiar</button><br><small>Se muestra una sola vez. Entrégasela por un medio seguro (en persona o por llamada, no en un chat grupal). Deberá cambiarla al ingresar. Al cerrar este panel no se podrá volver a ver; si se pierde, se restablece.</small>';
  caja.hidden = false;
  $('copiarClaveTemporal').addEventListener('click', async () => mostrar((await copiarTexto(clave)) ? 'Contraseña copiada.' : 'No se pudo copiar: selecciónala y presiona Ctrl+C.', false));
}
$('verUsuarias').addEventListener('click', () => { cerrarMenu(); $('claveTemporalCaja').hidden = true; if (alternarPanel('panelUsuarias')) { cargarUsuarias(); cargarSugerencias(); } });
$('formNuevaUsuaria').addEventListener('submit', async e => {
  e.preventDefault();
  $('nuCrear').disabled = true;
  const nombre = $('nuNombre').value, correo = $('nuCorreo').value;
  const r = await post('/api/usuarios/crear', { nombre, correo, rol: $('nuRol').value });
  $('nuCrear').disabled = false;
  if (r.error) return mostrar(r.error, true);
  $('formNuevaUsuaria').reset();
  $('nuCorreo').dataset.auto = '0';
  cargarSugerencias();
  mostrarClaveTemporal(nombre, r.correo, r.clave);
  await cargarUsuarias();
});
$('usuariasLista').addEventListener('change', async e => {
  const sel = e.target.closest('[data-usuaria-rol]'); if (!sel) return;
  const id = sel.closest('[data-usuaria]').dataset.usuaria;
  const r = await post('/api/usuarios/perfil', { id, rol: sel.value });
  if (r.error) mostrar(r.error, true); else mostrar('Categoría cambiada.');
  await cargarUsuarias();
});
$('usuariasLista').addEventListener('click', async e => {
  const fila = e.target.closest('[data-usuaria]'); if (!fila) return;
  const id = fila.dataset.usuaria, nombre = fila.children[0].firstChild.textContent.trim(), correo = fila.children[1].textContent;
  const act = e.target.closest('[data-usuaria-activo]'), clave = e.target.closest('[data-usuaria-clave]');
  if (act) {
    const activar = act.dataset.usuariaActivo === '1';
    if (!activar && !confirm('¿Desactivar la cuenta de ' + nombre + '? Dejará de poder entrar de inmediato.')) return;
    const r = await post('/api/usuarios/perfil', { id, activo: activar });
    if (r.error) mostrar(r.error, true); else mostrar(activar ? 'Cuenta activada.' : 'Cuenta desactivada.');
    await cargarUsuarias();
  } else if (clave) {
    if (!confirm('¿Restablecer la contraseña de ' + nombre + '? La anterior dejará de servir y se generará una temporal.')) return;
    const r = await post('/api/usuarios/clave', { id });
    if (r.error) return mostrar(r.error, true);
    mostrarClaveTemporal(nombre, correo, r.clave);
    await cargarUsuarias();
  }
});

// ---- Historial de cambios ----
function textoValor(v) {
  if (v == null || v === '') return '(vacío)';
  if (typeof v === 'object') return v.fecha ? fechaCL(v.fecha) + (v.nota ? ' — ' + v.nota : '') : JSON.stringify(v);
  return String(v);
}
function lineaHistorial(h, conNombre) {
  const cuando = new Date(h.creado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  const etiquetaPaso = id => (pasosDef.find(p => p.id === id) || {}).etiqueta || id;
  const cambios = Object.entries(h.detalle || {}).map(([k, v]) => {
    if (h.accion === 'paso') return v.despues ? 'marcó «' + etiquetaPaso(k) + '» (' + textoValor(v.despues) + ')' : 'desmarcó «' + etiquetaPaso(k) + '»';
    return k + ': ' + textoValor(v.antes) + ' → ' + textoValor(v.despues);
  }).join('; ');
  const sobre = conNombre ? (datos.find(d => d.clave === h.clave) || {}).nombre || 'otra postulación' : '';
  return '<div class="hist-fila"><span class="quien">' + esc(h.usuario_nombre || 'Alguien') + '</span> · ' + esc(cuando) + (sobre ? ' · ' + esc(sobre) : '') + '<br>' + esc(cambios) + '</div>';
}
async function cargarHistorialFicha(clave) {
  try {
    const j = await (await fetch('/api/historial?clave=' + encodeURIComponent(clave))).json();
    const caja = $('histFicha');
    if (!caja || clave !== (datos.find(x => x.fila === seleccion) || {}).clave) return; // se cambió de ficha mientras cargaba
    caja.innerHTML = j.historial && j.historial.length ? j.historial.map(h => lineaHistorial(h, false)).join('') : 'Sin cambios registrados.';
  } catch { if ($('histFicha')) $('histFicha').textContent = 'No se pudo cargar el historial.'; }
}
$('verHistorial').addEventListener('click', async () => {
  cerrarMenu();
  if (!alternarPanel('panelHistorial')) return;
  $('historialLista').textContent = 'Cargando…';
  try {
    const j = await (await fetch('/api/historial')).json();
    $('historialLista').innerHTML = j.historial && j.historial.length ? j.historial.map(h => lineaHistorial(h, true)).join('') : 'Todavía no hay cambios registrados.';
  } catch { $('historialLista').textContent = 'No se pudo cargar el historial.'; }
});

// ---- Correcciones antiguas guardadas en este computador (de antes de usar la base compartida) ----
async function revisarMigracion() {
  $('avisoMigracion').hidden = true;
  if (!usuarioActual || usuarioActual.rol !== 'admin') return;
  try {
    const { pendientes } = await (await fetch('/api/migracion')).json();
    if (!pendientes) return;
    $('migracionTexto').textContent = pendientes + ' postulación(es) con correcciones o pasos anotados antes de usar la base compartida. Se suben sin pisar lo que ya esté en ella.';
    $('avisoMigracion').hidden = false;
  } catch { /* sin aviso */ }
}
$('subirAntiguas').addEventListener('click', async () => {
  const r = await post('/api/migracion');
  if (r.error) return mostrar(r.error, true);
  $('avisoMigracion').hidden = true;
  cargar(r, true);
  mostrar('Listo: se subieron ' + r.subidas + ' postulación(es)' + (r.yaExistian ? ' (' + r.yaExistian + ' ya estaban en la base y no se tocaron)' : '') + '. El archivo antiguo quedó guardado como ediciones.migrado.json.');
});

// ---- Arranque ----
(async () => {
  try {
    if (window.AMAGRO_LISTO) await window.AMAGRO_LISTO; // versión web: primero se retoma la sesión guardada
    const s = await (await fetchOriginal('/api/sesion')).json();
    if (!s.configurado) return mostrar('Falta configurar el proyecto de Supabase (supabase/proyecto.json).', true);
    if (s.activa) await entrarALaApp(s.usuario); else mostrarLogin();
  } catch { mostrarLogin('No se pudo conectar con la aplicación.'); }
})();
