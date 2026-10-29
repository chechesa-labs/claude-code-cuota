// Lógica pura de cuota: leer las ventanas, decidir el estado de una carpeta
// y armar los textos. Sin `$`, para poder probarla sin el motor.

export type Idioma = 'es' | 'en'

export type Ajustes = {
  topeCinco: number
  topeSemana: number
  cincoFrena: boolean
  margen: number
}

export type VentanaId = 'cinco' | 'semana'

export type Ventana = { uso: number; reinicio?: string }

export type Lectura = { cinco?: Ventana; semana?: Ventana }

/** Los límites propios de una carpeta; la ventana que no tenga usa el de todas las carpetas. */
export type TopesCarpeta = { cinco?: number; semana?: number }

/** Un límite subido "temporal": vale hasta el reinicio de la ventana y luego vuelve a `antes` (sin `antes`, al de todas). */
export type Temporal = { hasta: string; antes?: number }

/** Lo que se guarda por carpeta. `tope` es de la v0.1, cuando un número valía para las dos ventanas. */
export type Politica = {
  cinco?: number
  semana?: number
  tope?: number
  temporal?: { cinco?: Temporal; semana?: Temporal }
  ruta: string
  desde: string
}

export type Estado = 'sin-datos' | 'normal' | 'cerrando' | 'frenado' | 'libre'

export type Evaluacion = {
  estado: Estado
  /** La ventana que manda: la que frena y tiene menos margen. */
  manda?: VentanaId
  faltan?: number
  /** La de 5 h pasó su límite pero está configurada para solo avisar. */
  avisoCinco: boolean
}

type Limite = { kind: string; percentUsed: number; resetsAt?: string }

/** `five_hour` es la de 5 h; `seven_day` y `seven_day_*` cuentan como semana (la más alta). */
export const leer = (limites: readonly Limite[]): Lectura => {
  const lectura: Lectura = {}
  for (const l of limites) {
    const v = { uso: l.percentUsed, reinicio: l.resetsAt }
    if (l.kind === 'five_hour') lectura.cinco = v
    else if (l.kind.startsWith('seven_day') && (lectura.semana === undefined || v.uso > lectura.semana.uso)) {
      lectura.semana = v
    }
  }
  return lectura
}

/** Quita las ventanas cuyo reinicio ya pasó: su porcentaje ya no vale. */
export const vigente = (lectura: Lectura, ahora: number): Lectura => {
  const sigue = (v?: Ventana) => (v && (!v.reinicio || Date.parse(v.reinicio) > ahora) ? v : undefined)
  const r: Lectura = {}
  const cinco = sigue(lectura.cinco)
  const semana = sigue(lectura.semana)
  if (cinco) r.cinco = cinco
  if (semana) r.semana = semana
  return r
}

/** Los límites propios de una política guardada, con el `tope` viejo repartido a las dos ventanas. */
export const propiosDe = (p?: Politica): TopesCarpeta | undefined => {
  if (p === undefined) return undefined
  const r: TopesCarpeta = {}
  const cinco = p.cinco ?? p.tope
  const semana = p.semana ?? p.tope
  if (cinco !== undefined) r.cinco = cinco
  if (semana !== undefined) r.semana = semana
  return r
}

export const topeDe = (ventana: VentanaId, ajustes: Ajustes, propios?: TopesCarpeta) =>
  propios?.[ventana] ?? (ventana === 'cinco' ? ajustes.topeCinco : ajustes.topeSemana)

const RANGO: Record<Estado, number> = { 'sin-datos': 0, libre: 1, normal: 2, cerrando: 3, frenado: 4 }

export const evaluar = (lectura: Lectura, ajustes: Ajustes, propios?: TopesCarpeta): Evaluacion => {
  let estado: Estado = 'sin-datos'
  let manda: Evaluacion['manda']
  let faltan: number | undefined
  let avisoCinco = false

  for (const ventana of ['cinco', 'semana'] as const) {
    const v = lectura[ventana]
    if (v === undefined) continue
    const tope = topeDe(ventana, ajustes, propios)
    const frena = ventana === 'semana' || ajustes.cincoFrena
    let propio: Estado
    if (tope >= 100) propio = 'libre'
    else if (!frena) {
      avisoCinco ||= v.uso >= tope
      propio = 'normal'
    } else if (v.uso >= tope) propio = 'frenado'
    else if (v.uso >= tope - ajustes.margen) propio = 'cerrando'
    else propio = 'normal'

    if (frena && tope < 100) {
      const resta = Math.max(0, Math.round((tope - v.uso) * 10) / 10)
      // Una ventana frenada manda sobre cualquier otra.
      const yaFrenada = manda !== undefined && faltan === 0
      if (!yaFrenada && (faltan === undefined || resta < faltan)) {
        faltan = resta
        manda = ventana
      }
    }
    if (RANGO[propio] > RANGO[estado]) estado = propio
  }
  return { estado, manda, faltan, avisoCinco }
}

