import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'
import {
  type Ajustes,
  type Estado,
  type Idioma,
  type Lectura,
  type Politica,
  type VentanaId,
  claveDe,
  evaluar,
  idiomaDe,
  informe,
  leer,
  lineaDeEstado,
  ordenDe,
  padreDe,
  propiosDe,
  siguienteNivel,
  textos,
  topeDe,
  vigente,
} from './politica'

type Politicas = Record<string, Politica>

const CLAVE_STORE = 'politicas'
const CLAVE_LECTURA = 'ultimaLectura'

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

async function politicas($: EngineInterface): Promise<Politicas> {
  const v = await $.store.get(CLAVE_STORE)
  return v !== null && typeof v === 'object' ? (v as Politicas) : {}
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
  const propios = await propiosCarpeta($)
  const ev = evaluar(lectura, ajustes, propios)
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

/** Al arrancar no hay lectura hasta la primera respuesta: se usa la guardada mientras siga vigente. */
async function lecturaGuardada($: EngineInterface) {
  const v = await $.store.get(CLAVE_LECTURA)
  if (v === null || typeof v !== 'object') return
  lectura = vigente(v as Lectura, await $.clock.now())
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

  if (orden.tipo === 'fijar' || orden.tipo === 'quitar') {
    const todas = await politicas($)
    const clave = claveDe(raiz)
    const desde = new Date(await $.clock.now()).toISOString().slice(0, 10)
    // El `tope` de la v0.1 valía para las dos ventanas: se reparte antes de cambiar una.
    const previos = propiosDe(todas[clave]) ?? {}
    const nueva: Politica = { ...previos, ruta: raiz, desde }
    if (orden.tipo === 'fijar') nueva[ventana] = orden.tope
    else delete nueva[ventana]
    if (nueva.cinco === undefined && nueva.semana === undefined) delete todas[clave]
    else todas[clave] = nueva
    await $.store.set(CLAVE_STORE, todas)
    await avisar($, 'politica', { ventana, tope: orden.tipo === 'fijar' ? orden.tope : null })
  }

  const { ev, propios } = await refrescar($)
  return informe(raiz, lectura, ev, ajustes, idioma, propios)
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
    else await lecturaGuardada($)
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
  on('command.run', { command: 'cuotasemanal' }, async ($, e) => ({ text: await correrComando($, e.args, 'semana') }))
  on('command.run', { command: 'cuotaweek' }, async ($, e) => ({ text: await correrComando($, e.args, 'semana') }))

  // ------------------------------------------------------------ cierre y freno

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const { ev } = await refrescar($)
    if (ev.estado !== 'cerrando' && ev.estado !== 'frenado') return r
    return {
      sections: [
        ...r.sections,
        { id: 'cuota:cierre', text: textos.seccionCierre(idioma, ev.estado === 'frenado'), scope: 'session' as const },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // Siempre pasan: los comandos (incluido /cuota para desbloquear), los avisos de tareas en curso
    // y los mensajes que llegan a un turno en marcha (`turnId`), que pueden ser instrucciones de cierre.
    if (e.command !== undefined || e.turnId !== undefined || e.origin.kind === 'task-notification') return next(e)
    const { ev, propios } = await refrescar($)
    if (ev.estado !== 'frenado' || !ev.manda) return next(e)
    await avisar($, 'freno', { motivo: 'prompt' })
    return { drop: textos.rechazoPrompt(idioma, ev.manda, siguienteNivel(topeDe(ev.manda, ajustes, propios))) }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.resume !== undefined) return next(e)
    const { ev } = await refrescar($)
    if (ev.estado !== 'frenado') return next(e)
    await avisar($, 'freno', { motivo: 'agente' })
    return { deny: textos.rechazoAgente(idioma) }
  })
}
