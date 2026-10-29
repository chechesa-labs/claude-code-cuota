import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'
import {
  type Ajustes,
  type Estado,
  type Evaluacion,
  type Idioma,
  type Lectura,
  type Politica,
  type Objetivo,
  type TopesCarpeta,
  type VentanaId,
  aplicar,
  buscar,
  claveDe,
  evaluar,
  idiomaDe,
  informe,
  leer,
  lineaDeEstado,
  nombresCortos,
  ordenDe,
  padreDe,
  propiosDe,
  siguienteNivel,
  sinVencidos,
  textos,
  topeDe,
  vigente,
} from './politica'

type Politicas = Record<string, Politica>

const CLAVE_STORE = 'politicas'
const CLAVE_LECTURA = 'ultimaLectura'

// En el límite solo se detiene lo que manda el usuario (o algo suyo programado) para empezar trabajo
// nuevo. Lo demás pasa: agentes, tareas y otras sesiones, porque ahí llega el avance que un agente
// entrega al pausar (probado 2026-10-29: detenerlo dejaba el informe sin leer).
const FRENABLES = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'auto-continuation', 'slack-ping', 'channel'])

// Lo de esta activación. Un recargo del mod lo reinicia y session.start lo vuelve a llenar;
// las políticas viven en $.store y sobreviven.
let ajustes: Ajustes = { topeCinco: 80, topeSemana: 80, cincoFrena: true, margen: 10 }
let idioma: Idioma = 'es'
let idiomaElegido = 'auto'
let webhook = ''
let carpeta: string | undefined
let lectura: Lectura = {}
let ultimo: Estado = 'sin-datos'
let avisoCincoDado = false
const agentesAvisados = new Set<string>()
// El estado que ya conoce cada loop ('' es la conversación principal), para avisarle solo cuando cambia.
const avisados = new Map<string, Estado>()
let ultimoEv: Evaluacion = { estado: 'sin-datos', avisoCinco: false }
let ultimosPropios: TopesCarpeta | undefined

/** El aviso para un loop que todavía no conoce el estado actual; undefined si ya lo conoce. */
function avisoNuevo(loop: string): string | undefined {
  const { estado, manda } = ultimoEv
  const antes = avisados.get(loop)
  if (estado === antes || estado === 'sin-datos') return undefined
  if ((estado === 'cerrando' || estado === 'frenado') && manda) {
    avisados.set(loop, estado)
    const uso = Math.round(lectura[manda]?.uso ?? 0)
    const tope = topeDe(manda, ajustes, ultimosPropios)
    return textos.avisoModelo(idioma, estado === 'frenado', loop !== '', manda, uso, tope, lectura[manda]?.reinicio)
  }
  avisados.delete(loop)
  return antes === undefined ? undefined : textos.avisoLevantado(idioma)
}

/** Las políticas guardadas, con los límites temporales vencidos ya regresados a su valor anterior. */
async function politicas($: EngineInterface): Promise<Politicas> {
  const v = await $.store.get(CLAVE_STORE)
  const guardadas = v !== null && typeof v === 'object' ? (v as Politicas) : {}
  const { todas, cambio } = sinVencidos(guardadas, await $.clock.now())
  if (cambio) await $.store.set(CLAVE_STORE, todas)
  return todas
}

/** Las claves de carpeta a las que va un cambio, o el texto que explica por qué no se cambió nada. */
function destinos(todas: Politicas, raiz: string, ventana: VentanaId, objetivo?: Objetivo): string[] | string {
  if (objetivo === undefined) return [claveDe(raiz)]
  const propio = (k: string) => propiosDe(todas[k])?.[ventana]
  if (objetivo.tipo === 'todas' || objetivo.tipo === 'sobre') {
    const sobre = objetivo.tipo === 'sobre' ? objetivo.n : undefined
    const claves = Object.keys(todas).filter(k => {
      const n = propio(k)
      return n !== undefined && (sobre === undefined || n > sobre)
    })
    return claves.length > 0 ? claves : textos.ninguna(idioma, ventana, sobre)
  }
  // Por nombre: entre las carpetas con límite propio y la actual. Si un nombre falla, no se cambia ninguna.
  const rutas = [...new Set([...Object.values(todas).map(p => p.ruta), raiz].map(r => r))]
  const unicas = [...new Map(rutas.map(r => [claveDe(r), r])).values()]
  const cortos = nombresCortos(unicas)
  const claves = new Set<string>()
  for (const nombre of objetivo.nombres) {
    const hallados = buscar(nombre, unicas)
    if (hallados.length === 0) return textos.noEncontre(idioma, nombre)
    if (hallados.length > 1) return textos.ambiguo(idioma, nombre, hallados.map(r => cortos.get(r) ?? r))
    claves.add(claveDe(hallados[0]))
  }
  return [...claves]
}