/** El siguiente escalón de desbloqueo que conviene sugerir. */
export const siguienteNivel = (tope: number) => (tope < 90 ? 90 : 100)

/** `/cuota` es la ventana de 5 h en los dos idiomas; la semanal tiene su comando en cada uno. */
export const comandoDe = (ventana: VentanaId, idioma: Idioma) =>
  ventana === 'cinco' ? 'cuota' : idioma === 'es' ? 'cuotasemanal' : 'cuotaweek'

/** `C:\proyectos\app\` y `c:/proyectos/app` son la misma carpeta. */
export const claveDe = (ruta: string) => {
  const r = ruta.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(r) ? r.toLowerCase() : r
}

export const padreDe = (ruta: string) => {
  const r = ruta.replace(/[\\/]+$/, '')
  const corte = Math.max(r.lastIndexOf('/'), r.lastIndexOf('\\'))
  if (corte < 0) return undefined
  const padre = r.slice(0, corte)
  // `D:` → `D:\`, `` → `/`: la raíz sigue siendo raíz.
  if (/^[A-Za-z]:$/.test(padre)) return padre + r[corte]
  return padre === '' ? r[corte] : padre
}

/** A qué carpetas va un cambio; sin objetivo, a la carpeta actual. */
export type Objetivo = { tipo: 'todas' } | { tipo: 'sobre'; n: number } | { tipo: 'nombres'; nombres: string[] }

/** Interpreta lo que viene después de `/cuota` o `/cuotasemanal`. */
export type Orden =
  | { tipo: 'ver' }
  | { tipo: 'fijar'; tope: number; objetivo?: Objetivo; temporal?: true }
  | { tipo: 'quitar'; objetivo?: Objetivo }
  | { tipo: 'lista' }
  | { tipo: 'ayuda'; error?: string }

const numero = (t: string) => {
  if (!/^\d{1,3}%?$/.test(t)) return undefined
  const n = parseInt(t, 10)
  return n >= 1 && n <= 100 ? n : undefined
}

export const ordenDe = (args: string): Orden => {
  const a = args.trim().toLowerCase().replace(/\s*%$/, '')
  if (a === '') return { tipo: 'ver' }
  if (['lista', 'list', 'todas', 'all'].includes(a)) return { tipo: 'lista' }
  if (['ayuda', 'help', '?'].includes(a)) return { tipo: 'ayuda' }

  const [orden, ...resto] = a.split(/\s+/)
  const error = { tipo: 'ayuda', error: a } as const
  // `100-temporal`: lo temporal va pegado al límite; separado, "temporal" sería el nombre de una carpeta.
  const pegadoTemporal = /^(.+)-(?:temporal|temp)$/.exec(orden)
  const primero = pegadoTemporal ? pegadoTemporal[1] : orden
  const temporal = pegadoTemporal !== null
  let base: { tipo: 'fijar'; tope: number } | { tipo: 'quitar' }
  if (['default', 'reset', 'quitar', 'remove'].includes(primero)) base = { tipo: 'quitar' }
  else if (['libre', 'free'].includes(primero)) base = { tipo: 'fijar', tope: 100 }
  else {
    const n = numero(primero)
    if (n === undefined) return error
    base = { tipo: 'fijar', tope: n }
  }

  let objetivo: Objetivo | undefined
  const nombres: string[] = []
  for (let i = 0; i < resto.length; i++) {
    const t = resto[i]
    const pegado = /^(?:sobre|over|>)-?(\d{1,3})%?$/.exec(t)
    if (['todas', 'all'].includes(t)) objetivo = { tipo: 'todas' }
    else if (pegado) objetivo = { tipo: 'sobre', n: Number(pegado[1]) }
    else if (['sobre', 'over', '>'].includes(t) && numero(resto[i + 1] ?? '') !== undefined) {
      objetivo = { tipo: 'sobre', n: numero(resto[++i]) as number }
    } else nombres.push(t)
  }
  if (nombres.length > 0) {
    if (objetivo) return error
    objetivo = { tipo: 'nombres', nombres }
  }
  // "Todas" y "sobre" son para regresar al default; subir se hace por nombre.
  if (base.tipo === 'fijar' && objetivo && objetivo.tipo !== 'nombres') return error
  if (temporal && base.tipo !== 'fijar') return error
  return { ...base, ...(objetivo ? { objetivo } : {}), ...(temporal ? { temporal: true as const } : {}) }
}

