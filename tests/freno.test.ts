import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Nada corre debajo del mod: cada hook de aquí hace de motor.
const motor = (on: On, rateLimits: SessionRateLimit[], guardado: Record<string, unknown> = {}) => {
  const pantalla = { status: undefined as string | undefined, toasts: [] as string[] }
  mock.store(on, guardado)
  mock.clock(on, { now: Date.parse('2026-10-24T20:00:00Z') })
  on('ui.status', (_, e) => {
    pantalla.status = e.text
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    pantalla.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'cuota' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proyectos/cliente/src' }))
  // El motor entrega la ruta ya resuelta (en Windows, `C:\proyectos\cliente\.git`).
  on('fs.exists', (_, e) => ({ value: /[\\/]proyectos[\\/]cliente[\\/]\.git$/.test(e.path) }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits },
  }))
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  return pantalla
}

const arrancar = { cwd: '/proyectos/cliente/src', surface: 'vscode', isInteractive: true } as const

const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

const cuota = (args: string) =>
  ({
    command: 'cuota',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

const agente = {
  tool_use_id: 't1',
  prompt: 'investiga',
  description: 'investigar',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
} as const

test('debajo del tope todo pasa', async ($, on) => {
  motor(on, [{ kind: 'seven_day', percentUsed: 50 }])
  await $.session.start(arrancar)
  expect(await $.prompt.submit(prompt('hola'))).toEqual({ text: 'hola' })
})

test('en el tope frena prompts y agentes nuevos, y /cuota 90 desbloquea', async ($, on) => {
  const pantalla = motor(on, [{ kind: 'seven_day', percentUsed: 82 }])
  await $.session.start(arrancar)
  expect(pantalla.status).toBe('frenado · semana 82% · tope 80% · /cuota 90 para seguir')
  expect(pantalla.toasts[0]).toMatch(/Tope alcanzado en la semana/)

  expect((await $.prompt.submit(prompt('otra ronda'))).drop).toMatch(/\/cuota 90/)
  expect((await $.agent.spawn(agente)).deny).toMatch(/tope/)

  const salida = await $.command.run(cuota('90'))
  expect(salida.text).toMatch(/propia, 90%/)
  expect(salida.text).toMatch(/^Carpeta: \/proyectos\/cliente$/m)
  expect(await $.prompt.submit(prompt('otra ronda'))).toEqual({ text: 'otra ronda' })
  expect((await $.agent.spawn(agente)).deny).toBeUndefined()

  await $.command.run(cuota('quitar'))
  expect((await $.prompt.submit(prompt('y otra'))).drop).toBeDefined()
})

test('una sesión nueva sin lectura usa la última guardada mientras siga vigente', async ($, on) => {
  // Lo que dejó otra sesión: la semana sigue vigente, la de 5 h ya reinició (el reloj marca 20:00).
  const pantalla = motor(on, [], {
    ultimaLectura: {
      semana: { uso: 85, reinicio: '2026-10-27T00:00:00Z' },
      cinco: { uso: 99, reinicio: '2026-10-24T19:00:00Z' },
    },
  })
  await $.session.start(arrancar)
  expect(pantalla.status).toBe('frenado · semana 85% · tope 80% · /cuota 90 para seguir')
  expect((await $.prompt.submit(prompt('x'))).drop).toBeDefined()
})

test('/cuota pasa aunque la carpeta esté frenada', async ($, on) => {
  motor(on, [{ kind: 'seven_day', percentUsed: 95 }])
  await $.session.start(arrancar)
  const r = await $.prompt.submit({ ...prompt('/cuota 100'), command: { name: 'cuota', args: '100' } })
  expect(r.drop).toBeUndefined()
})

test('la de 5 h frena por defecto', async ($, on) => {
  motor(on, [
    { kind: 'five_hour', percentUsed: 85 },
    { kind: 'seven_day', percentUsed: 20 },
  ])
  await $.session.start(arrancar)
  expect((await $.prompt.submit(prompt('x'))).drop).toBeDefined()
})

test('con la de 5 h en solo aviso, el prompt pasa', { options: { cincoHorasFrena: false } }, async ($, on) => {
  motor(on, [
    { kind: 'five_hour', percentUsed: 85 },
    { kind: 'seven_day', percentUsed: 20 },
  ])
  await $.session.start(arrancar)
  expect(await $.prompt.submit(prompt('x'))).toEqual({ text: 'x' })
})

test('cerca del tope agrega la sección de cierre al prompt de sistema', async ($, on) => {
  motor(on, [{ kind: 'seven_day', percentUsed: 74 }])
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))
  await $.session.start(arrancar)
  const r = await $.prompt.compose({
    model: 'opus',
    promptModel: 'opus',
    surfaces: ['vscode'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(r.sections.map(s => s.id)).toEqual(['intro', 'cuota:cierre'])
})
