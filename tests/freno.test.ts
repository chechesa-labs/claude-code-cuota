import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Nada corre debajo del mod: cada hook de aquí hace de motor.
const motor = (on: On, rateLimits: SessionRateLimit[], guardado: Record<string, unknown> = {}, language = 'es') => {
  const pantalla = { status: undefined as string | undefined, toasts: [] as string[] }
  mock.store(on, guardado)
  on('settings.read', () => ({ value: { language } }))
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

const semanal = (args: string) => ({ ...cuota(args), command: 'cuotasemanal' }) as const

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

test('en el límite semanal frena prompts y agentes nuevos, y /cuotasemanal 90 desbloquea', async ($, on) => {
  const pantalla = motor(on, [{ kind: 'seven_day', percentUsed: 82 }])
  await $.session.start(arrancar)
  expect(pantalla.status).toBe('frenado · semana 82% · límite 80% · /cuotasemanal 90 para seguir')
  expect(pantalla.toasts[0]).toMatch(/Límite alcanzado en la semana/)

  expect((await $.prompt.submit(prompt('otra ronda'))).drop).toContain('/cuotasemanal 90')
  expect((await $.agent.spawn(agente)).deny).toMatch(/límite/)

  // /cuota es la ventana de 5 h: no desbloquea la semanal.
  await $.command.run(cuota('90'))
  expect((await $.prompt.submit(prompt('otra ronda'))).drop).toBeDefined()

  const salida = await $.command.run(semanal('90'))
  expect(salida.text).toContain('Semana: 82% usado · límite 90% (propio de esta carpeta)')
  expect(salida.text).toContain('5 h: sin lectura · límite 90% (propio de esta carpeta)')
  expect(salida.text).toMatch(/^Carpeta: \/proyectos\/cliente$/m)
  expect(await $.prompt.submit(prompt('otra ronda'))).toEqual({ text: 'otra ronda' })
  expect((await $.agent.spawn(agente)).deny).toBeUndefined()

  const regreso = await $.command.run(semanal('default'))
  expect(regreso.text).toContain('límite 80% (el de todas las carpetas)')
  expect((await $.prompt.submit(prompt('y otra'))).drop).toBeDefined()
})

test('una política de la v0.1 sigue valiendo para las dos ventanas', async ($, on) => {
  motor(on, [{ kind: 'seven_day', percentUsed: 85 }], {
    politicas: { '/proyectos/cliente': { tope: 90, ruta: '/proyectos/cliente', desde: '2026-10-24' } },
  })
  await $.session.start(arrancar)
  expect(await $.prompt.submit(prompt('x'))).toEqual({ text: 'x' })
  const salida = await $.command.run(cuota(''))
  expect(salida.text).toContain('Semana: 85% usado · límite 90% (propio de esta carpeta)')
})

test('cambiar el límite confirma el cambio y /quota es el mismo comando', async ($, on) => {
  motor(on, [{ kind: 'five_hour', percentUsed: 83 }], {})
  await $.session.start(arrancar)
  const subir = (await $.command.run(cuota('90'))).text ?? ''
  expect(subir.split('\n')[0]).toBe('Listo: el límite de 5 h de esta carpeta ahora es 90%.')
  expect(subir).toContain('5 h: 83% usado · límite 90% (propio de esta carpeta)')
  expect(subir).not.toContain('Para cambiarlo')
  const libre = (await $.command.run({ ...cuota('100'), command: 'quota' })).text ?? ''
  expect(libre.split('\n')[0]).toBe('Listo: esta carpeta ya no tiene límite de 5 h.')
  const vuelta = (await $.command.run(cuota('default'))).text ?? ''
  expect(vuelta.split('\n')[0]).toBe('Listo: el límite de 5 h de esta carpeta regresó al de todas las carpetas (80%).')
})

const varias = {
  '/hobby/nova': { cinco: 60, semana: 60, ruta: '/hobby/nova', desde: '2026-10-20' },
  '/IA/lora-baker': { cinco: 100, ruta: '/IA/lora-baker', desde: '2026-10-20' },
  '/IA/cuota': { cinco: 92, ruta: '/IA/cuota', desde: '2026-10-20' },
  '/clientes/cuota': { cinco: 85, semana: 90, ruta: '/clientes/cuota', desde: '2026-10-20' },
}

test('en lote: lista con nombres cortos, cambiar por nombre y regresar las de arriba de 80%', async ($, on) => {
  motor(on, [{ kind: 'five_hour', percentUsed: 40 }], { politicas: varias })
  await $.session.start(arrancar)
  const lista = (await $.command.run(cuota('lista'))).text ?? ''
  expect(lista).toContain('  IA/cuota: 5 h 92% · semana el de todas (/IA/cuota)')
  expect(lista).toContain('  nova: 5 h 60% · semana 60% (/hobby/nova)')

  expect((await $.command.run(cuota('85 cuota'))).text).toContain('coincide con varias carpetas: IA/cuota, clientes/cuota')
  expect((await $.command.run(cuota('85 nada'))).text).toContain('No encontré "nada"')

  expect((await $.command.run(cuota('85 lora-baker ia/cuota'))).text).toBe('Listo: límite 85% de 5 h en lora-baker, IA/cuota.')
  expect((await $.command.run(cuota('default sobre-80'))).text).toBe(
    'Listo: regresaron al límite de 5 h de todas las carpetas (80%): lora-baker, IA/cuota, clientes/cuota.',
  )
  const despues = (await $.command.run(cuota('lista'))).text ?? ''
  expect(despues).toContain('nova: 5 h 60%')
  expect(despues).toContain('  cuota: 5 h el de todas · semana 90% (/clientes/cuota)')
  expect(despues).not.toContain('lora-baker')
  expect((await $.command.run(cuota('default over 80'))).text).toContain('Ninguna carpeta tiene límite de 5 h arriba de 80%')
  expect((await $.command.run(semanal('default todas'))).text).toBe(
    'Listo: regresaron al límite semanal de todas las carpetas (80%): nova, cuota.',
  )
})

test('temporal: sube hasta el reinicio y después regresa solo al valor de antes', async ($, on) => {
  motor(on, [{ kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-24T22:00:00Z' }], {
    politicas: { '/proyectos/cliente': { cinco: 60, ruta: '/proyectos/cliente', desde: '2026-10-20' } },
  })
  await $.session.start(arrancar)
  const r = (await $.command.run(cuota('100-temporal'))).text ?? ''
  expect(r.split('\n')[0]).toMatch(/^Listo: esta carpeta no tiene límite de 5 h hasta que se reinicie la ventana \(.+\); después regresa a 60%\.$/)
  expect((await $.command.run(cuota('lista'))).text).toMatch(/cliente: 5 h sin límite hasta .+ · semana el de todas/)
})

test('temporal sin lectura no cambia nada', async ($, on) => {
  motor(on, [])
  await $.session.start(arrancar)
  expect((await $.command.run(cuota('90-temporal'))).text).toContain('no sé cuándo se reinicia')
  expect((await $.command.run(cuota('lista'))).text).toBe('Ninguna carpeta tiene límite propio.')
})

test('una sesión frenada se libera sola cuando pasa la hora de reinicio', async ($, on) => {
  // La lectura dice 83%, pero su ventana se reinició a las 19:00 y el reloj marca 20:00.
  motor(on, [{ kind: 'five_hour', percentUsed: 83, resetsAt: '2026-10-24T19:00:00Z' }])
  await $.session.start(arrancar)
  expect(await $.prompt.submit(prompt('sigo'))).toEqual({ text: 'sigo' })
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
  expect(pantalla.status).toBe('frenado · semana 85% · límite 80% · /cuotasemanal 90 para seguir')
  expect((await $.prompt.submit(prompt('x'))).drop).toBeDefined()
})

test('un mensaje que llega a un turno en marcha pasa aunque la carpeta esté frenada', async ($, on) => {
  motor(on, [{ kind: 'seven_day', percentUsed: 95 }])
  await $.session.start(arrancar)
  expect(await $.prompt.submit({ ...prompt('ya para y deja el estado'), turnId: 't-1' })).toEqual({ text: 'ya para y deja el estado' })
  expect((await $.prompt.submit(prompt('otra cosa'))).drop).toBeDefined()
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

test('con Claude Code en inglés, la interfaz sale en inglés', async ($, on) => {
  const pantalla = motor(on, [{ kind: 'seven_day', percentUsed: 82 }], {}, 'english')
  await $.session.start(arrancar)
  expect(pantalla.status).toBe('braked · week 82% · cap 80% · /cuotaweek 90 to go on')
  expect((await $.prompt.submit(prompt('more'))).drop).toMatch(/reached its cap/)
})