/** La política de una carpeta después de cambiar una ventana; `undefined` si ya no le queda nada propio. */
export const aplicar = (
  p: Politica | undefined,
  ruta: string,
  ventana: VentanaId,
  tope: number | undefined,
  desde: string,
  hasta?: string,
): Politica | undefined => {
  const previos = propiosDe(p) ?? {}
  const temporal = { ...p?.temporal }
  // Un temporal sobre otro temporal regresa al valor de antes del primero.
  const antes = temporal[ventana] ? temporal[ventana].antes : previos[ventana]
  delete temporal[ventana]
  const nueva: Politica = { ...previos, ruta: p?.ruta ?? ruta, desde }
  if (tope === undefined) delete nueva[ventana]
  else nueva[ventana] = tope
  if (hasta) temporal[ventana] = antes === undefined ? { hasta } : { hasta, antes }
  if (temporal.cinco || temporal.semana) nueva.temporal = temporal
  return nueva.cinco === undefined && nueva.semana === undefined ? undefined : nueva
}

/** Regresa a su valor anterior los límites temporales cuya ventana ya se reinició. */
export const sinVencidos = (todas: Record<string, Politica>, ahora: number) => {
  let cambio = false
  const r: Record<string, Politica> = {}
  for (const [clave, p] of Object.entries(todas)) {
    let q: Politica | undefined = p
    for (const v of ['cinco', 'semana'] as const) {
      const t = q?.temporal?.[v]
      if (q === undefined || t === undefined || Date.parse(t.hasta) > ahora) continue
      cambio = true
      q = aplicar(q, q.ruta, v, t.antes, q.desde)
    }
    if (q) r[clave] = q
  }
  return { todas: r, cambio }
}

const segmentos = (ruta: string) => claveDe(ruta).split('/').filter(Boolean)

/** El nombre corto de cada ruta: el de la carpeta, o padre/carpeta si el nombre se repite. */
export const nombresCortos = (rutas: readonly string[]) => {
  const ultimo = (r: string) => segmentos(r).slice(-1)[0] ?? r
  const cuenta = new Map<string, number>()
  for (const r of rutas) cuenta.set(ultimo(r).toLowerCase(), (cuenta.get(ultimo(r).toLowerCase()) ?? 0) + 1)
  const corto = new Map<string, string>()
  for (const r of rutas) {
    const s = r.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
    corto.set(r, (cuenta.get(ultimo(r).toLowerCase()) ?? 0) > 1 ? s.slice(-2).join('/') : (s.slice(-1)[0] ?? r))
  }
  return corto
}

/** Las rutas que terminan en `nombre` (una carpeta o padre/carpeta), sin distinguir mayúsculas. */
export const buscar = (nombre: string, rutas: readonly string[]) => {
  const n = segmentos(nombre).join('/').toLowerCase()
  return rutas.filter(r => {
    const k = segmentos(r).join('/').toLowerCase()
    return n !== '' && (k === n || k.endsWith('/' + n))
  })
}

// ---------------------------------------------------------------- textos
// Lo que ve el usuario dice "límite" (en inglés "cap"); en el código sigue siendo `tope`.

const T = {
  es: {
    semana: 'semana',
    limite: 'límite',
    quedan: (n: number) => `quedan ${n}%`,
    sinLimite: 'sin límite',
    sinDatos: 'sin lectura todavía',
    cerrando: 'cerca del límite',
    frenado: 'frenado',
    sobreLimite: 'sobre el límite',
    paraSeguir: (c: string, n: number) => `/${c} ${n} para seguir`,
  },
  en: {
    semana: 'week',
    limite: 'cap',
    quedan: (n: number) => `${n}% left`,
    sinLimite: 'no cap',
    sinDatos: 'no reading yet',
    cerrando: 'near the cap',
    frenado: 'braked',
    sobreLimite: 'over cap',
    paraSeguir: (c: string, n: number) => `/${c} ${n} to go on`,
  },
} as const

