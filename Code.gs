/**
 * ═══════════════════════════════════════════════════════════
 *  EduPro — Backend via Google Apps Script
 *  Cole este código em: script.google.com → Novo Projeto
 *  Depois: Implantar → Novo Implantação → Aplicativo da Web
 *  Acesso: Qualquer pessoa
 * ═══════════════════════════════════════════════════════════
 */

// ── CONFIGURAÇÃO ─────────────────────────────────────────────
// Cole o ID da sua planilha aqui (URL do Google Sheets)
const SHEET_ID = "COLE_O_ID_DA_PLANILHA_AQUI";

// Chave secreta para JWT simples (troque por qualquer texto longo)
const SECRET   = "edupro-chave-secreta-2025";

// Nome da escola
const ESCOLA   = "Escola Municipal";


// ── ROTEADOR PRINCIPAL ───────────────────────────────────────
function doGet(e)  { return rotear(e, "GET");  }
function doPost(e) { return rotear(e, "POST"); }

function rotear(e, method) {
  const path   = (e.parameter.path || "").replace(/^\/+/, "");
  const params = e.parameter || {};
  let   body   = {};

  try {
    if (e.postData?.contents) body = JSON.parse(e.postData.contents);
  } catch(_) {}

  // CORS sempre liberado
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json"
  };

  try {
    let resultado;

    // ── Rotas públicas ──────────────────────────────────────
    if (path === "ping")                  resultado = { ok: true, escola: ESCOLA };
    else if (path === "auth/login")       resultado = login(body);
    else if (path === "auth/cadastro")    resultado = cadastro(body);

    // ── Rotas protegidas ─────────────────────────────────────
    else {
      const prof = autenticar(params.token || body.token || "");
      if (!prof) return resposta({ erro: "Não autorizado" }, 401, headers);

      if      (path === "auth/me")            resultado = prof;
      else if (path === "alunos/listar")      resultado = listarAlunos(prof.id);
      else if (path === "alunos/criar")       resultado = criarAluno(prof.id, body);
      else if (path === "alunos/excluir")     resultado = excluirAluno(prof.id, body.id);
      else if (path === "chamada/salvar")     resultado = salvarChamada(prof.id, body);
      else if (path === "chamada/buscar")     resultado = buscarChamada(prof.id, body.data);
      else if (path === "chamada/todas")      resultado = todasChamadas(prof.id);
      else if (path === "notas/listar")       resultado = listarNotas(prof.id);
      else if (path === "notas/criar")        resultado = criarNota(prof.id, body);
      else if (path === "notas/excluir")      resultado = excluirNota(prof.id, body.id);
      else if (path === "planos/listar")      resultado = listarPlanos(prof.id);
      else if (path === "planos/criar")       resultado = criarPlano(prof.id, body);
      else if (path === "planos/excluir")     resultado = excluirPlano(prof.id, body.id);
      else if (path === "stats")              resultado = stats(prof.id);
      else if (path === "prof/atualizar")     resultado = atualizarProfessor(prof.id, body);
      else if (path === "admin/professores")  resultado = listarProfessores(prof);
      else if (path === "admin/criar-prof")   resultado = criarProfessor(prof, body);
      else if (path === "admin/excluir-prof") resultado = excluirProfessor(prof, body.id);
      else resultado = { erro: "Rota não encontrada: " + path };
    }

    return resposta(resultado, 200, headers);
  } catch(err) {
    return resposta({ erro: err.message, stack: err.stack }, 500, headers);
  }
}

function resposta(data, code, headers) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ════════════════════════════════════════════════════════════
// PLANILHA — Helpers
// ════════════════════════════════════════════════════════════

function getSheet(nome) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  return sh;
}

function getRows(nome) {
  const sh = getSheet(nome);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function appendRow(nome, obj) {
  const sh = getSheet(nome);
  const data = sh.getDataRange().getValues();
  const headers = data.length ? data[0] : Object.keys(obj);
  if (data.length === 0) sh.appendRow(headers);
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ""));
  return obj;
}

function updateRow(nome, campo, valor, updates) {
  const sh = getSheet(nome);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idx = headers.indexOf(campo);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx]) === String(valor)) {
      Object.entries(updates).forEach(([k, v]) => {
        const ci = headers.indexOf(k);
        if (ci >= 0) sh.getRange(i + 1, ci + 1).setValue(v);
      });
      return true;
    }
  }
  return false;
}

function deleteRow(nome, campo, valor) {
  const sh = getSheet(nome);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idx = headers.indexOf(campo);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idx]) === String(valor)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function agora() {
  return new Date().toISOString();
}


// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════

function hashSenha(senha) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      senha + SECRET, Utilities.Charset.UTF_8)
  );
}

function criarToken(profId) {
  const payload = { id: profId, exp: Date.now() + 12 * 3600 * 1000 };
  return Utilities.base64Encode(JSON.stringify(payload)) + "." +
         Utilities.base64Encode(Utilities.computeDigest(
           Utilities.DigestAlgorithm.SHA_256,
           JSON.stringify(payload) + SECRET,
           Utilities.Charset.UTF_8
         ).map(b => (b + 256) % 256).join(","));
}

function autenticar(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const payload = JSON.parse(Utilities.newBlob(
      Utilities.base64Decode(parts[0])
    ).getDataAsString());
    if (payload.exp < Date.now()) return null;
    const profs = getRows("professores");
    return profs.find(p => p.id === payload.id) || null;
  } catch(_) { return null; }
}

function login(body) {
  const { email, senha } = body;
  if (!email || !senha) throw new Error("E-mail e senha obrigatórios");
  const profs = getRows("professores");
  const prof  = profs.find(p => p.email === email && p.ativo !== "false");
  if (!prof || prof.senha_hash !== hashSenha(senha))
    throw new Error("E-mail ou senha incorretos");
  return {
    token: criarToken(prof.id),
    professor: _profPublic(prof)
  };
}

function cadastro(body) {
  const { nome, email, senha, turma, escola, codigo } = body;
  // Código de convite simples para evitar cadastros indevidos
  if (codigo !== "EDUPRO2025") throw new Error("Código de acesso inválido");
  if (!nome || !email || !senha) throw new Error("Campos obrigatórios");
  const profs = getRows("professores");
  if (profs.find(p => p.email === email)) throw new Error("E-mail já cadastrado");
  const id = gerarId();
  const isAdmin = profs.length === 0; // primeiro usuário vira admin
  const prof = {
    id, nome, email,
    senha_hash: hashSenha(senha),
    turma: turma || "", escola: escola || ESCOLA,
    is_admin: isAdmin ? "true" : "false",
    api_key: "", ativo: "true",
    criado_em: agora()
  };
  // Garante cabeçalhos
  const sh = getSheet("professores");
  if (sh.getLastRow() === 0) {
    sh.appendRow(["id","nome","email","senha_hash","turma","escola","is_admin","api_key","ativo","criado_em"]);
  }
  appendRow("professores", prof);
  return { token: criarToken(id), professor: _profPublic(prof) };
}

function _profPublic(p) {
  return { id:p.id, nome:p.nome, email:p.email, turma:p.turma,
           escola:p.escola||ESCOLA, is_admin: p.is_admin==="true" };
}

function atualizarProfessor(profId, body) {
  const updates = {};
  if (body.nome)   updates.nome   = body.nome;
  if (body.turma)  updates.turma  = body.turma;
  if (body.escola) updates.escola = body.escola;
  if (body.api_key !== undefined) updates.api_key = body.api_key;
  if (body.senha)  updates.senha_hash = hashSenha(body.senha);
  updateRow("professores", "id", profId, updates);
  return { ok: true };
}


// ════════════════════════════════════════════════════════════
// ALUNOS
// ════════════════════════════════════════════════════════════

function listarAlunos(profId) {
  return getRows("alunos")
    .filter(a => a.prof_id === profId && a.ativo !== "false")
    .sort((a,b) => (parseInt(a.numero)||0) - (parseInt(b.numero)||0));
}

function criarAluno(profId, body) {
  const sh = getSheet("alunos");
  if (sh.getLastRow() === 0)
    sh.appendRow(["id","prof_id","nome","numero","sala","ativo","criado_em"]);
  const aluno = {
    id: gerarId(), prof_id: profId,
    nome: body.nome, numero: body.numero || "",
    sala: body.sala || "", ativo: "true", criado_em: agora()
  };
  appendRow("alunos", aluno);
  return aluno;
}

function excluirAluno(profId, id) {
  updateRow("alunos", "id", id, { ativo: "false" });
  return { ok: true };
}


// ════════════════════════════════════════════════════════════
// CHAMADAS
// ════════════════════════════════════════════════════════════

