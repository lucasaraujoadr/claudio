import { z } from 'zod'
import type { Briefing, Topic } from '@/lib/db/schema'
import { MAX_URLS_NO_PROMPT } from '@/lib/ai/briefing'

export type Fato = { afirmacao: string; fonte?: string }

// Schema enviado ao modelo de busca: leniente; a validação estrita é o próprio Zod no parse.
export const pesquisaSchemaModelo = z.object({
  fatos: z.array(z.object({ afirmacao: z.string(), fonte: z.string().optional() })),
})

export const reescritaSchemaModelo = z.object({ texto: z.string() })

function limpar(s: string, max = 300): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Sanitiza, remove vazias/duplicadas e limita a MAX_URLS_NO_PROMPT. Usada no prompt e em paraHtml. */
export function urlsParaArtigo(urls: string[]): string[] {
  const vistas = new Set<string>()
  const saida: string[] = []
  for (const u of urls) {
    const limpa = limpar(u, 200)
    const chave = limpa.replace(/\/+$/, '')
    if (!chave || vistas.has(chave)) continue
    vistas.add(chave)
    saida.push(limpa)
    if (saida.length >= MAX_URLS_NO_PROMPT) break
  }
  return saida
}

export function montarPromptPesquisa(t: { keyword: string; titulo: string }): string {
  return [
    'Você é pesquisador jurídico-contábil no Brasil. Levante FATOS VERIFICÁVEIS para um artigo destinado a advogados.',
    `Tema: ${limpar(t.titulo)}\nKeyword principal: ${limpar(t.keyword)}`,
    'Liste leis e artigos, súmulas, temas repetitivos e de repercussão geral do STJ/STF/TST, índices de correção e juros, prazos e valores de referência que sejam relevantes para o tema.',
    'Cada fato deve ser uma afirmação objetiva, com a fonte (URL oficial, quando houver). Não invente: se não tiver certeza, omita o fato.',
    'Responda em português do Brasil.',
  ].join('\n\n')
}

export function montarPromptArtigo(ctx: {
  topico: Topic
  briefing: Briefing
  fatos: Fato[]
  urlsDoSite: string[]
}): string {
  const { topico, briefing: b } = ctx
  const urls = urlsParaArtigo(ctx.urlsDoSite)
  const outline = (b.outline as { h2: string; h3: string[] }[])
    .map((s) => `- ${limpar(s.h2)}${s.h3?.length ? ` (subtópicos: ${s.h3.map((h) => limpar(h)).join('; ')})` : ''}`)
    .join('\n')
  const faq = (b.faq as { pergunta: string }[]).map((f) => `- ${limpar(f.pergunta)}`).join('\n')
  const secundarias = (b.keywordsSecundarias as string[]).map((k) => limpar(k, 80)).join(', ')
  const fatos =
    ctx.fatos.length > 0
      ? `Notas de pesquisa (pistas NÃO verificadas; use com cautela e marque como "verificar"):\n${ctx.fatos
          .map((f) => `- ${limpar(f.afirmacao, 500)}${f.fonte ? ` (fonte: ${limpar(f.fonte, 200)})` : ''}`)
          .join('\n')}`
      : 'Não há notas de pesquisa: escreva apenas o que for consolidado e marque como "verificar" qualquer referência normativa.'
  const links =
    urls.length > 0
      ? `Links internos: use no texto, no formato [âncora](url), SOMENTE estas URLs (não invente nem altere; de 2 a 5 links, quando fizerem sentido):\n${urls.map((u) => `- ${u}`).join('\n')}`
      : 'Não há URLs do site disponíveis: não coloque links.'

  return [
    'Você é redator sênior de um escritório de perícia contábil forense, a OG Perícia Contábil (Oliveira Guimarães, cálculos e perícias).',
    'Escreva em português do Brasil, para advogados de todo o país, em tom técnico, claro e sóbrio.',
    `Tema: ${limpar(topico.titulo)}\nKeyword principal: ${limpar(topico.keyword)}\nIntenção de busca: ${topico.intencao}`,
    `Siga este briefing.\nTítulo sugerido: ${limpar(b.title)}\nMeta description sugerida: ${limpar(b.metaDescription)}\nEstrutura (cada item vira uma seção H2, com os subtópicos como H3):\n${outline}\nPerguntas do FAQ (responda cada uma de forma objetiva):\n${faq}\nKeywords secundárias: ${secundarias || 'nenhuma'}`,
    fatos,
    links,
    'Tamanho: entre 1.200 e 2.000 palavras. Título com até 60 caracteres e a keyword principal; meta description entre 120 e 155 caracteres; slug em minúsculas, sem acento, separado por hífen.',
    'Marque com o campo "verificar" (explicando o que conferir) TODO bloco que mencione lei, artigo, súmula, tema de tribunal, índice, data ou valor.',
    'Proibido: prometer resultado de processo, citar valores de honorários, inventar número de processo, jurisprudência ou estatística.',
    'A conclusão termina convidando o advogado a falar com a OG: perícia contábil 100% remota, para todo o Brasil. Sem sensacionalismo, respeitando o código de ética do CFC.',
    'Use **negrito** e *itálico* só quando necessário. Não use HTML.',
  ].join('\n\n')
}

export function montarPromptReescrita(t: { trecho: string; instrucao: string; keyword: string }): string {
  return [
    'Você é redator de um escritório de perícia contábil forense, escrevendo para advogados, em português do Brasil.',
    `Keyword do artigo: ${limpar(t.keyword)}`,
    `Instrução: ${t.instrucao.trim()}`,
    `Trecho original:\n"""\n${t.trecho}\n"""`,
    'Reescreva o trecho conforme a instrução, mantendo o sentido e sem acrescentar leis, números de processo ou valores novos. Não prometa resultado nem cite honorários.',
    'Devolva só o texto reescrito, em texto puro, sem HTML.',
  ].join('\n\n')
}