async function propiosCarpeta($: EngineInterface) {
  return carpeta === undefined ? undefined : propiosDe((await politicas($))[claveDe(carpeta)])
}

/** La raíz del repositorio git que contiene `cwd`; sin git, el propio `cwd`. */
async function raizDe($: EngineInterface, cwd: string) {
  for (let dir: string | undefined = cwd; dir !== undefined; dir = padreDe(dir)) {
    if (await $.fs.exists(`${dir.replace(/[\\/]+$/, '')}/.git`).catch(() => false)) return dir
    if (padreDe(dir) === dir) break
  }
  return cwd
}

async function asegurarCarpeta($: EngineInterface) {
  carpeta ??= await raizDe($, await $.session.root())
  return carpeta
}

async function avisar($: EngineInterface, evento: string, extra: Record<string, unknown> = {}) {
  if (webhook === '') return
  const cuerpo = {
    evento,
    session: await $.session.id(),
    cwd: await $.session.cwd(),
    carpeta,
    politica: { propios: await propiosCarpeta($), ...ajustes },
    lectura,
    ...extra,
  }
  await $.http
    .fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    .catch(() => undefined)
}

async function avisarAgentes($: EngineInterface) {
  const agentes = await $.agent.list().catch(() => [])
  for (const a of agentes) {
    if (agentesAvisados.has(a.id)) continue
    if (a.status !== 'running' && a.status !== 'pending' && a.status !== 'waiting') continue
    agentesAvisados.add(a.id)
    await $.session.send({ to: { agentId: a.id }, text: textos.mensajeAgente(idioma) }).catch(() => undefined)
  }
}

/** Recalcula el estado, pinta la línea y avisa en las transiciones. */
async function refrescar($: EngineInterface) {
  await asegurarCarpeta($)
  await lecturaVigente($)
  const propios = await propiosCarpeta($)
  const ev = evaluar(lectura, ajustes, propios)
  ultimoEv = ev
  ultimosPropios = propios
  $.ui.status(lineaDeEstado(lectura, ev, ajustes, idioma, propios))

  if (ev.estado !== ultimo) {
    if (ev.estado === 'cerrando' && ultimo !== 'frenado' && ev.manda) {
      $.ui.toast(textos.toastCerrando(idioma, ev.manda, ev.faltan ?? 0), { timeoutMs: 8000 })
    }
    if (ev.estado === 'frenado' && ev.manda) {
      $.ui.toast(textos.toastFrenado(idioma, ev.manda, siguienteNivel(topeDe(ev.manda, ajustes, propios))), {
        timeoutMs: 10000,
      })
      await avisarAgentes($)
    }
    if (ultimo !== 'sin-datos' || ev.estado === 'frenado') await avisar($, 'estado', { de: ultimo, a: ev.estado })
    ultimo = ev.estado
  }
  if (ev.avisoCinco && !avisoCincoDado) $.ui.toast(textos.toastAvisoCinco(idioma, topeDe('cinco', ajustes, propios)))
  avisoCincoDado = ev.avisoCinco
  return { ev, propios }
}

/** La cuota es de la cuenta: la última lectura de cualquier sesión sirve a las demás. */
async function tomar($: EngineInterface, limites: readonly SessionRateLimit[]) {
  if (limites.length === 0) return
  lectura = leer(limites)
  await $.store.set(CLAVE_LECTURA, lectura)
}

