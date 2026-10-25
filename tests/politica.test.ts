import { expect, test } from 'claude-code/testing'
import {
  claveDe,
  comandoDe,
  evaluar,
  idiomaDe,
  leer,
  lineaDeEstado,
  ordenDe,
  padreDe,
  propiosDe,
} from '../hooks/politica'

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

test('normal, cerrando y frenado según el límite y el margen', () => {
  expect(evaluar({ semana: { uso: 60 } }, AJUSTES).estado).toBe('normal')
  expect(evaluar({ semana: { uso: 70 } }, AJUSTES).estado).toBe('cerrando')
  expect(evaluar({ semana: { uso: 80 } }, AJUSTES).estado).toBe('frenado')
  expect(evaluar({ semana: { uso: 80 } }, AJUSTES, { semana: 90 }).estado).toBe('cerrando')
  expect(evaluar({ semana: { uso: 99 } }, AJUSTES, { semana: 100 }).estado).toBe('libre')
  expect(evaluar({}, AJUSTES).estado).toBe('sin-datos')
})

test('el límite propio de una ventana no toca la otra', () => {
  const l = { cinco: { uso: 85 }, semana: { uso: 30 } }
  expect(evaluar(l, AJUSTES, { semana: 95 }).estado).toBe('frenado')
  expect(evaluar(l, AJUSTES, { cinco: 90 }).estado).toBe('cerrando')
})

test('manda la ventana con menos margen, y una frenada manda sobre la otra', () => {
  const ev = evaluar({ cinco: { uso: 75 }, semana: { uso: 30 } }, AJUSTES)
  expect(ev.estado).toBe('cerrando')
  expect(ev.manda).toBe('cinco')
  expect(ev.faltan).toBe(5)
  expect(evaluar({ cinco: { uso: 90 }, semana: { uso: 85 } }, AJUSTES).manda).toBe('cinco')
})

test('la de 5 h configurada para solo avisar no frena', () => {
  const ev = evaluar({ cinco: { uso: 95 }, semana: { uso: 30 } }, { ...AJUSTES, cincoFrena: false })
  expect(ev.estado).toBe('normal')
  expect(ev.avisoCinco).toBe(true)
  expect(ev.manda).toBe('semana')
})

test('la línea de estado empieza con la cifra y sugiere el comando de la ventana que frena', () => {
  const l = { cinco: { uso: 42 }, semana: { uso: 61 } }
  expect(lineaDeEstado(l, evaluar(l, AJUSTES), AJUSTES, 'es')).toBe('5 h 42% · semana 61% · límite 80% · quedan 19%')
  const f = { cinco: { uso: 20 }, semana: { uso: 81 } }
  expect(lineaDeEstado(f, evaluar(f, AJUSTES), AJUSTES, 'es')).toBe(
    'frenado · 5 h 20% · semana 81% · límite 80% · /cuotasemanal 90 para seguir',
  )
  expect(lineaDeEstado(f, evaluar(f, AJUSTES), AJUSTES, 'en')).toBe(
    'braked · 5 h 20% · week 81% · cap 80% · /cuotaweek 90 to go on',
  )
})

test('con límites distintos, cada ventana dice el suyo', () => {
  const l = { cinco: { uso: 42 }, semana: { uso: 61 } }
  const propios = { cinco: 100, semana: 95 }
  expect(lineaDeEstado(l, evaluar(l, AJUSTES, propios), AJUSTES, 'es', propios)).toBe(
    '5 h 42% (sin límite) · semana 61% (límite 95%) · quedan 34%',
  )
})

test('órdenes de los comandos', () => {
  expect(ordenDe('')).toEqual({ tipo: 'ver' })
  expect(ordenDe(' 90 ')).toEqual({ tipo: 'fijar', tope: 90 })
  expect(ordenDe('85%')).toEqual({ tipo: 'fijar', tope: 85 })
  expect(ordenDe('libre')).toEqual({ tipo: 'fijar', tope: 100 })
  expect(ordenDe('default')).toEqual({ tipo: 'quitar' })
  expect(ordenDe('reset')).toEqual({ tipo: 'quitar' })
  expect(ordenDe('quitar')).toEqual({ tipo: 'quitar' })
  expect(ordenDe('150').tipo).toBe('ayuda')
})

test('comando de cada ventana según el idioma', () => {
  expect(comandoDe('cinco', 'es')).toBe('cuota')
  expect(comandoDe('cinco', 'en')).toBe('cuota')
  expect(comandoDe('semana', 'es')).toBe('cuotasemanal')
  expect(comandoDe('semana', 'en')).toBe('cuotaweek')
})

test('una política guardada por la v0.1 vale para las dos ventanas', () => {
  expect(propiosDe({ tope: 90, ruta: '/p', desde: '2026-10-25' })).toEqual({ cinco: 90, semana: 90 })
  expect(propiosDe({ tope: 90, semana: 95, ruta: '/p', desde: '2026-10-25' })).toEqual({ cinco: 90, semana: 95 })
  expect(propiosDe(undefined)).toBeUndefined()
})

test('rutas de Windows y POSIX', () => {
  expect(claveDe('C:\\Proyectos\\App\\')).toBe('c:/proyectos/app')
  expect(claveDe('/home/a/b')).toBe('/home/a/b')
  expect(padreDe('C:\\proyectos\\app')).toBe('C:\\proyectos')
  expect(padreDe('C:\\proyectos')).toBe('C:\\')
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
