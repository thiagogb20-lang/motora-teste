// Dados de teste compartilhados (não é arquivo de teste).
import type { Cfg, Db } from '../nucleo.ts';
import { agoraSP } from '../nucleo.ts';

export const CFG_PADRAO: Cfg = {
 "versao": 2,
 "ia_ligada": false,
 "modo": "sugerir",
 "horario_ia": {
  "modo": "sempre",
  "janelas": {
   "0": null,
   "1": {
    "inicio": "08:00",
    "fim": "23:00"
   },
   "2": {
    "inicio": "08:00",
    "fim": "23:00"
   },
   "3": {
    "inicio": "08:00",
    "fim": "23:00"
   },
   "4": {
    "inicio": "08:00",
    "fim": "23:00"
   },
   "5": {
    "inicio": "08:00",
    "fim": "23:00"
   },
   "6": {
    "inicio": "07:00",
    "fim": "12:00"
   }
  }
 },
 "atender": "todos_menos_ignorados",
 "ignorados": [],
 "atraso_resposta_seg": {
  "min": 8,
  "max": 25
 },
 "pausa_quando_dono_responde_min": 30,
 "falar_com_dono": {
  "palavras": [
   "falar com o dono",
   "falar com voce",
   "atendente",
   "pessoa de verdade"
  ],
  "mensagem": "Certo! Vou chamar o {dono}, ele já te responde.",
  "pausa_min": 240
 },
 "limite_respostas_por_contato_hora": 10,
 "mensagem_fora_do_horario": "",
 "boas_vindas_desconhecidos": "",
 "cadastrar_desconhecidos": true,
 "tom_de_voz": "simpático, curto e direto, como conversa de WhatsApp",
 "usar_emojis": true,
 "assinatura": "",
 "nome_dono": "",
 "nome_negocio": "Campos de Futebol",
 "endereco": "",
 "link_mapa": "",
 "precos": {
  "avulso": null,
  "fixo": null,
  "especiais": [],
  "observacao": ""
 },
 "pagamento": {
  "texto": "",
  "pix_chave": "",
  "sinal_obrigatorio": false,
  "sinal_valor": null
 },
 "antecedencia_minima_reserva_h": 2,
 "max_dias_reserva_frente": 14,
 "permitir_ia_reservar": false,
 "permitir_ia_cancelar": false,
 "permitir_ia_confirmar": true,
 "cancelamento_regra_h": 24,
 "confirmacao_auto": false,
 "confirmacao_manha_hora": "09:00",
 "confirmacao_tarde_hora": "15:00",
 "confirmacao_ultima_hora": "21:00",
 "liberar_fixo_sem_resposta": {
  "ligado": false,
  "hora": "20:00"
 },
 "modelos": {
  "manha": "Bom dia {nome}! Confirma o futebol amanhã ({dia}) às {hora}h no {campo}?",
  "tarde": "Oi {nome}, ainda não tive retorno: amanhã ({dia}) {hora}h no {campo}, confirma?",
  "reserva_confirmada": "Fechado, {nome}! {dia} às {hora}h no {campo} está reservado. {pagamento}",
  "cancelamento": "Pronto, {nome}, cancelei {dia} às {hora}h no {campo}.",
  "confirmou": "Show, {nome}! Confirmado amanhã às {hora}h no {campo}.",
  "nao_vem": "Tudo bem, {nome}! Liberamos o horário de amanhã. Até a próxima!"
 },
 "notificar_dono": {
  "falar_com_dono": true,
  "nova_reserva": true,
  "cancelamento": true,
  "nao_vem": true,
  "erro_ia": true,
  "robo_offline": true,
  "sugestao_nova": true
 },
 "grade": {
  "0": [],
  "1": [
   19,
   20,
   21,
   22
  ],
  "2": [
   20,
   21,
   22
  ],
  "3": [
   19,
   20,
   21,
   22
  ],
  "4": [
   20,
   21,
   22
  ],
  "5": [
   17,
   18,
   19,
   20,
   21,
   22
  ],
  "6": [
   8,
   9
  ]
 },
 "campos": {
  "1": "Campo 1",
  "2": "Campo 2"
 },
 "duracao_min": 60,
 "dias_livres_no_prompt": 7,
 "ia": {
  "provedor": "gemini",
  "gemini_modelo": "gemini-2.5-flash",
  "groq_modelo": "llama-3.3-70b-versatile",
  "usar_reserva_groq": true,
  "temperatura": 0.4,
  "max_tokens": 600,
  "historico_msgs": 12,
  "exemplos_chars": 6000,
  "timeout_seg": 25
 },
 "robo": {
  "pausa_envio_seg": {
   "min": 3,
   "max": 9
  },
  "max_envios_por_minuto": 8
 }
};

export function cfg(extra: Cfg = {}): Cfg { return { ...structuredClone(CFG_PADRAO), ...extra }; }

/** Horário de SP -> Agora. Ex.: sp('2026-10-27T10:00') (SP = UTC-3). */
export function sp(local: string) { return agoraSP(new Date(local + ':00-03:00')); }

export function db(extra: Partial<Db> = {}, cfgExtra: Cfg = {}): Db {
  return {
    cfg: cfg(cfgExtra),
    regras: [
      { texto: 'Domingo fechado.', ativa: true, ordem: 2 },
      { texto: 'Clientes fixos têm prioridade.', ativa: true, ordem: 1 },
      { texto: 'REGRA_DESLIGADA_XYZ', ativa: false, ordem: 3 },
    ],
    clientes: [
      { id: 'ana', nome: 'Ana Souza', telefone: '5511987654321', tipo: 'fixo', ignorar: false, fixos: [{ dia: 3, hora: 20, campo: 1 }, { dia: 6, hora: 8, campo: 1 }] },
      { id: 'beto', nome: 'Beto', telefone: '5511912345678', tipo: 'avulso', ignorar: false, fixos: [] },
      { id: 'caio', nome: 'Caio', telefone: '', tipo: 'fixo', ignorar: false, fixos: [{ dia: 3, hora: 21, campo: 2 }] },
    ],
    reservas: [{ id: 'r1', data: '2026-10-30', hora: 19, campo: 2, clienteId: 'beto', pago: false }],
    excecoes: [],
    confirmacoes: {},
    exemplos: [],
    ...extra,
  };
}