/**
 * La última lectura de cualquier sesión, sin las ventanas cuyo reinicio ya pasó. Sin esto, una sesión
 * frenada se quedaba con el porcentaje viejo para siempre: solo se mide tras una respuesta, y el freno
 * no deja que haya respuesta.
 */
async function lecturaVigente($: EngineInterface) {
  const v = await $.store.get(CLAVE_LECTURA)
  const base = v !== null && typeof v === 'object' ? (v as Lectura) : lectura
  lectura = vigente(base, await $.clock.now())
}

/** `auto` sigue el ajuste `language` de Claude Code; `es` o `en` lo fijan. */
async function resolverIdioma($: EngineInterface) {
  if (idiomaElegido === 'es' || idiomaElegido === 'en') return
  const ajustesClaude = await $.settings.read().catch(() => undefined)
  idioma = idiomaDe(ajustesClaude?.language)
}

/** `/cuota` (ventana de 5 h) y el de la semanal en el idioma de la interfaz. */
async function registrarComandos($: EngineInterface) {
  const pista = '[90 | 100 | n | default | lista]'
  try {
    await $.command.register({ name: 'cuota', description: textos.descripcionCinco(idioma), argumentHint: pista, immediate: true })
  } catch {
    // Si el nombre choca con otro comando, lo demás del mod sigue funcionando.
  }
  try {
    // `/quota`: el mismo comando para quien lo teclea en inglés.
    await $.command.register({ name: 'quota', description: textos.descripcionCinco(idioma), argumentHint: pista, immediate: true })
  } catch {
    // Igual que arriba.
  }
  try {
    if (idioma === 'es') {
      await $.command.register({ name: 'cuotasemanal', description: textos.descripcionSemana(idioma), argumentHint: pista, immediate: true })
    } else {
      await $.command.register({ name: 'cuotaweek', description: textos.descripcionSemana(idioma), argumentHint: pista, immediate: true })
    }
  } catch {
    // Igual que arriba.
  }
}

async function correrComando($: EngineInterface, args: string, ventana: VentanaId) {
  const raiz = await asegurarCarpeta($)
  const orden = ordenDe(args)

  if (orden.tipo === 'ayuda') return textos.ayuda(idioma, orden.error)

  if (orden.tipo === 'lista') {
    const todas = Object.values(await politicas($))
    return todas.length === 0 ? textos.sinPropias(idioma) : textos.lista(idioma, todas)
  }

  let temporal: { hasta: string; despues: number } | undefined
  if (orden.tipo === 'fijar' || orden.tipo === 'quitar') {
    const todas = await politicas($)
    const claves = destinos(todas, raiz, ventana, orden.objetivo)
    if (typeof claves === 'string') return claves
    const tope = orden.tipo === 'fijar' ? orden.tope : undefined
    const hasta = orden.tipo === 'fijar' && orden.temporal ? lectura[ventana]?.reinicio : undefined
    if (orden.tipo === 'fijar' && orden.temporal && hasta === undefined) return textos.sinReinicio(idioma, ventana)
    const desde = new Date(await $.clock.now()).toISOString().slice(0, 10)
    // Los nombres cortos se sacan de todas las carpetas conocidas, igual que en /cuota lista.
    const conocidas = [...Object.values(todas).map(p => p.ruta), raiz]
    const rutas: string[] = []
    for (const clave of claves) {
      const ruta = todas[clave]?.ruta ?? raiz
      rutas.push(ruta)
      const nueva = aplicar(todas[clave], ruta, ventana, tope, desde, hasta)
      if (nueva === undefined) delete todas[clave]
      else todas[clave] = nueva
    }
    await $.store.set(CLAVE_STORE, todas)
    await avisar($, 'politica', { ventana, tope: tope ?? null, carpetas: rutas, ...(hasta ? { hasta } : {}) })
    if (orden.objetivo !== undefined) {
      await refrescar($)
      const cortos = nombresCortos([...new Map(conocidas.map(r => [claveDe(r), r])).values()])
      const defecto = ventana === 'cinco' ? ajustes.topeCinco : ajustes.topeSemana
      const texto = textos.enLote(idioma, ventana, tope, defecto, rutas.map(r => cortos.get(r) ?? r), hasta)
      // La respuesta de un comando corrido a mitad de turno se ve al final; el toast confirma al instante.
      $.ui.toast(texto)
      return texto
    }
    const t = todas[claveDe(raiz)]?.temporal?.[ventana]
    if (t) temporal = { hasta: t.hasta, despues: t.antes ?? (ventana === 'cinco' ? ajustes.topeCinco : ajustes.topeSemana) }
  }

  const { ev, propios } = await refrescar($)
  const cambio = orden.tipo === 'fijar' || orden.tipo === 'quitar' ? ventana : undefined
  const texto = informe(raiz, lectura, ev, ajustes, idioma, propios, cambio, temporal)
  if (cambio) $.ui.toast(texto.split('\n')[0])
  return texto
}