const pct = (n: number) => `${Math.round(n)}%`

export const lineaDeEstado = (
  lectura: Lectura,
  ev: Evaluacion,
  ajustes: Ajustes,
  idioma: Idioma,
  propios?: TopesCarpeta,
) => {
  const t = T[idioma]
  if (ev.estado === 'sin-datos') return t.sinDatos
  const tc = topeDe('cinco', ajustes, propios)
  const ts = topeDe('semana', ajustes, propios)
  const iguales = tc === ts
  const limiteDe = (tope: number) => (tope >= 100 ? t.sinLimite : `${t.limite} ${tope}%`)

  const partes: string[] = []
  if (ev.estado === 'frenado') partes.push(t.frenado)
  else if (ev.estado === 'cerrando') partes.push(t.cerrando)

  if (lectura.cinco) {
    const extra = [iguales ? '' : limiteDe(tc), ev.avisoCinco ? t.sobreLimite : ''].filter(Boolean).join(', ')
    partes.push(`5 h ${pct(lectura.cinco.uso)}${extra ? ` (${extra})` : ''}`)
  }
  if (lectura.semana) partes.push(`${t.semana} ${pct(lectura.semana.uso)}${iguales ? '' : ` (${limiteDe(ts)})`}`)

  if (iguales) partes.push(limiteDe(tc))
  if (ev.faltan !== undefined && ev.estado !== 'frenado') partes.push(t.quedan(ev.faltan))
  if (ev.estado === 'frenado' && ev.manda) {
    partes.push(t.paraSeguir(comandoDe(ev.manda, idioma), siguienteNivel(topeDe(ev.manda, ajustes, propios))))
  }
  return partes.join(' · ')
}

const nombreVentana = (v: VentanaId, idioma: Idioma) =>
  v === 'cinco' ? (idioma === 'es' ? 'la ventana de 5 h' : 'the 5-hour window') : idioma === 'es' ? 'la semana' : 'the week'

