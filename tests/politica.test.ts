import { expect, test } from 'claude-code/testing'
import { claveDe, evaluar, idiomaDe, leer, lineaDeEstado, ordenDe, padreDe } from '../hooks/politica'

const AJUSTES = { topeCinco: 80, topeSemana: 80, cincoFrena: true, margen: 10 }

test('lee la de 5 h y toma la semanal más alta', () => {
  const l = leer([
    { kind: 'five_hour', percentUsed: 12 },
    { kind: 'seven_day', percentUsed: 40 },
    { kind: 'seven_day_opus', percentUsed: 55 },
  ])
  expect(l.cinco?.uso).toBe(12)
  expect(l.semana?.uso).toBe(55)
})

test('normal, cerrando y frenado según el tope y el margen', () => {
  expect(evaluar({ semana: { uso: 60 } }, AJUSTES).estado).toBe('normal')
  expect(evaluar({ semana: { uso: 70 } }, AJUSTES).estado).toBe('cerrando')
  expect(evaluar({ semana: { uso: 80 } }, AJUSTES).estado).toBe('frenado')
  expect(evaluar({ semana: { uso: 80 } }, AJUSTES, 90).estado).toBe('cerrando')
  expect(evaluar({ semana: { uso: 99 } }, AJUSTES, 100).estado).toBe('libre')
  expect(evaluar({}, AJUSTES).estado).toBe('sin-datos')
})

test('manda la ventana con menos margen', () => {
  const ev = evaluar({ cinco: { uso: 75 }, semana: { uso: 30 } }, AJUSTES)
  expect(ev.estado).toBe('cerrando')
  expect(ev.manda).toBe('cinco')
  expect(ev.faltan).toBe(5)
})

test('la de 5 h configurada para solo avisar no frena', () => {
  const ev = evaluar({ cinco: { uso: 95 }, semana: { uso: 30 } }, { ...AJUSTES, cincoFrena: false })
  expect(ev.estado).toBe('normal')
  expect(ev.avisoCinco).toBe(true)
  expect(ev.manda).toBe('semana')
})

test('la línea de estado empieza con la cifra y sugiere el desbloqueo', () => {
  const l = { cinco: { uso: 42 }, semana: { uso: 61 } }
  expect(lineaDeEstado(l, evaluar(l, AJUSTES), AJUSTES, 'es')).toBe('5 h 42% · semana 61% · límite 80% · quedan 19%')
  const f = { cinco: { uso: 20 }, semana: { uso: 81 } }
  expect(lineaDeEstado(f, evaluar(f, AJUSTES), AJUSTES, 'es')).toBe(
    'frenado · 5 h 20% · semana 81% · límite 80% · /cuota 90 para seguir',
  )
})

test('órdenes de /cuota', () => {
  expect(ordenDe('')).toEqual({ tipo: 'ver' })
  expect(ordenDe(' 90 ')).toEqual({ tipo: 'fijar', tope: 90 })
  expect(ordenDe('85%')).toEqual({ tipo: 'fijar', tope: 85 })
  expect(ordenDe('libre')).toEqual({ tipo: 'fijar', tope: 100 })
  expect(ordenDe('quitar')).toEqual({ tipo: 'quitar' })
  expect(ordenDe('150').tipo).toBe('ayuda')
})

test('rutas de Windows y POSIX', () => {
  expect(claveDe('D:\\IA\\cuota\\')).toBe('d:/ia/cuota')
  expect(claveDe('/home/a/b')).toBe('/home/a/b')
  expect(padreDe('D:\\IA\\cuota')).toBe('D:\\IA')
  expect(padreDe('D:\\IA')).toBe('D:\\')
  expect(padreDe('/home/a')).toBe('/home')
  expect(padreDe('/home')).toBe('/')
})

test('idioma de la interfaz según el ajuste language', () => {
  expect(idiomaDe('es')).toBe('es')
  expect(idiomaDe('Spanish')).toBe('es')
  expect(idiomaDe('español')).toBe('es')
  expect(idiomaDe('es-MX')).toBe('es')
  expect(idiomaDe('english')).toBe('en')
  expect(idiomaDe('japanese')).toBe('en')
  expect(idiomaDe(undefined)).toBe('en')
})