export const register: Register = (on, options) => {
  ajustes = {
    topeCinco: Number(options.topeCincoHoras ?? 80),
    topeSemana: Number(options.topeSemanal ?? 80),
    cincoFrena: options.cincoHorasFrena !== false,
    margen: Number(options.margenAviso ?? 10),
  }
  idiomaElegido = typeof options.idioma === 'string' ? options.idioma : 'auto'
  idioma = idiomaElegido === 'en' ? 'en' : 'es'
  webhook = typeof options.webhook === 'string' ? options.webhook.trim() : ''

  // ------------------------------------------------------------ arranque y lectura

  on('session.start', async ($, e, next) => {
    await resolverIdioma($)
    await registrarComandos($)
    const r = await next(e)
    carpeta = await raizDe($, e.cwd)
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length > 0) await tomar($, rateLimits)
    else await lecturaVigente($)
    await refrescar($)
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('rateLimits')) {
      await tomar($, e.rateLimits)
      await refrescar($)
      await avisar($, 'medicion', { rateLimits: e.rateLimits })
    }
    return r
  })

  // ------------------------------------------------------------ comandos

  on('command.run', { command: 'cuota' }, async ($, e) => ({ text: await correrComando($, e.args, 'cinco') }))
  on('command.run', { command: 'quota' }, async ($, e) => ({ text: await correrComando($, e.args, 'cinco') }))
  on('command.run', { command: 'cuotasemanal' }, async ($, e) => ({ text: await correrComando($, e.args, 'semana') }))
  on('command.run', { command: 'cuotaweek' }, async ($, e) => ({ text: await correrComando($, e.args, 'semana') }))

  // ------------------------------------------------------------ cierre y freno

  // El aviso al modelo viaja junto a lo que ya va a leer (el resultado de una herramienta o el mensaje
  // del usuario) y solo cuando cambia el estado. En el prompt de sistema reescribiría la caché en cada cambio.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    const aviso = avisoNuevo(e.agentId ?? '')
    return aviso === undefined ? r : { ...r, context: [...(r.context ?? []), aviso] }
  })

  // El resumen de una compactación puede perder el aviso: se repite en lo siguiente que lea el modelo.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    avisados.delete('')
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // Siempre pasan: los comandos (incluido /cuota para desbloquear), los mensajes que llegan a un
    // turno en marcha (`turnId`), que pueden ser instrucciones de cierre, y lo que no es del usuario.
    if (e.command !== undefined) return next(e)
    if (e.turnId === undefined && e.isMeta !== true && FRENABLES.has(e.origin.kind)) {
      const { ev, propios } = await refrescar($)
      if (ev.estado === 'frenado' && ev.manda) {
        await avisar($, 'freno', { motivo: 'prompt' })
        return { drop: textos.rechazoPrompt(idioma, ev.manda, siguienteNivel(topeDe(ev.manda, ajustes, propios))) }
      }
    }
    const aviso = avisoNuevo('')
    return next(aviso === undefined ? e : { ...e, context: [...(e.context ?? []), aviso] })
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.resume !== undefined) return next(e)
    const { ev } = await refrescar($)
    if (ev.estado !== 'frenado') return next(e)
    await avisar($, 'freno', { motivo: 'agente' })
    return { deny: textos.rechazoAgente(idioma) }
  })
}