export const textos = {
  /**
   * Lo que lee el modelo (no el usuario) al cambiar de estado. Cerca del límite solo informa: el trabajo
   * sigue igual de completo. En el límite pide pausar en un punto seguro, guardar el avance y dar opciones.
   * Un agente (`agente`) le entrega su avance a quien lo lanzó en vez de hablarle al usuario.
   */
  avisoModelo: (
    idioma: Idioma,
    frenado: boolean,
    agente: boolean,
    ventana: VentanaId,
    uso: number,
    tope: number,
    reinicio?: string,
  ) => {
    const es = idioma === 'es'
    const nombre = nombreVentana(ventana, idioma)
    const cuando = reinicio ? ` (${fechaDe(reinicio)})` : ''
    const seguir = `/${comandoDe(ventana, idioma)} ${siguienteNivel(tope)}`
    if (!frenado) {
      return es
        ? `Aviso del mod Cuota, no del usuario: ${nombre} del plan va en ${uso}% y esta carpeta tiene límite ${tope}% (quedan ${Math.max(tope - uso, 0)}%). Sigue con lo que el usuario pidió, con la calidad y el detalle de siempre: no recortes el trabajo ni resumas respuestas por este aviso. Ve dejando el avance en un estado que se pueda reanudar. Si se llega al límite, este mod te avisará. No hace falta mencionarle este aviso al usuario: lo ve en su línea de estado.`
        : `Notice from the Cuota mod, not from the user: ${nombre} of the plan is at ${uso}% and this folder has a ${tope}% cap (${Math.max(tope - uso, 0)}% left). Keep doing what the user asked, with the usual quality and detail: do not cut the work short or summarize answers because of this notice. Keep your progress in a state that can be resumed. If the cap is reached, this mod will tell you. There is no need to mention this notice to the user: they see it in the status line.`
    }
    const inicio = es
      ? `Aviso del mod Cuota, no del usuario: esta carpeta llegó a su límite de ${tope}% en ${nombre} del plan (va en ${uso}%).`
      : `Notice from the Cuota mod, not from the user: this folder reached its ${tope}% cap on ${nombre} of the plan (now at ${uso}%).`
    if (agente) return `${inicio} ${textos.mensajeAgente(idioma).replace(/^[^.]+\. /, '')}`
    return es
      ? `${inicio} Pausa la tarea en el siguiente punto seguro: termina el paso en curso y guarda el avance donde el proyecto lo guarde (qué quedó hecho, qué falta, siguiente paso). No empieces pasos nuevos ni lances agentes. Luego dile al usuario, en pocas palabras, que pausaste para no gastar la cuota que esta carpeta deja en reserva, dónde quedó el avance y sus dos opciones: seguir ahora con ${seguir}, usando esa reserva, o retomar después del reinicio${cuando}. Si el usuario pide seguir, sigue.`
      : `${inicio} Pause the task at the next safe point: finish the current step and save the progress where the project keeps it (what is done, what is left, next step). Do not start new steps or launch agents. Then tell the user, briefly, that you paused so as not to spend the usage this folder keeps in reserve, where the progress is, and their two options: go on now with ${seguir}, using that reserve, or resume after the reset${cuando}. If the user asks you to go on, go on.`
  },

  avisoLevantado: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Aviso del mod Cuota, no del usuario: esta carpeta ya no está cerca de su límite de uso; el aviso anterior ya no aplica.'
      : 'Notice from the Cuota mod, not from the user: this folder is no longer close to its usage cap; the earlier notice no longer applies.',

  mensajeAgente: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Cuota del plan: esta carpeta llegó a su límite. Pausa en el siguiente punto seguro: termina el paso en curso y entrega tu avance completo, sin resumirlo, con lo que falta y cómo retomarlo. No empieces pasos nuevos ni lances agentes.'
      : 'Plan usage: this folder reached its cap. Pause at the next safe point: finish the current step and hand back your full progress, without summarizing it, with what is left and how to resume. Do not start new steps or launch agents.',

  toastCerrando: (idioma: Idioma, ventana: VentanaId, faltan: number) =>
    idioma === 'es'
      ? `Quedan ${faltan}% antes del límite en ${nombreVentana(ventana, idioma)}: Claude ya está avisado.`
      : `${faltan}% left before the cap on ${nombreVentana(ventana, idioma)}: Claude has been told.`,

  toastFrenado: (idioma: Idioma, ventana: VentanaId, nivel: number) =>
    idioma === 'es'
      ? `Límite alcanzado en ${nombreVentana(ventana, idioma)}. Lo que esté haciendo Claude se completa sin cortarse; los mensajes nuevos de esta carpeta esperan. /${comandoDe(ventana, idioma)} ${nivel} para seguir.`
      : `Cap reached on ${nombreVentana(ventana, idioma)}. Whatever Claude is doing finishes without being cut off; new messages in this folder wait. /${comandoDe(ventana, idioma)} ${nivel} to go on.`,

  toastAvisoCinco: (idioma: Idioma, tope: number) =>
    idioma === 'es'
      ? `La ventana de 5 h pasó el ${tope}%. Solo aviso: no frena (así está configurada).`
      : `The 5-hour window passed ${tope}%. Warning only: it does not brake (as configured).`,

  rechazoPrompt: (idioma: Idioma, ventana: VentanaId, nivel: number) => {
    const c = comandoDe(ventana, idioma)
    return idioma === 'es'
      ? `cuota: esta carpeta llegó a su límite en ${nombreVentana(ventana, idioma)}. Escribe /${c} ${nivel} para subirlo, /${c} 100 para dejarla sin límite, o espera el reinicio.`
      : `cuota: this folder reached its cap on ${nombreVentana(ventana, idioma)}. Type /${c} ${nivel} to raise it, /${c} 100 to remove the cap, or wait for the reset.`
  },

  rechazoAgente: (idioma: Idioma) =>
    idioma === 'es'
      ? 'cuota: esta carpeta llegó a su límite de uso; no se lanzan agentes nuevos. Termina con lo que tienes y díselo al usuario.'
      : 'cuota: this folder reached its usage cap; no new agents start. Finish with what you have and tell the user.',

  // La superficie antepone "cuota: " a la salida de un comando: el texto empieza ya con la explicación.
  ayuda: (idioma: Idioma, error?: string) => {
    const s = `/${comandoDe('semana', idioma)}`
    const col = (c: string) => `${c}:`
    return (
      (error ? (idioma === 'es' ? `No entendí "${error}".\n\n` : `Did not understand "${error}".\n\n`) : '') +
      (idioma === 'es'
        ? [
            'Límite de uso del plan por carpeta. /cuota es para la ventana de 5 h y ' + s + ' para la semanal. Comandos:',
            `  ${col('/cuota')} muestra los límites y el uso de esta carpeta`,
            `  ${col('/cuota 90')} sube el límite de 5 h de esta carpeta a 90% (cualquier número del 1 al 100)`,
            `  ${col(`${s} 90`)} lo mismo con el límite semanal`,
            `  ${col('/cuota 100')} deja la ventana de 5 h sin límite (también: libre)`,
            `  ${col('/cuota default')} regresa la de 5 h al límite de todas las carpetas`,
            `  ${col(`${s} default`)} lo mismo con la semanal`,
            `  ${col('/cuota lista')} las carpetas con límite propio y su nombre corto`,
            `  ${col('/cuota 100-temporal')} sin límite hasta que se reinicie la ventana; después regresa solo`,
            `  ${col('/cuota 85 lora-baker nova')} cambia varias carpetas por su nombre`,
            `  ${col('/cuota default lora-baker nova')} regresa varias carpetas al límite de todas`,
            `  ${col('/cuota default sobre-80')} regresa solo las que están arriba de 80%`,
            `  ${col('/cuota default todas')} regresa todas las carpetas`,
          ]
        : [
            'Plan usage cap per folder. /cuota is for the 5-hour window and ' + s + ' for the weekly one. Commands:',
            `  ${col('/cuota')} shows this folder's caps and usage`,
            `  ${col('/cuota 90')} raises this folder's 5-hour cap to 90% (any number from 1 to 100)`,
            `  ${col(`${s} 90`)} the same for the weekly cap`,
            `  ${col('/cuota 100')} removes the 5-hour cap (also: free)`,
            `  ${col('/cuota default')} back to the default 5-hour cap`,
            `  ${col(`${s} default`)} the same for the weekly cap`,
            `  ${col('/cuota list')} folders with their own caps and their short names`,
            `  ${col('/cuota 100-temp')} no cap until the window resets; then it goes back by itself`,
            `  ${col('/cuota 85 lora-baker nova')} changes several folders by name`,
            `  ${col('/cuota default lora-baker nova')} sets several folders back to the default`,
            `  ${col('/cuota default over-80')} only the ones above 80%`,
            `  ${col('/cuota default all')} every folder`,
          ]
      ).join('\n')
    )
  },

  sinPropias: (idioma: Idioma) =>
    idioma === 'es' ? 'Ninguna carpeta tiene límite propio.' : 'No folder has its own cap.',

  lista: (idioma: Idioma, todas: readonly Politica[]) => {
    const es = idioma === 'es'
    const cortos = nombresCortos(todas.map(p => p.ruta))
    const de = (p: Politica, v: VentanaId) => {
      const n = propiosDe(p)?.[v]
      const valor = n === undefined ? (es ? 'el de todas' : 'default') : n >= 100 ? (es ? 'sin límite' : 'no cap') : `${n}%`
      const t = p.temporal?.[v]
      return t ? `${valor} ${es ? 'hasta' : 'until'} ${fechaDe(t.hasta)}` : valor
    }
    return [
      es ? 'Carpetas con límite propio (el nombre de la izquierda es el que se escribe en los comandos):' : 'Folders with their own caps (the name on the left is the one to type in commands):',
      ...[...todas]
        .sort((a, b) => a.ruta.localeCompare(b.ruta))
        .map(p => `  ${cortos.get(p.ruta)}: 5 h ${de(p, 'cinco')} · ${es ? 'semana' : 'week'} ${de(p, 'semana')} (${p.ruta})`),
    ].join('\n')
  },

  enLote: (idioma: Idioma, ventana: VentanaId, tope: number | undefined, defecto: number, nombres: readonly string[], hasta?: string) => {
    const es = idioma === 'es'
    const cual = cualVentana(ventana, idioma)
    const lista = nombres.join(', ')
    const temporal = hasta ? (es ? ` hasta el reinicio (${fechaDe(hasta)})` : ` until the reset (${fechaDe(hasta)})`) : ''
    if (tope === undefined) {
      return es
        ? `Listo: regresaron al límite ${cual} de todas las carpetas (${defecto}%): ${lista}.`
        : `Done: back to the default ${cual} cap (${defecto}%): ${lista}.`
    }
    const valor = tope >= 100 ? (es ? 'sin límite' : 'no cap') : es ? `límite ${tope}%` : `cap ${tope}%`
    return es ? `Listo: ${valor} ${cual}${temporal} en ${lista}.` : `Done: ${cual} ${valor}${temporal} for ${lista}.`
  },

  ninguna: (idioma: Idioma, ventana: VentanaId, sobre?: number) => {
    const es = idioma === 'es'
    const cual = cualVentana(ventana, idioma)
    if (sobre !== undefined) {
      return es ? `Ninguna carpeta tiene límite ${cual} arriba de ${sobre}%. No cambié nada.` : `No folder has a ${cual} cap above ${sobre}%. Nothing changed.`
    }
    return es ? `Ninguna carpeta tiene límite ${cual} propio. No cambié nada.` : `No folder has its own ${cual} cap. Nothing changed.`
  },

  noEncontre: (idioma: Idioma, nombre: string) =>
    idioma === 'es'
      ? `No encontré "${nombre}" entre las carpetas con límite propio ni en la actual. /cuota lista muestra los nombres. No cambié nada.`
      : `Could not find "${nombre}" among the folders with their own caps or the current one. /cuota list shows the names. Nothing changed.`,

  ambiguo: (idioma: Idioma, nombre: string, opciones: readonly string[]) =>
    idioma === 'es'
      ? `"${nombre}" coincide con varias carpetas: ${opciones.join(', ')}. Escribe uno de esos nombres. No cambié nada.`
      : `"${nombre}" matches several folders: ${opciones.join(', ')}. Type one of those names. Nothing changed.`,

  sinReinicio: (idioma: Idioma, ventana: VentanaId) =>
    idioma === 'es'
      ? `Todavía no hay lectura de la ventana ${cualVentana(ventana, idioma)}, así que no sé cuándo se reinicia. Prueba después de la primera respuesta. No cambié nada.`
      : `No reading of the ${cualVentana(ventana, idioma)} window yet, so its reset time is unknown. Try after the first response. Nothing changed.`,

  descripcionCinco: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Límite de uso de 5 h para esta carpeta: ver, subir (90, 100, n) o volver al de todas (default)'
      : "This folder's 5-hour usage cap: show, raise (90, 100, n) or reset (default)",

  descripcionSemana: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Límite de uso semanal para esta carpeta: ver, subir (90, 100, n) o volver al de todas (default)'
      : "This folder's weekly usage cap: show, raise (90, 100, n) or reset (default)",
}

