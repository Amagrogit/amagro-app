// Arma el correo que la secretaria puede enviar a una postulante para pedirle que confirme
// los datos marcados con alerta. Solo incluye alertas que la propia persona puede resolver:
// nunca menciona duplicados, rechazos previos ni otras postulaciones (eso es decisión de la directiva
// y podría revelar datos de otras personas).
// Sirve tanto en el navegador (window.construirMensaje) como en las pruebas de Node (require).
(function (raiz) {
  const fechaCL = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const capitalizar = s => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '');
  // Firma común de todos los correos de la aplicación (no lleva el nombre de quien los envía: salen de la cuenta de socias).
  const FIRMA_EQUIPO = 'Equipo de Socias AMAGRO AG';
  // Nombre completo con mayúscula solo al inicio de cada palabra (de, del, la… van en minúscula).
  const PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e'];
  const nombreCompleto = n => String(n || '').trim().toLowerCase().replace(/(^|[\s\-´'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .split(' ').map((p, i) => (i > 0 && PARTICULAS.includes(p.toLowerCase()) ? p.toLowerCase() : p)).join(' ');
  // El asunto lleva el nombre para distinguir los correos en la carpeta de copias.
  const conNombre = (asunto, nombre) => (nombreCompleto(nombre) ? asunto + ' · ' + nombreCompleto(nombre) : asunto);

  const MARCA_ENLACE_DATOS = '[ENLACE PARA CORREGIR]';
  function construirMensaje(d, conEnlace = false) {
    const tiene = re => d.alertas.some(a => re.test(a));
    const puntos = [];

    if (tiene(/^RUT inválido/)) {
      puntos.push(`Tu RUT: en nuestros registros figura "${d.rut || 'sin dato'}" y parece incompleto o con un error. ¿Puedes confirmarnos tu RUT completo, con guion y dígito verificador?`);
    }
    if (tiene(/^Fecha de nacimiento ilegible/)) {
      puntos.push('Tu fecha de nacimiento: no pudimos entenderla. ¿Puedes escribirla como día/mes/año? Por ejemplo, 15/03/1985.');
    } else if (tiene(/^Fecha de nacimiento dudosa/)) {
      puntos.push(`Tu fecha de nacimiento: figura como ${fechaCL(d.nacimiento)}, lo que parece un error. ¿Puedes confirmarla como día/mes/año?`);
    }
    if (tiene(/^Teléfono con formato dudoso/)) {
      puntos.push(`Tu teléfono: figura como "${d.telefono || 'sin dato'}" y parece incompleto. ¿Puedes confirmarnos el número completo?`);
    }
    if (tiene(/^Región no reconocida/)) {
      puntos.push('Tu región: no pudimos identificarla. ¿En qué región vives?');
    } else if (tiene(/^Marcó más de una región/)) {
      puntos.push('Tu región: marcaste más de una. ¿Cuál corresponde a tu domicilio?');
    }

    const correoInvalido = tiene(/^Correo inválido/);
    const primerNombre = capitalizar(String(d.nombre || '').trim().split(/\s+/)[0]);
    const cuerpo = [
      `Hola ${primerNombre || 'postulante'},`,
      '',
      'Gracias por postular a AMAGRO AG. Al revisar tu solicitud necesitamos que nos confirmes lo siguiente:',
      '',
      ...puntos.map(p => `• ${p}`),
      '',
      ...(conEnlace
        ? ['Puedes corregirlo en menos de un minuto entrando a este enlace:', '', MARCA_ENLACE_DATOS, '', 'El enlace sirve una sola vez. Nunca te pediremos claves ni pagos por este medio. Si algo no te cuadra, respóndenos este correo.']
        : ['Puedes responder directamente este correo.']),
      '',
      'Saludos cordiales,',
      FIRMA_EQUIPO,
    ].join('\n');

    return {
      hayPuntos: puntos.length > 0,
      correoInvalido,
      destinatario: correoInvalido ? '' : d.correo || '',
      asunto: conNombre('AMAGRO AG · Confirmación de datos de tu postulación', d.nombre),
      cuerpo,
    };
  }

  // Correo que acompaña a la carta de solicitud de ingreso (el PDF se adjunta a mano: un enlace de correo no puede adjuntar).
  const MARCA_ENLACE = '[ENLACE DE SUBIDA]';
  function construirCorreoCarta(d, firma = FIRMA_EQUIPO, conEnlace = false) {
    const correoInvalido = !d.correo || d.alertas.some(a => /^Correo inválido/.test(a));
    const primerNombre = capitalizar(String(d.nombre || '').trim().split(/\s+/)[0]);
    if (conEnlace) {
      // Con enlace no hay nada que adjuntar: la carta ya completada se descarga desde la propia página.
      return {
        correoInvalido,
        destinatario: correoInvalido ? '' : d.correo,
        asunto: conNombre('AMAGRO AG · Carta de solicitud de ingreso', d.nombre),
        cuerpo: [
          `Hola ${primerNombre || 'postulante'},`,
          '',
          'Gracias por postular a AMAGRO AG. Para continuar con tu solicitud, por favor:',
          '',
          '1. Entra a este enlace, desde el computador o el celular:',
          '',
          MARCA_ENLACE,
          '',
          '2. Descarga tu carta de solicitud, que ya tiene tus datos completados. Revisa que estén correctos, imprímela y fírmala.',
          '3. En la misma página, sube la carta firmada y una copia de tu carnet de identidad por ambos lados.',
          '',
          'El enlace sirve una sola vez. Necesitamos tu carnet solo para verificar tu identidad: apenas lo hagamos, lo borramos de forma permanente.',
          'Si algún dato está incorrecto, avísanos respondiendo este correo.',
          '',
          'Saludos cordiales,',
          firma,
          ...(firma === FIRMA_EQUIPO ? [] : ['AMAGRO AG']),
        ].join('\n'),
      };
    }
    return {
      correoInvalido,
      destinatario: correoInvalido ? '' : d.correo,
      asunto: conNombre('AMAGRO AG · Carta de solicitud de ingreso', d.nombre),
      cuerpo: [
        `Hola ${primerNombre || 'postulante'},`,
        '',
        'Gracias por postular a AMAGRO AG. Te enviamos adjunta la carta de solicitud de ingreso, con tus datos ya completados.',
        '',
        'Para continuar, por favor:',
        '1. Revisa que tus datos estén correctos.',
        '2. Imprime la carta y fírmala.',
        '3. Respóndenos este correo adjuntando la carta firmada y una copia de tu carnet de identidad por ambos lados.',
        '',
        'Si algún dato está incorrecto, avísanos en tu respuesta.',
        '',
        'Saludos cordiales,',
        firma,
        ...(firma === FIRMA_EQUIPO ? [] : ['AMAGRO AG']),
      ].join('\n'),
    };
  }

  // Dirección que abre la redacción de Gmail (en el navegador) con el mensaje ya escrito. Gmail no permite adjuntar por aquí.
  // Con "cuenta", Gmail abre la redacción con esa cuenta (si está abierta en el navegador; si no, pide ingresar a ella).
  // Con "copia", va una copia oculta (Cco) a esa dirección, para que quede el registro en su bandeja (no se agrega si es la misma que el destinatario).
  function urlGmail({ destinatario, asunto, cuerpo, cuenta, copia }) {
    const cco = copia && String(copia).toLowerCase() !== String(destinatario || '').trim().toLowerCase();
    const q = [...(cuenta ? [['authuser', cuenta]] : []), ['view', 'cm'], ['fs', '1'], ['to', destinatario || ''], ...(cco ? [['bcc', copia]] : []), ['su', asunto || ''], ['body', cuerpo || '']];
    return 'https://mail.google.com/mail/?' + q.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  }

  // Correo para avisarle a alguien que se le creó una cuenta (o que se le restableció la contraseña). NO lleva la contraseña
  // temporal: esa se entrega por otro medio (en persona o por llamada), para que el correo solo no baste para entrar.
  const CATEGORIAS = {
    admin: ['administradora', 'puedes ver y trabajar todas las postulaciones y, además, crear cuentas, importar planillas y restaurar respaldos.'],
    secretaria: ['secretaria', 'puedes ver y trabajar las postulaciones: corregir datos, marcar pasos, enviar enlaces y correos, y revisar los documentos recibidos.'],
    directiva: ['directiva (solo consulta)', 'puedes consultar el listado, las fichas, el historial y las cartas firmadas (no los carnets), pero no modificas nada.'],
  };
  function construirInvitacion({ nombre, correo, rol, url, nueva = true, firma = FIRMA_EQUIPO }) {
    const primer = capitalizar(String(nombre || '').trim().split(/\s+/)[0]) || 'hola';
    const [etiqueta, permisos] = CATEGORIAS[rol] || ['usuaria', 'puedes usar la aplicación.'];
    const comun = [
      `Dirección: ${url}`,
      `Usuario: ${correo} (este mismo correo)`,
      'Contraseña: una temporal que te entrego por otro medio (en persona o por llamada). Al ingresar, la aplicación te pedirá elegir una propia, que solo tú conocerás.',
      '',
      'Un consejo: guarda tu contraseña en un gestor de contraseñas y no la compartas con nadie. Nunca te la pediremos por correo ni por mensaje.',
      '',
      'Si tienes dudas, escríbeme.',
      '',
      'Saludos cordiales,',
      firma,
      ...(firma === FIRMA_EQUIPO ? [] : ['AMAGRO AG']),
    ];
    return {
      destinatario: correo,
      asunto: conNombre(nueva ? 'AMAGRO AG · Te invitamos a la aplicación de gestión de socias' : 'AMAGRO AG · Nueva contraseña temporal para la aplicación', nombre),
      cuerpo: [
        `Hola ${primer},`,
        '',
        ...(nueva
          ? [`Te creé una cuenta en la aplicación de AMAGRO AG, donde se gestionan las postulaciones y las socias. Tu categoría es ${etiqueta}: ${permisos}`]
          : ['Restablecí tu contraseña de la aplicación de AMAGRO AG. La anterior ya no sirve.']),
        '',
        ...comun,
      ].join('\n'),
    };
  }

  const api = { FIRMA_EQUIPO, construirMensaje, construirCorreoCarta, construirInvitacion, MARCA_ENLACE, MARCA_ENLACE_DATOS, urlGmail };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
