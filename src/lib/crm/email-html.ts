import { urlPublicaPainel } from '@/lib/acesso-publico'
import {
  aplicarMarcadores,
  ASSINATURA,
  EMAILS_FUNIS,
  escaparHtml,
  LINHA_DESCADASTRO,
  MARCADOR_DESCADASTRO,
  MARCADOR_WHATSAPP,
  NOME_EMPRESA,
  type EmailFunil,
} from './funis-conteudo'
import { SLUGS_FUNIS, type SlugFunil } from './funis-regras'

/**
 * HTML e texto de um email de funil, no modelo da marca: tabela de 600 px com estilos inline
 * (sobrevive aos clientes de email), logo pela URL pública do painel, dourado `#DAA522`,
 * parágrafos, assinatura e rodapé com a empresa, o motivo do envio e o descadastro.
 *
 * Todo texto é escapado (o nome vem do formulário do site). Sem `WHATSAPP_LINK`, a frase do
 * WhatsApp sai do email: nunca vai `[link do WhatsApp]` para o advogado.
 */

export const DOURADO = '#DAA522'
const ESCURO = '#0E0F11'
const CLARO = '#F5F3EE'
export const TINTA = '#1F2933'
const FONTE = 'Arial,Helvetica,sans-serif'
const SAUDACAO = 'Prezado(a) Dr(a).,'
const MAX_NOME = 100

const MOTIVO: Record<SlugFunil, string> = {
  'boas-vindas': 'pediu contato pelo formulário do nosso site',
  'nutricao-blog': 'autorizou o envio dos nossos conteúdos ou é nosso cliente',
  reativacao: 'já é nosso cliente',
  'prospeccao-fria': 'usamos o seu contato profissional com base no legítimo interesse, como explicado acima',
}
const MOTIVO_PADRAO = 'tem um relacionamento profissional com o nosso escritório'

const W = MARCADOR_WHATSAPP.replace(/[[\]]/g, '\\$&')
/**
 * "..., ou fale conosco pelo WhatsApp: [link]." → "...". Só o último "ou" antes do WhatsApp: o
 * trecho entre ele e o marcador não pode ter outro "ou" ("feito ou revisado, ... ou fale").
 */
const ALTERNATIVA_WHATSAPP = new RegExp(`,?\\s+ou\\s+(?:(?!\\sou\\s)[^.:\\n])*?WhatsApp:\\s*${W}`, 'g')
/** Frase só do WhatsApp ("Também atendemos pelo WhatsApp: [link].") sai inteira. */
const FRASE_WHATSAPP = new RegExp(`\\s*[^.\\n]*WhatsApp:\\s*${W}\\.`, 'g')

/** Tira as chamadas para o WhatsApp de um texto (sem link configurado). */
export function removerFraseWhatsapp(texto: string): string {
  return texto.replace(ALTERNATIVA_WHATSAPP, '').replace(FRASE_WHATSAPP, '')
}

function slugDoEmail(e: EmailFunil): SlugFunil | null {
  return SLUGS_FUNIS.find((s) => EMAILS_FUNIS[s].includes(e)) ?? null
}

function limparNome(nome: string | null): string {
  // Sem quebras nem caracteres de controle (o nome vai também para o texto puro).
  return (nome ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOME)
}

/**
 * Modelo da marca compartilhado (funis e newsletter): tabela de 600 px, logo, corpo e rodapé escuro com
 * a empresa, o motivo do envio e o descadastro. O pré-cabeçalho vai num div oculto no topo do corpo
 * (o Resend não tem campo próprio). `corpoHtml` já vem escapado e montado por quem chama.
 */
export function montarLayoutMarca(l: {
  titulo: string
  preCabecalho: string
  corpoHtml: string
  motivo: string
  urlDescadastro: string
}): string {
  // Cabeçalho branco: a versão do logo para fundo claro (a dourada de `logo-og.png` é para fundo escuro).
  const logo = escaparHtml(`${urlPublicaPainel()}/logo-og-claro.png`)
  const href = escaparHtml(l.urlDescadastro)
  const link = `<a href="${href}" style="color:${DOURADO};text-decoration:underline">descadastre-se aqui</a>`
  return [
    '<!doctype html>',
    `<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(l.titulo)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CLARO}">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escaparHtml(l.preCabecalho)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CLARO}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#FFFFFF;border-top:4px solid ${DOURADO}">`,
    `<tr><td style="padding:24px 32px 8px"><img src="${logo}" width="200" alt="Oliveira Guimarães" style="display:block;border:0;outline:none;height:auto;width:200px;max-width:100%"></td></tr>`,
    `<tr><td style="padding:16px 32px 24px;font-family:${FONTE};font-size:16px;line-height:1.6;color:${TINTA}">${l.corpoHtml}</td></tr>`,
    `<tr><td style="padding:20px 32px;background:${ESCURO};font-family:${FONTE};font-size:12px;line-height:1.5;color:${CLARO}">`,
    `<p style="margin:0 0 8px;color:${DOURADO};font-weight:bold">${escaparHtml(NOME_EMPRESA)}</p>`,
    `<p style="margin:0 0 8px">${escaparHtml(l.motivo)}</p>`,
    `<p style="margin:0">Se não quiser mais receber estes emails, ${link}.</p>`,
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('\n')
}

export function montarEmail(
  e: EmailFunil,
  ctx: { nome: string | null; urlDescadastro: string; whatsapp: string | null },
): { html: string; texto: string; assunto: string } {
  const whatsapp = ctx.whatsapp?.trim() || null
  let corpo = whatsapp ? aplicarMarcadores(e.corpo, { whatsapp }) : removerFraseWhatsapp(e.corpo)
  const nome = limparNome(ctx.nome)
  if (nome && corpo.startsWith(SAUDACAO)) corpo = `Prezado(a) Dr(a). ${nome},${corpo.slice(SAUDACAO.length)}`
  const paragrafos = corpo.split('\n\n').map((p) => p.trim()).filter(Boolean)
  const slug = slugDoEmail(e)
  const motivo = `Você recebeu este email porque ${slug ? MOTIVO[slug] : MOTIVO_PADRAO}.`

  const texto = [...paragrafos.map((p) => p.split(MARCADOR_DESCADASTRO).join(ctx.urlDescadastro)), '—', NOME_EMPRESA, motivo].join('\n\n')

  const href = escaparHtml(ctx.urlDescadastro)
  const link = (rotulo: string) => `<a href="${href}" style="color:${DOURADO};text-decoration:underline">${rotulo}</a>`
  const htmlParagrafo = (p: string): string => {
    let h = escaparHtml(p)
    if (whatsapp) {
      const w = escaparHtml(whatsapp)
      h = h.split(w).join(`<a href="${w}" style="color:${DOURADO}">${w}</a>`)
    }
    h = h.split(MARCADOR_DESCADASTRO).join(link('descadastre-se aqui'))
    return h.replace(/\n/g, '<br>')
  }
  const corpoHtml = paragrafos
    // A linha padrão de descadastro vai para o rodapé; o bloco de LGPD da prospecção fica no corpo.
    .filter((p) => p !== LINHA_DESCADASTRO)
    .map((p) =>
      p === ASSINATURA
        ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${DOURADO};color:${TINTA}">${htmlParagrafo(p)}</p>`
        : `<p style="margin:0 0 16px">${htmlParagrafo(p)}</p>`,
    )
    .join('')

  const html = montarLayoutMarca({
    titulo: e.assunto,
    preCabecalho: e.preCabecalho,
    corpoHtml,
    motivo,
    urlDescadastro: ctx.urlDescadastro,
  })

  return { html, texto, assunto: e.assunto }
}
