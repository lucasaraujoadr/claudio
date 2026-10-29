/**
 * Leitura e escrita de CSV para a importação e a exportação de contatos.
 *
 * Leitura: autômato RFC 4180 caractere a caractere (aspas, aspas duplicadas, separador e
 * quebra de linha dentro de aspas, CRLF/LF/CR), separador `,` ou `;` escolhido pela
 * contagem fora das aspas na primeira linha. Escrita: o formato que o Excel em pt-BR abre
 * direto — BOM UTF-8, `;`, CRLF.
 */

export const LIMITE_LINHAS_IMPORTACAO = 5000

export type Separador = ',' | ';'

export type ResultadoCsv =
  | {
      ok: true
      separador: Separador
      cabecalho: string[]
      linhas: string[][]
      /** Número da linha na planilha (cabeçalho = 1, contando linhas em branco) de cada item de `linhas`. */
      numeros: number[]
    }
  | { ok: false; erro: 'vazio' | 'sem_linhas' | 'aspas_abertas' | 'linhas_demais'; mensagem: string }

const BOM = '﻿'

function detectarSeparador(texto: string): Separador {
  let virgulas = 0
  let pontoEVirgulas = 0
  let emAspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '"') emAspas = !emAspas
    else if (!emAspas && (c === '\n' || c === '\r')) break
    else if (!emAspas && c === ',') virgulas++
    else if (!emAspas && c === ';') pontoEVirgulas++
  }
  return pontoEVirgulas > virgulas ? ';' : ','
}

/** Todos os registros do texto (sem BOM); `null` se terminar com aspas abertas. */
function registros(texto: string, sep: Separador): string[][] | null {
  const saida: string[][] = []
  let linha: string[] = []
  let campo = ''
  let emAspas = false
  let i = 0
  const n = texto.length
  while (i < n) {
    const c = texto[i]
    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i += 2
          continue
        }
        emAspas = false
        i++
        continue
      }
      campo += c
      i++
      continue
    }
    if (c === '"' && campo.length === 0) {
      emAspas = true
      i++
    } else if (c === sep) {
      linha.push(campo)
      campo = ''
      i++
    } else if (c === '\r' || c === '\n') {
      linha.push(campo)
      saida.push(linha)
      linha = []
      campo = ''
      i += c === '\r' && texto[i + 1] === '\n' ? 2 : 1
    } else {
      campo += c
      i++
    }
  }
  if (emAspas) return null
  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo)
    saida.push(linha)
  }
  return saida
}

export function lerCsv(entrada: string, limite: number = LIMITE_LINHAS_IMPORTACAO): ResultadoCsv {
  const texto = entrada.startsWith(BOM) ? entrada.slice(1) : entrada
  if (texto.trim().length === 0) return { ok: false, erro: 'vazio', mensagem: 'O arquivo está vazio.' }
  const separador = detectarSeparador(texto)
  const todos = registros(texto, separador)
  if (!todos) {
    return {
      ok: false,
      erro: 'aspas_abertas',
      mensagem: 'O arquivo tem aspas abertas que não fecham. Salve de novo pelo Excel como CSV e tente outra vez.',
    }
  }
  const naoVazios = todos
    .map((r, i) => ({ r, numero: i + 1 }))
    .filter(({ r }) => r.some((c) => c.trim().length > 0))
  const [primeiro, ...resto] = naoVazios
  const cabecalhoBruto = primeiro?.r
  const corpo = resto.map((x) => x.r)
  if (!cabecalhoBruto || corpo.length === 0) {
    return { ok: false, erro: 'sem_linhas', mensagem: 'O arquivo não tem linhas de dados abaixo do cabeçalho.' }
  }
  if (corpo.length > limite) {
    return {
      ok: false,
      erro: 'linhas_demais',
      mensagem: `O arquivo tem ${corpo.length.toLocaleString('pt-BR')} linhas; o limite por lote é ${limite.toLocaleString('pt-BR')}. Divida a planilha em partes e importe uma de cada vez.`,
    }
  }
  const cabecalho = cabecalhoBruto.map((c) => c.trim())
  const largura = Math.max(cabecalho.length, ...corpo.map((r) => r.length))
  while (cabecalho.length < largura) cabecalho.push('')
  const linhas = corpo.map((r) => (r.length < largura ? [...r, ...Array<string>(largura - r.length).fill('')] : r))
  return { ok: true, separador, cabecalho, linhas, numeros: resto.map((x) => x.numero) }
}

/**
 * Bytes do arquivo → texto. UTF-8 (com ou sem BOM) é o esperado; se os bytes não forem
 * UTF-8 válido, é o "CSV (separado por vírgulas)" antigo do Excel no Windows, em
 * Windows-1252.
 */
export function decodificarArquivo(bytes: Uint8Array): { texto: string; codificacao: 'utf-8' | 'windows-1252' } {
  try {
    const texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    return { texto, codificacao: 'utf-8' }
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(bytes), codificacao: 'windows-1252' }
  }
}

/** Célula que o Excel interpretaria como fórmula ganha um apóstrofo na frente. */
function celula(valor: string): string {
  const v = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function linhaCsv(valores: readonly string[]): string {
  return valores.map(celula).join(';') + '\r\n'
}

/** CSV completo para o Excel pt-BR: BOM, `;`, CRLF. */
export function escreverCsv(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  return BOM + linhaCsv(cabecalho) + linhas.map(linhaCsv).join('')
}

export { BOM }