function salvarChamada(profId, body) {
  const { data, materia, registros } = body;
  const sh = getSheet("chamadas");
  if (sh.getLastRow() === 0)
    sh.appendRow(["id","prof_id","data","materia","registros_json","criado_em"]);

  // Verifica se já existe
  const rows = getRows("chamadas");
  const existente = rows.find(r => r.prof_id === profId && r.data === data);

  if (existente) {
    updateRow("chamadas","id", existente.id, {
      materia: materia || "",
      registros_json: JSON.stringify(registros || {})
    });
  } else {
    appendRow("chamadas", {
      id: gerarId(), prof_id: profId, data,
      materia: materia || "",
      registros_json: JSON.stringify(registros || {}),
      criado_em: agora()
    });
  }
  return { ok: true, data };
}

function buscarChamada(profId, data) {
  const rows = getRows("chamadas");
  const ch   = rows.find(r => r.prof_id === profId && r.data === data);
  if (!ch) return { data, registros: {}, materia: "" };
  return {
    id: ch.id, data: ch.data, materia: ch.materia,
    registros: JSON.parse(ch.registros_json || "{}")
  };
}

function todasChamadas(profId) {
  return getRows("chamadas")
    .filter(r => r.prof_id === profId)
    .map(r => ({
      id: r.id, data: r.data, materia: r.materia,
      registros: JSON.parse(r.registros_json || "{}")
    }))
    .sort((a,b) => a.data.localeCompare(b.data));
}


// ════════════════════════════════════════════════════════════
// NOTAS
// ════════════════════════════════════════════════════════════

function listarNotas(profId) {
  return getRows("notas")
    .filter(n => n.prof_id === profId && n.ativo !== "false")
    .sort((a,b) => b.criado_em.localeCompare(a.criado_em));
}

function criarNota(profId, body) {
  const sh = getSheet("notas");
  if (sh.getLastRow() === 0)
    sh.appendRow(["id","prof_id","aluno_nome","categoria","texto","ativo","criado_em"]);
  const nota = {
    id: gerarId(), prof_id: profId,
    aluno_nome: body.aluno_nome, categoria: body.categoria || "aprendizado",
    texto: body.texto, ativo: "true", criado_em: agora()
  };
  appendRow("notas", nota);
  return nota;
}

function excluirNota(profId, id) {
  updateRow("notas","id", id, { ativo: "false" });
  return { ok: true };
}


// ════════════════════════════════════════════════════════════
// PLANOS
// ════════════════════════════════════════════════════════════

function listarPlanos(profId) {
  return getRows("planos")
    .filter(p => p.prof_id === profId && p.ativo !== "false")
    .sort((a,b) => b.criado_em.localeCompare(a.criado_em));
}

function criarPlano(profId, body) {
  const sh = getSheet("planos");
  if (sh.getLastRow() === 0)
    sh.appendRow(["id","prof_id","materia","serie","tema","duracao","objetivo","conteudo","ativo","criado_em"]);
  const plano = {
    id: gerarId(), prof_id: profId,
    materia: body.materia, serie: body.serie, tema: body.tema,
    duracao: body.duracao || "", objetivo: body.objetivo || "",
    conteudo: body.conteudo || "", ativo: "true", criado_em: agora()
  };
  appendRow("planos", plano);
  return plano;
}

function excluirPlano(profId, id) {
  updateRow("planos","id", id, { ativo: "false" });
  return { ok: true };
}


// ════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════

function stats(profId) {
  const hoje    = new Date().toISOString().split("T")[0];
  const alunos  = listarAlunos(profId);
  const notas   = listarNotas(profId);
  const planos  = listarPlanos(profId);
  const chamada = buscarChamada(profId, hoje);
  const presentes = Object.values(chamada.registros).filter(v=>v==="presente").length;
  return {
    alunos: alunos.length, notas: notas.length,
    planos: planos.length, presentes_hoje: presentes
  };
}


// ════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════

function listarProfessores(prof) {
  if (prof.is_admin !== "true") throw new Error("Acesso negado");
  return getRows("professores")
    .filter(p => p.ativo !== "false")
    .map(_profPublic);
}

function criarProfessor(prof, body) {
  if (prof.is_admin !== "true") throw new Error("Acesso negado");
  return cadastro({ ...body, codigo: "EDUPRO2025" });
}

function excluirProfessor(prof, id) {
  if (prof.is_admin !== "true") throw new Error("Acesso negado");
  updateRow("professores","id", id, { ativo: "false" });
  return { ok: true };
}


// ════════════════════════════════════════════════════════════
// TESTE — rode esta função para verificar se está funcionando
// ════════════════════════════════════════════════════════════
function testar() {
  Logger.log("Testando conexão com planilha...");
  const sh = getSheet("professores");
  Logger.log("Planilha OK: " + sh.getName());
  Logger.log("Linhas: " + sh.getLastRow());
}
