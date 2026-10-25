import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'
import {
  type Ajustes,
  type Estado,
  type Idioma,
  type Lectura,
  claveDe,
  evaluar,
  informe,
  leer,
  lineaDeEstado,
  ordenDe,
  padreDe,
  siguienteNivel,
  textos,
  topeDe,
  vigente,
} from './politica'

type Politica = { tope: number; ruta: string; desde: string }
type Politicas = Record<string, Politica>

const CLAVE_STORE = 'politicas'
const CLAVE_LECTURA = 'ultimaLectura'

// Lo de esta activación. Un recargo del mod lo reinicia y session.start lo vuelve a llenar;
// las políticas viven en $.store y sobreviven.
let ajustes: Ajustes = { topeCinco: 80, topeSemana: 80, cincoFrena: true, margen: 10 }
let idioma: Idioma = 'es'
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

async function topeCarpeta($: EngineInterface) {
  return carpeta === undefined ? undefined : (await politicas($))[claveDe(carpeta)]?.tope
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
    politica: { tope: await topeCarpeta($), ...ajustes },
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
  const tope = await topeCarpeta($)
  const ev = evaluar(lectura, ajustes, tope)
  $.ui.status(lineaDeEstado(lectura, ev, ajustes, idioma, tope))

  if (ev.estado !== ultimo) {
    if (ev.estado === 'cerrando' && ultimo !== 'frenado' && ev.manda) {
      $.ui.toast(textos.toastCerrando(idioma, ev.manda, ev.faltan ?? 0), { timeoutMs: 8000 })
    }
    if (ev.estado === 'frenado' && ev.manda) {
      $.ui.toast(textos.toastFrenado(idioma, ev.manda, siguienteNivel(topeDe(ev.manda, ajustes, tope))), {
        timeoutMs: 10000,
      })
      await avisarAgentes($)
    }
    if (ultimo !== 'sin-datos' || ev.estado === 'frenado') await avisar($, 'estado', { de: ultimo, a: ev.estado })
    ultimo = ev.estado
  }
  if (ev.avisoCinco && !avisoCincoDado) $.ui.toast(textos.toastAvisoCinco(idioma, topeDe('cinco', ajustes, tope)))
  avisoCincoDado = ev.avisoCinco
  return { ev, tope }
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

async function registrarComando($: EngineInterface) {
  try {
    await $.command.register({
      name: 'cuota',
      description:
        idioma === 'es'
          ? 'Tope de uso del plan para esta carpeta: ver, subir (90, 100, n) o quitar'
          : "This folder's cap on plan usage: show, raise (90, 100, n) or remove",
      argumentHint: idioma === 'es' ? '[90 | 100 | n | quitar | lista]' : '[90 | 100 | n | remove | list]',
      immediate: true,
    })
  } catch {
    // Si el nombre choca con otro comando, lo demás del mod sigue funcionando.
  }
}

async function correrComando($: EngineInterface, args: string) {
  const raiz = await asegurarCarpeta($)
  const orden = ordenDe(args)
  const es = idioma === 'es'

  if (orden.tipo === 'ayuda') return textos.ayuda(idioma, orden.error)

  if (orden.tipo === 'lista') {
    const todas = Object.values(await politicas($))
    if (todas.length === 0) return es ? 'Ninguna carpeta tiene política propia.' : 'No folder has its own policy.'
    return todas
      .sort((a, b) => a.ruta.localeCompare(b.ruta))
      .map(p => `${p.tope >= 100 ? (es ? 'libre' : 'free') : `${p.tope}%`}  ${p.ruta}  (${p.desde})`)
      .join('\n')
  }

  if (orden.tipo === 'fijar' || orden.tipo === 'quitar') {
    const todas = await politicas($)
    if (orden.tipo === 'fijar') {
      const desde = new Date(await $.clock.now()).toISOString().slice(0, 10)
      todas[claveDe(raiz)] = { tope: orden.tope, ruta: raiz, desde }
    } else delete todas[claveDe(raiz)]
    await $.store.set(CLAVE_STORE, todas)
    await avisar($, 'politica', { tope: orden.tipo === 'fijar' ? orden.tope : null })
  }

  const { ev, tope } = await refrescar($)
  return informe(raiz, lectura, ev, ajustes, idioma, tope)
}

export const register: Register = (on, options) => {
  ajustes = {
    topeCinco: Number(options.topeCincoHoras ?? 80),
    topeSemana: Number(options.topeSemanal ?? 80),
    cincoFrena: options.cincoHorasFrena !== false,
    margen: Number(options.margenAviso ?? 10),
  }
  idioma = options.idioma === 'en' ? 'en' : 'es'
  webhook = typeof options.webhook === 'string' ? options.webhook.trim() : ''

  // ------------------------------------------------------------ arranque y lectura

  on('session.start', async ($, e, next) => {
    await registrarComando($)
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

  on('command.run', { command: 'cuota' }, async ($, e) => ({ text: await correrComando($, e.args) }))

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
    // Los comandos (incluido /cuota para desbloquear) y los avisos de tareas en curso siempre pasan.
    if (e.command !== undefined || e.origin.kind === 'task-notification') return next(e)
    const { ev, tope } = await refrescar($)
    if (ev.estado !== 'frenado' || !ev.manda) return next(e)
    await avisar($, 'freno', { motivo: 'prompt' })
    return { drop: textos.rechazoPrompt(idioma, ev.manda, siguienteNivel(topeDe(ev.manda, ajustes, tope))) }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.resume !== undefined) return next(e)
    const { ev } = await refrescar($)
    if (ev.estado !== 'frenado') return next(e)
    await avisar($, 'freno', { motivo: 'agente' })
    return { deny: textos.rechazoAgente(idioma) }
  })
}
