import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const sessions = new Map();
const config = process.env;
const url = config.SUPABASE_URL?.replace(/\/$/, '');
const key = config.SUPABASE_PUBLISHABLE_KEY;
const deployed = config.VERCEL === '1' || config.NODE_ENV === 'production';
const secret = /^[a-f0-9]{64}$/i.test(config.GP_SESSION_SECRET ?? '') ? Buffer.from(config.GP_SESSION_SECRET,'hex') : null;
const allowedOrigins = new Set(deployed
  ? [config.GP_ORIGIN, ...[config.VERCEL_URL,config.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host => 'https://' + host)].filter(Boolean)
  : ['http://127.0.0.1:4173']);
function storeSession(sessionId, token, expires) {
  if (!deployed) {
    sessions.set(sessionId,{token,expires});
    return sessionId;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',secret,iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify({token,expires}),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64url');
}
function readSession(value) {
  if (!deployed) return sessions.get(value);
  if (!secret || !value || value.length > 4000) return null;
  try {
    const bytes = Buffer.from(value,'base64url');
    const decipher = createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  } catch { return null; }
}

const resources = {
  bill: ['contas', 'bills', 'id,descricao,vencimento,valor_centavos,pago_em,recorrente,conta_origem_id,mes_recorrencia'],
  income: ['ganhos', 'income', 'id,origem,descricao,recebido_em,valor_centavos,fonte_id'],
  reserve: ['reservas', 'reserve', 'id,data,tipo,valor_centavos'],
  source: ['fontes_renda', 'sources', 'id,nome,arquivada_em'],
  target: ['metas_por_fonte', 'targets', 'fonte_id,periodo,inicio,meta_centavos,recorrente'],
  goal: ['metas_mensais', 'goals', 'mes,meta_centavos,recorrente'],
};
const kinds = { initial: 'saldo_inicial', deposit: 'deposito', withdrawal: 'retirada' };
const periods = { week: 'semana', month: 'mes' };
const invert = (map, value) => Object.keys(map).find(key => map[key] === value);
const targetKey = row => [row.fonte_id, row.periodo, row.inicio].join('/');
const fromDb = {
  bill: r => ({ id:r.id, name:r.descricao, date:r.vencimento, amount:r.valor_centavos, paid:!!r.pago_em, paidDate:r.pago_em, recurring:r.recorrente, originId:r.conta_origem_id, recurringMonth:r.mes_recorrencia }),
  income: r => ({ id:r.id, name:r.descricao, date:r.recebido_em, amount:r.valor_centavos, source:r.fonte_id, legacyOrigin:r.origem }),
  reserve: r => ({ id:r.id, date:r.data, kind:invert(kinds,r.tipo), amount:r.tipo === 'retirada' ? -r.valor_centavos : r.valor_centavos }),
  source: r => ({ id:r.id, name:r.nome, archived:!!r.arquivada_em, archivedAt:r.arquivada_em }),
  target: r => ({ id:targetKey(r), source:r.fonte_id, period:invert(periods,r.periodo), date:r.inicio, amount:r.meta_centavos, recurring:r.recorrente }),
};
const iso = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure(400);
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== value) throw failure(400);
  return value;
};
const uuid = value => {
  if (typeof value !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) throw failure(400);
  return value;
};
const description = (value, max, optional = false) => {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw failure(400);
  return value.trim();
};
const cents = (value, min = 1) => {
  if (!Number.isSafeInteger(value) || value < min || value > 999999999999) throw failure(400);
  return value;
};
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
function failure(status) { return Object.assign(new Error('Operação indisponível'), { status }); }
async function upstream(path, { token, method = 'GET', data, schema = false } = {}) {
  const response = await fetch(url + path, {
    method,
    signal: AbortSignal.timeout(12000),
    headers: {
      apikey:key, ...(token ? { Authorization:'Bearer '+token } : {}),
      ...(data ? { 'Content-Type':'application/json' } : {}),
      ...(schema ? { 'Accept-Profile':'gestao_pessoal', 'Content-Profile':'gestao_pessoal', Prefer:'return=representation' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) {
    if (!schema && [400,401,403,429].includes(response.status)) {
      const problem = await response.json().catch(() => null);
      const code = problem?.error_code ?? problem?.code;
      if (code === 'invalid_credentials') throw failure(401);
      if (response.status === 429) throw failure(429);
      if (code === 'captcha_failed') throw failure(422);
      console.error('Supabase Auth rejected request', response.status, typeof code === 'string' && /^[a-z_]{1,80}$/.test(code) ? code : 'unknown');
      throw failure(502);
    }
    if (response.status === 401) throw failure(401);
    if (response.status === 409) throw failure(409);
    if (schema && [403,404,406].includes(response.status)) throw failure(503);
    if (schema && response.status === 400) throw failure(400);
    throw failure(502);
  }
  return response.status === 204 ? null : response.json();
}
function cookie(value, seconds) {
  return 'gp_session=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + seconds + (deployed ? '; Secure' : '');
}
async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw failure(415);
  if (request.body !== undefined) {
    const parsed = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(parsed) > 8192) throw failure(413);
    try { return JSON.parse(parsed); } catch { throw failure(400); }
  }
  let body = '';
  for await (const part of request) {
    body += part;
    if (Buffer.byteLength(body) > 8192) throw failure(413);
  }
  try { return JSON.parse(body); } catch { throw failure(400); }
}
function respond(response, code, result, sessionCookie) {
  response.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', ...(sessionCookie ? {'Set-Cookie':sessionCookie} : {}),
  }).end(JSON.stringify(result));
}
async function getAll(type, token) {
  const [table,,columns] = resources[type];
  const order = type === 'goal' ? 'mes' : type === 'target' ? 'fonte_id,periodo,inicio' : 'id';
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const part = await upstream('/rest/v1/'+table+'?select='+columns+'&order='+order+'&limit=200&offset='+offset,{token,schema:true});
    rows.push(...part);
    if (part.length < 200) return rows;
  }
}
function filters(type, id) {
  const q = new URLSearchParams();
  if (type === 'goal') q.set('mes','eq.'+iso(id));
  else if (type === 'target') {
    const [source,period,date,...rest] = String(id).split('/');
    if (!['semana','mes'].includes(period) || rest.length) throw failure(400);
    q.set('fonte_id','eq.'+uuid(source)); q.set('periodo','eq.'+period); q.set('inicio','eq.'+iso(date));
  } else q.set('id','eq.'+uuid(id));
  return '?'+q.toString();
}
async function save(body, token) {
  const { type, id, record:r } = body;
  if (!Object.hasOwn(resources,type) || !r || Array.isArray(r) || typeof r !== 'object') throw failure(400);
  const [table] = resources[type];
  let data;
  switch (type) {
    case 'bill':
      data={descricao:description(r.name,200),vencimento:iso(r.date),valor_centavos:cents(r.amount),
        pago_em:r.paid ? (r.paidDate ? iso(r.paidDate) : today()) : null,recorrente:r.recurring === true};
      if (!id && r.originId) {
        const originId = uuid(r.originId);
        const recurringMonth = iso(r.recurringMonth);
        const [originBill] = await upstream('/rest/v1/contas?select=recorrente,vencimento&id=eq.'+originId,{token,schema:true});
        if (!originBill?.recorrente || recurringMonth.slice(0,7) <= originBill.vencimento.slice(0,7)) throw failure(400);
        Object.assign(data,{recorrente:false,conta_origem_id:originId,mes_recorrencia:recurringMonth});
      }
      break;
    case 'income': {
      const source = uuid(r.source);
      const [row] = await upstream('/rest/v1/fontes_renda?select=nome,arquivada_em&id=eq.'+source,{token,schema:true});
      if (!row) throw failure(404);
      if (row.arquivada_em) {
        if (!id) throw failure(400);
        const [existing] = await upstream('/rest/v1/ganhos?select=fonte_id&id=eq.'+uuid(id),{token,schema:true});
        if (existing?.fonte_id !== source) throw failure(400);
      }
      data={fonte_id:source,origem:row.nome,descricao:description(r.name,200,true),recebido_em:iso(r.date),valor_centavos:cents(r.amount)}; break;
    }
    case 'reserve':
      if (!Object.hasOwn(kinds,r.kind)) throw failure(400);
      data={tipo:kinds[r.kind],data:iso(r.date),valor_centavos:cents(Math.abs(r.amount))}; break;
    case 'source':
      data={nome:description(r.name,100),arquivada_em:r.archived ? (r.archivedAt ?? new Date().toISOString()) : null}; break;
    case 'target':
      if (!Object.hasOwn(periods,r.period)) throw failure(400);
      data={fonte_id:uuid(r.source),periodo:periods[r.period],inicio:iso(r.date),meta_centavos:cents(r.amount),recorrente:r.period === 'month' && r.recurring === true}; break;
    case 'goal':
      data={mes:iso(r.date),meta_centavos:cents(r.amount,0),recorrente:r.recurring === true}; break;
  }
  const result = await upstream('/rest/v1/'+table+(id ? filters(type,id) : ''),{token,schema:true,method:id?'PATCH':'POST',data});
  if (!result?.length) throw failure(404);
  return type === 'goal' ? {date:result[0].mes,amount:result[0].meta_centavos,recurring:result[0].recorrente} : fromDb[type](result[0]);
}
const messages = {
  400:'Confira os dados do lançamento.', 401:'Credenciais inválidas ou sessão expirada.',
  403:'Esta conta ainda não tem acesso ao Gestão Pessoal.', 422:'A verificação de segurança do login não foi concluída.', 429:'Muitas tentativas. Aguarde antes de tentar de novo.', 404:'Registro indisponível.', 409:'Já existe um registro com esses dados.',
  503:'O acesso do aplicativo ao Supabase ainda precisa ser configurado.',
};
export async function api(request,response) {
  try {
    if (request.method === 'POST' && !allowedOrigins.has(request.headers.origin)) throw failure(403);
    const sessionId = request.headers.cookie?.match(/(?:^|; )gp_session=([A-Za-z0-9_-]{1,4000})(?:;|$)/)?.[1];
    const now = Date.now();
    for (const [id,entry] of sessions) if (entry.expires <= now) sessions.delete(id);
    if (request.url === '/api/logout' && request.method === 'POST') {
      sessions.delete(sessionId); respond(response,200,{},cookie('',0)); return;
    }
    if (!url || !key || (deployed && !secret)) throw failure(503);
    if (request.url === '/api/login' && request.method === 'POST') {
      const {email,password} = await jsonBody(request);
      if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 512) throw failure(400);
      const auth = await upstream('/auth/v1/token?grant_type=password',{method:'POST',data:{email,password}});
      if (typeof auth.access_token !== 'string' || !Number.isFinite(auth.expires_in) || auth.expires_in <= 0) throw failure(502);
      sessions.delete(sessionId);
      const id = randomBytes(32).toString('hex');
      const seconds = Math.min(3600, auth.expires_in);
      const value = storeSession(id,auth.access_token,now+seconds*1000);
      if (value.length > 3800) throw failure(502);
      respond(response,200,{},cookie(value,seconds)); return;
    }
    const session = readSession(sessionId);
    if (!session || session.expires <= now) throw failure(401);
    if (request.url === '/api/state' && request.method === 'GET') {
      if (await upstream('/rest/v1/rpc/tem_acesso_app',{token:session.token,schema:true}) !== true) throw failure(403);
      const pairs = await Promise.all(Object.entries(resources).map(async ([type,[,property]]) => {
        const rows = await getAll(type,session.token);
        return [property,type==='goal'?Object.fromEntries(rows.map(row=>[row.mes.slice(0,7),{amount:row.meta_centavos,recurring:row.recorrente}])):rows.map(fromDb[type])];
      }));
      respond(response,200,Object.fromEntries(pairs)); return;
    }
    if (request.url === '/api/entry' && request.method === 'POST') {
      respond(response,200,await save(await jsonBody(request),session.token)); return;
    }
    throw failure(404);
  } catch (error) {
    const status = error.status ?? 502;
    respond(response,status,{error:messages[status] ?? 'Não foi possível concluir a operação.'});
  }
}
