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

/** Lo que se guarda por carpeta. `tope` es de la v0.1, cuando un número valía para las dos ventanas. */
export type Politica = { cinco?: number; semana?: number; tope?: number; ruta: string; desde: string }

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

/** Interpreta lo que viene después de `/cuota` o `/cuotasemanal`. */
export type Orden =
  | { tipo: 'ver' }
  | { tipo: 'fijar'; tope: number }
  | { tipo: 'quitar' }
  | { tipo: 'lista' }
  | { tipo: 'ayuda'; error?: string }

export const ordenDe = (args: string): Orden => {
  const a = args.trim().toLowerCase().replace(/\s*%$/, '')
  if (a === '') return { tipo: 'ver' }
  if (['default', 'reset', 'quitar', 'remove'].includes(a)) return { tipo: 'quitar' }
  if (['lista', 'list', 'todas', 'all'].includes(a)) return { tipo: 'lista' }
  if (['libre', 'free'].includes(a)) return { tipo: 'fijar', tope: 100 }
  if (['ayuda', 'help', '?'].includes(a)) return { tipo: 'ayuda' }
  if (/^\d{1,3}$/.test(a)) {
    const n = Number(a)
    if (n >= 1 && n <= 100) return { tipo: 'fijar', tope: n }
  }
  return { tipo: 'ayuda', error: a }
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
    cerrando: 've cerrando',
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
    cerrando: 'wind down',
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
  seccionCierre: (idioma: Idioma, frenado: boolean) =>
    idioma === 'es'
      ? [
          'Cuota del plan: esta carpeta está cerca de su límite de uso' + (frenado ? ' y ya lo alcanzó' : '') + '.',
          'Cierra lo que tienes en curso sin abrir frentes nuevos: termina el paso actual, deja escrito el estado',
          '(qué quedó hecho, qué falta, siguiente paso) donde el proyecto lo guarde, y no lances agentes nuevos.',
          'Dilo en una línea al usuario al terminar.',
        ].join(' ')
      : [
          'Plan usage: this folder is close to its usage cap' + (frenado ? ' and has reached it' : '') + '.',
          'Wrap up what is in progress without starting anything new: finish the current step, write down the state',
          '(what is done, what is left, next step) where the project keeps it, and do not launch new agents.',
          'Tell the user in one line when done.',
        ].join(' '),

  mensajeAgente: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Cuota del plan: esta carpeta llegó a su límite. Termina el paso en que vas, entrega lo que tengas con lo que falta, y no abras trabajo nuevo.'
      : 'Plan usage: this folder reached its cap. Finish your current step, hand back what you have with what is left, and start nothing new.',

  toastCerrando: (idioma: Idioma, ventana: VentanaId, faltan: number) =>
    idioma === 'es'
      ? `Quedan ${faltan}% antes del límite en ${nombreVentana(ventana, idioma)}: le pedí a Claude que vaya cerrando.`
      : `${faltan}% left before the cap on ${nombreVentana(ventana, idioma)}: Claude was asked to wind down.`,

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
    const col = (c: string) => c.padEnd(22)
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
            `  ${col('/cuota lista')} las carpetas con límite propio`,
          ]
        : [
            'Plan usage cap per folder. /cuota is for the 5-hour window and ' + s + ' for the weekly one. Commands:',
            `  ${col('/cuota')} shows this folder's caps and usage`,
            `  ${col('/cuota 90')} raises this folder's 5-hour cap to 90% (any number from 1 to 100)`,
            `  ${col(`${s} 90`)} the same for the weekly cap`,
            `  ${col('/cuota 100')} removes the 5-hour cap (also: free)`,
            `  ${col('/cuota default')} back to the default 5-hour cap`,
            `  ${col(`${s} default`)} the same for the weekly cap`,
            `  ${col('/cuota list')} folders with their own caps`,
          ]
      ).join('\n')
    )
  },

  sinPropias: (idioma: Idioma) =>
    idioma === 'es' ? 'Ninguna carpeta tiene límite propio.' : 'No folder has its own cap.',

  lista: (idioma: Idioma, todas: readonly Politica[]) => {
    const es = idioma === 'es'
    const de = (n?: number) => (n === undefined ? (es ? 'el de todas' : 'default') : n >= 100 ? (es ? 'sin límite' : 'no cap') : `${n}%`)
    return [...todas]
      .sort((a, b) => a.ruta.localeCompare(b.ruta))
      .map(p => {
        const t = propiosDe(p) ?? {}
        return `${p.ruta}  (${p.desde})\n  5 h: ${de(t.cinco)} · ${es ? 'semana' : 'week'}: ${de(t.semana)}`
      })
      .join('\n')
  },

  descripcionCinco: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Límite de uso de 5 h para esta carpeta: ver, subir (90, 100, n) o volver al de todas (default)'
      : "This folder's 5-hour usage cap: show, raise (90, 100, n) or reset (default)",

  descripcionSemana: (idioma: Idioma) =>
    idioma === 'es'
      ? 'Límite de uso semanal para esta carpeta: ver, subir (90, 100, n) o volver al de todas (default)'
      : "This folder's weekly usage cap: show, raise (90, 100, n) or reset (default)",
}

const hora = (iso: string | undefined, idioma: Idioma) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  const fecha = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return idioma === 'es' ? ` · se reinicia ${fecha}` : ` · resets ${fecha}`
}

export const informe = (
  carpeta: string,
  lectura: Lectura,
  ev: Evaluacion,
  ajustes: Ajustes,
  idioma: Idioma,
  propios?: TopesCarpeta,
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
      ? `Quedan ${quedan}% antes del límite: Claude está cerrando lo que trae.`
      : `${quedan}% left before the cap: Claude is wrapping up.`,
    frenado: es
      ? 'Límite alcanzado: los mensajes nuevos de esta carpeta esperan.'
      : 'Cap reached: new messages in this folder wait.',
  }[ev.estado]

  const col = (c: string) => c.padEnd(22)
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