const cualVentana = (v: VentanaId, idioma: Idioma) =>
  v === 'cinco' ? (idioma === 'es' ? 'de 5 h' : '5-hour') : idioma === 'es' ? 'semanal' : 'weekly'

const fechaDe = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const hora = (iso: string | undefined, idioma: Idioma) => {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return ''
  return idioma === 'es' ? ` · se reinicia ${fechaDe(iso)}` : ` · resets ${fechaDe(iso)}`
}

export const informe = (
  carpeta: string,
  lectura: Lectura,
  ev: Evaluacion,
  ajustes: Ajustes,
  idioma: Idioma,
  propios?: TopesCarpeta,
  cambio?: VentanaId,
  temporal?: { hasta: string; despues: number },
) => {
  const es = idioma === 'es'

  const ventana = (v: VentanaId) => {
    const tope = topeDe(v, ajustes, propios)
    const propio = propios?.[v] !== undefined
    const origen = propio ? (es ? 'propio de esta carpeta' : "this folder's own") : es ? 'el de todas las carpetas' : 'the default'
    const soloAvisa = v === 'cinco' && !ajustes.cincoFrena ? (es ? ', solo avisa' : ', warning only') : ''
    const limite =
      tope >= 100 ? `${es ? 'sin límite' : 'no cap'} (${origen})` : `${es ? 'límite' : 'cap'} ${tope}% (${origen}${soloAvisa})`
    const l = lectura[v]
    const usado = l ? `${pct(l.uso)} ${es ? 'usado' : 'used'}` : es ? 'sin lectura' : 'no reading'
    const nombre = v === 'cinco' ? '5 h' : es ? 'Semana' : 'Week'
    return `${nombre}: ${usado} · ${limite}${hora(l?.reinicio, idioma)}`
  }

  const quedan = ev.faltan ?? 0
  const estado = {
    'sin-datos': es
      ? 'Todavía no hay lectura de uso; aparece después de la primera respuesta.'
      : 'No usage reading yet; it shows after the first response.',
    libre: es ? 'Esta carpeta no tiene límite.' : 'This folder has no cap.',
    normal: es ? `Quedan ${quedan}% antes del límite.` : `${quedan}% left before the cap.`,
    cerrando: es
      ? `Quedan ${quedan}% antes del límite: Claude ya está avisado.`
      : `${quedan}% left before the cap: Claude has been told.`,
    frenado: es
      ? 'Límite alcanzado: los mensajes nuevos de esta carpeta esperan.'
      : 'Cap reached: new messages in this folder wait.',
  }[ev.estado]

  if (cambio) {
    const tope = topeDe(cambio, ajustes, propios)
    const cual = cambio === 'cinco' ? (es ? 'de 5 h' : '5-hour') : es ? 'semanal' : 'weekly'
    const despues = temporal
      ? es
        ? ` hasta que se reinicie la ventana (${fechaDe(temporal.hasta)}); después regresa a ${temporal.despues >= 100 ? 'sin límite' : `${temporal.despues}%`}.`
        : ` until the window resets (${fechaDe(temporal.hasta)}); then it goes back to ${temporal.despues >= 100 ? 'no cap' : `${temporal.despues}%`}.`
      : '.'
    const listo =
      temporal !== undefined
        ? (tope >= 100
            ? es
              ? `Listo: esta carpeta no tiene límite ${cual}`
              : `Done: this folder has no ${cual} cap`
            : es
              ? `Listo: el límite ${cual} de esta carpeta es ${tope}%`
              : `Done: this folder's ${cual} cap is ${tope}%`) + despues
        : propios?.[cambio] === undefined
        ? es
          ? `Listo: el límite ${cual} de esta carpeta regresó al de todas las carpetas (${tope}%).`
          : `Done: this folder's ${cual} cap is back to the default (${tope}%).`
        : tope >= 100
          ? es
            ? `Listo: esta carpeta ya no tiene límite ${cual}.`
            : `Done: this folder no longer has a ${cual} cap.`
          : es
            ? `Listo: el límite ${cual} de esta carpeta ahora es ${tope}%.`
            : `Done: this folder's ${cual} cap is now ${tope}%.`
    return [listo, '', `${es ? 'Carpeta' : 'Folder'}: ${carpeta}`, ventana('cinco'), ventana('semana'), estado].join('\n')
  }

  const col = (c: string) => `${c}:`
  const cambios: string[] = []
  for (const v of ['cinco', 'semana'] as const) {
    const c = `/${comandoDe(v, idioma)}`
    const tope = topeDe(v, ajustes, propios)
    const cual = v === 'cinco' ? (es ? 'de 5 h' : '5-hour') : es ? 'semanal' : 'weekly'
    if (tope < 100) {
      const n = siguienteNivel(tope)
      cambios.push(
        n >= 100
          ? `  ${col(`${c} 100`)} ${es ? `deja esta carpeta sin límite ${cual}` : `removes this folder's ${cual} cap`}`
          : `  ${col(`${c} ${n}`)} ${es ? `sube el límite ${cual} de esta carpeta a ${n}%` : `raises this folder's ${cual} cap to ${n}%`}`,
      )
    }
    if (propios?.[v] !== undefined) {
      cambios.push(
        `  ${col(`${c} default`)} ${es ? `regresa el límite ${cual} al de todas las carpetas` : `back to the default ${cual} cap`}`,
      )
    }
  }
  cambios.push(`  ${col(es ? '/cuota ayuda' : '/cuota help')} ${es ? 'todas las opciones' : 'every option'}`)

  return [
    es
      ? 'Límite de uso del plan por carpeta. Al llegar al límite, esta carpeta deja de aceptar mensajes nuevos; lo que esté haciendo Claude se completa sin cortarse.'
      : 'Plan usage cap per folder. At the cap, this folder stops taking new messages; whatever Claude is doing finishes without being cut off.',
    '',
    `${es ? 'Carpeta' : 'Folder'}: ${carpeta}`,
    ventana('cinco'),
    ventana('semana'),
    estado,
    '',
    es ? 'Para cambiarlo:' : 'To change it:',
    ...cambios,
  ].join('\n')
}

/** El idioma de la interfaz a partir del ajuste `language` de Claude Code: español si lo pide, si no inglés. */
export const idiomaDe = (language: unknown): Idioma =>
  typeof language === 'string' && /^(es\b|es[-_]|spa|espa|castellano)/i.test(language.trim()) ? 'es' : 'en'
