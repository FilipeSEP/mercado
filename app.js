// =========================================================
// Lista do Mercado - login + banco (Supabase) + modo offline
//
// Como o offline funciona:
//  1. Toda alteração é aplicada na hora na tela e guardada no celular
//     (localStorage), mesmo sem internet.
//  2. Cada alteração entra numa "fila". Quando a internet volta, a fila é
//     enviada ao Supabase na ordem em que aconteceu.
//  3. O service worker (sw.js) guarda os arquivos do app pra ele abrir offline.
// =========================================================

if (!window.supabase) {
  const el = document.getElementById('login-error');
  if (el) el.textContent = 'Não foi possível carregar o app. Verifique a internet e atualize a página.';
  throw new Error('Biblioteca do Supabase não carregou');
}

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

const CACHE_KEY = 'mercado:items';
const QUEUE_KEY = 'mercado:queue';
const LOGGED_KEY = 'mercado:logged';

let items = [];
let realtimeChannel = null;
let flushing = false;

// Elementos do DOM - login
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const appRoot = document.getElementById('app-root');

// Elementos do DOM - app
const shoppingListEl = document.getElementById('shopping-list');
const checkedListEl = document.getElementById('checked-list');
const remainingCountEl = document.getElementById('remaining-count');
const checkedCountEl = document.getElementById('checked-count');
const addBtn = document.getElementById('add-btn');
const itemInput = document.getElementById('item-input');
const itemQtyInput = document.getElementById('item-qty-input');
const itemUnitInput = document.getElementById('item-unit-input');
const finishBuyBtn = document.getElementById('finish-buy-btn');
const totalAmountInput = document.getElementById('total-amount');
const clearCartBtn = document.getElementById('clear-cart-btn');
const estimatedTotalEl = document.getElementById('estimated-total');
const syncStatusEl = document.getElementById('sync-status');

// Fica true assim que o usuário digita algo manualmente no campo de total,
// pra pararmos de sobrescrever o valor dele com o cálculo automático.
let totalEditedManually = false;
totalAmountInput.addEventListener('input', () => { totalEditedManually = true; });

// =========================================================
// ARMAZENAMENTO LOCAL (cache da lista + fila de alterações)
// =========================================================

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Não foi possível salvar no celular:', e);
  }
}

const getQueue = () => readJSON(QUEUE_KEY, []);
const saveQueue = (q) => writeJSON(QUEUE_KEY, q);
const saveCache = () => writeJSON(CACHE_KEY, items);

function enqueue(...ops) {
  saveQueue(getQueue().concat(ops));
  updateSyncStatus();
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Plano B para navegadores antigos
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// =========================================================
// AVISO DE STATUS (offline / alterações pendentes)
// =========================================================

function updateSyncStatus() {
  const pending = getQueue().length;
  const offline = !navigator.onLine;

  if (offline) {
    syncStatusEl.className = 'sync-status offline';
    syncStatusEl.textContent = pending > 0
      ? `Sem internet. ${pending} alteração(ões) guardada(s) no celular, serão enviadas quando voltar.`
      : 'Sem internet. Você pode continuar usando a lista normalmente.';
  } else if (pending > 0) {
    syncStatusEl.className = 'sync-status pending';
    syncStatusEl.textContent = `Enviando ${pending} alteração(ões)...`;
  } else {
    syncStatusEl.className = 'sync-status hidden';
    syncStatusEl.textContent = '';
  }
}

// =========================================================
// AUTENTICAÇÃO
// =========================================================

function isNetworkError(res) {
  if (!navigator.onLine) return true;
  if (res && res.status === 0) return true;
  const msg = (res && res.error && res.error.message || '').toLowerCase();
  return /fetch|network|load failed|timeout/.test(msg);
}

async function checkSession() {
  let session = null;
  let error = null;
  try {
    const res = await supabaseClient.auth.getSession();
    session = res.data.session;
    error = res.error;
  } catch (e) {
    error = e;
  }

  if (session) {
    localStorage.setItem(LOGGED_KEY, '1');
    showApp();
    return;
  }

  // Sem sessão válida. Se já estava logado antes e o problema é só falta de
  // internet (não conseguiu renovar o login), deixa usar o app offline.
  const jaLogou = localStorage.getItem(LOGGED_KEY) === '1';
  const semRede = !navigator.onLine || (error && isNetworkError({ error }));
  if (jaLogou && semRede) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin(message) {
  loginScreen.classList.remove('hidden');
  appRoot.classList.add('hidden');
  loginError.textContent = message || '';
}

function showApp() {
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');

  // Mostra na hora o que está guardado no celular, depois sincroniza
  items = readJSON(CACHE_KEY, []);
  renderLists();
  updateSyncStatus();
  loadItems();
  subscribeRealtime();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando...';

  let error = null;
  try {
    const res = await supabaseClient.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });
    error = res.error;
  } catch (err) {
    error = err;
  }

  loginBtn.disabled = false;
  loginBtn.textContent = 'Entrar';

  if (error) {
    loginError.textContent = isNetworkError({ error })
      ? 'Sem conexão. O primeiro login precisa de internet.'
      : 'E-mail ou senha inválidos.';
    return;
  }

  loginPassword.value = '';
  localStorage.setItem(LOGGED_KEY, '1');
  showApp();
});

logoutBtn.addEventListener('click', async () => {
  const pending = getQueue().length;
  if (pending > 0 && !confirm(`Existem ${pending} alteração(ões) ainda não enviadas. Se sair agora, elas serão perdidas. Sair mesmo assim?`)) {
    return;
  }

  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  // scope "local": sai deste aparelho mesmo sem internet
  try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch (e) { /* ignora */ }

  localStorage.removeItem(LOGGED_KEY);
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(QUEUE_KEY);
  items = [];
  showLogin();
});

// =========================================================
// SINCRONIZAÇÃO COM O BANCO
// =========================================================

// Executa UMA alteração da fila. Retorna:
//  'ok'      -> deu certo, pode tirar da fila
//  'network' -> sem internet, tenta de novo depois (mantém na fila)
//  'auth'    -> login expirou, precisa entrar de novo (mantém na fila)
//  'drop'    -> erro que não adianta repetir, descarta
async function runOp(op) {
  let res;
  try {
    if (op.op === 'insert') {
      res = await supabaseClient.from('items').insert(op.row);
    } else if (op.op === 'update') {
      res = await supabaseClient.from('items').update(op.fields).eq('id', op.id);
    } else if (op.op === 'update_many') {
      res = await supabaseClient.from('items').update(op.fields).in('id', op.ids);
    } else if (op.op === 'delete') {
      res = await supabaseClient.from('items').delete().eq('id', op.id);
    } else if (op.op === 'purchase') {
      res = await supabaseClient.from('purchases').insert(op.row);
    } else {
      return 'drop';
    }
  } catch (e) {
    return 'network';
  }

  if (!res.error) return 'ok';
  if (res.error.code === '23505') return 'ok'; // já tinha sido enviado antes
  if (isNetworkError(res)) return 'network';

  if (res.status === 401 || res.status === 403) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return 'auth';
  }

  console.error('Alteração descartada por erro do servidor:', op, res.error);
  return 'drop';
}

async function flushQueue() {
  if (flushing || getQueue().length === 0) return;
  if (!navigator.onLine) { updateSyncStatus(); return; }

  flushing = true;
  try {
    while (true) {
      const queue = getQueue();
      if (queue.length === 0) break;

      const result = await runOp(queue[0]);

      if (result === 'network') break;
      if (result === 'auth') {
        showLogin('Sua sessão expirou. Entre de novo: as alterações guardadas serão enviadas.');
        break;
      }

      // 'ok' ou 'drop': remove a primeira da fila (relê, pois pode ter entrado coisa nova)
      const atual = getQueue();
      atual.shift();
      saveQueue(atual);
      updateSyncStatus();
    }
  } finally {
    flushing = false;
    updateSyncStatus();
  }
}

// Envia o que estiver pendente e depois traz a versão mais nova do banco
async function loadItems() {
  await flushQueue();

  // Ainda tem coisa pendente (sem internet)? Mantém o que está no celular.
  if (getQueue().length > 0) return;

  let res;
  try {
    res = await supabaseClient
      .from('items')
      .select('*')
      .order('created_at', { ascending: true });
  } catch (e) {
    return; // sem internet: segue com o cache
  }

  if (res.error) {
    if (!isNetworkError(res)) console.error('Erro ao carregar itens:', res.error);
    return;
  }

  // Entrou alteração nova enquanto buscava? Ela é mais recente que essa resposta.
  if (getQueue().length > 0) return;

  items = res.data;
  saveCache();
  renderLists();
}

// Atualiza a tela sempre que outro celular alterar a lista
function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel('items-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
      loadItems();
    })
    .subscribe();
}

window.addEventListener('online', () => {
  updateSyncStatus();
  if (!appRoot.classList.contains('hidden')) loadItems();
});
window.addEventListener('offline', updateSyncStatus);

// No iPhone não existe sincronização em segundo plano, então sincroniza
// sempre que o app volta a ser aberto/visível.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !appRoot.classList.contains('hidden')) {
    loadItems();
  }
});

// Aplica uma alteração: atualiza a tela e o celular na hora, e enfileira o envio
function applyChange(newItems, ...ops) {
  items = newItems;
  saveCache();
  enqueue(...ops);
  renderLists();
  loadItems();
}

// =========================================================
// RENDERIZAÇÃO
// =========================================================

function renderLists() {
  shoppingListEl.innerHTML = '';
  checkedListEl.innerHTML = '';

  let remainingCount = 0;
  let checkedCount = 0;

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.onclick = () => toggleCheck(item);

    const qty = Number(item.quantity) || 1;
    const unit = item.unit || 'un';
    const qtyLabel = unit === 'kg'
      ? `<span class="qty">${qty} kg</span>`
      : (qty !== 1 ? `<span class="qty">x${qty}</span>` : '');
    const priceLabel = (item.checked && item.unit_price != null)
      ? `<span class="price">R$ ${(item.unit_price * qty).toFixed(2)}</span>`
      : '';

    li.innerHTML = `
      <input type="checkbox" ${item.checked ? 'checked' : ''}>
      <span class="name">${escapeHtml(item.name)}</span>
      ${qtyLabel}
      ${priceLabel}
      <button class="delete-btn" title="Remover item">✕</button>
    `;

    const deleteBtn = li.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // não deixa marcar/desmarcar o item ao clicar em remover
      deleteItem(item);
    });

    if (item.checked) {
      checkedListEl.appendChild(li);
      checkedCount++;
    } else {
      shoppingListEl.appendChild(li);
      remainingCount++;
    }
  });

  remainingCountEl.textContent = remainingCount;
  checkedCountEl.textContent = checkedCount;

  if (clearCartBtn) {
    clearCartBtn.style.display = checkedCount > 0 ? 'block' : 'none';
  }

  updateEstimatedTotal();
}

function updateEstimatedTotal() {
  const total = items
    .filter(i => i.checked && i.unit_price != null)
    .reduce((sum, i) => sum + i.unit_price * (Number(i.quantity) || 1), 0);

  const itemsSemPreco = items.some(i => i.checked && i.unit_price == null);

  if (total > 0) {
    estimatedTotalEl.textContent = `Estimado pelos preços: R$ ${total.toFixed(2)}`
      + (itemsSemPreco ? ' (alguns itens sem preço informado)' : '');
  } else {
    estimatedTotalEl.textContent = '';
  }

  // Preenche o campo de total automaticamente, a não ser que a pessoa já
  // tenha editado esse campo na mão nessa sessão.
  if (!totalEditedManually && total > 0) {
    totalAmountInput.value = total.toFixed(2);
  }
}

// =========================================================
// AÇÕES (funcionam com ou sem internet)
// =========================================================

function toggleCheck(item) {
  const newChecked = !item.checked;
  let unitPrice = item.unit_price;
  let quantity = item.quantity;

  if (newChecked) {
    const unit = item.unit || 'un';

    // Pergunta a quantidade real (importante pro peso de legumes/frutas na balança)
    const qtyLabel = unit === 'kg'
      ? `Quantidade comprada de "${item.name}" (kg):`
      : `Quantidade comprada de "${item.name}" (unidades):`;
    const qtyResposta = prompt(qtyLabel, quantity != null ? quantity : 1);
    if (qtyResposta === null) return; // cancelou, não marca o item

    const parsedQty = parseFloat(qtyResposta.replace(',', '.'));
    if (!isNaN(parsedQty) && parsedQty > 0) {
      quantity = parsedQty;
    }

    // Pergunta o preço (por kg ou por unidade, dependendo do item)
    const priceLabel = unit === 'kg'
      ? `Preço por kg de "${item.name}" (R$):`
      : `Preço unitário de "${item.name}" (R$):`;
    const priceResposta = prompt(priceLabel, item.unit_price != null ? item.unit_price : '');
    if (priceResposta === null) return; // cancelou, não marca o item

    const parsedPrice = parseFloat(priceResposta.replace(',', '.'));
    unitPrice = isNaN(parsedPrice) ? null : parsedPrice;
  }

  const fields = { checked: newChecked, unit_price: unitPrice, quantity };
  applyChange(
    items.map(i => i.id === item.id ? { ...i, ...fields } : i),
    { op: 'update', id: item.id, fields }
  );
}

function deleteItem(item) {
  if (!confirm(`Remover "${item.name}" da lista?`)) return;

  applyChange(
    items.filter(i => i.id !== item.id),
    { op: 'delete', id: item.id }
  );
}

clearCartBtn.addEventListener('click', () => {
  const checkedIds = items.filter(i => i.checked).map(i => i.id);
  if (checkedIds.length === 0) return;

  const fields = { checked: false };
  applyChange(
    items.map(i => i.checked ? { ...i, ...fields } : i),
    { op: 'update_many', ids: checkedIds, fields }
  );
});

addBtn.addEventListener('click', () => {
  const name = itemInput.value.trim();
  if (!name) return;

  const qty = parseFloat(itemQtyInput.value);
  const quantity = isNaN(qty) || qty <= 0 ? 1 : qty;
  const unit = itemUnitInput.value === 'kg' ? 'kg' : 'un';

  itemInput.value = '';
  itemQtyInput.value = 1;
  itemUnitInput.value = 'un';

  // O id é gerado aqui no celular, assim o item existe mesmo offline
  const row = {
    id: newId(),
    name,
    checked: false,
    quantity,
    unit,
    unit_price: null,
    created_at: new Date().toISOString()
  };

  applyChange([...items, row], { op: 'insert', row });
});

itemInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addBtn.click();
  }
});

finishBuyBtn.addEventListener('click', () => {
  const totalValue = parseFloat(totalAmountInput.value);

  if (isNaN(totalValue) || totalValue <= 0) {
    alert("Por favor, digite o valor total da compra.");
    return;
  }

  const comprados = items.filter(item => item.checked);
  const itensComprados = comprados.map(i => ({
    name: i.name,
    quantity: Number(i.quantity) || 1,
    unit: i.unit || 'un',
    unit_price: i.unit_price
  }));

  const purchaseRow = {
    id: newId(),
    total: totalValue,
    items: itensComprados,
    created_at: new Date().toISOString()
  };

  const fields = { checked: false, unit_price: null };
  const ops = [{ op: 'purchase', row: purchaseRow }];
  if (comprados.length > 0) {
    ops.push({ op: 'update_many', ids: comprados.map(i => i.id), fields });
  }

  applyChange(
    items.map(i => i.checked ? { ...i, ...fields } : i),
    ...ops
  );

  totalAmountInput.value = '';
  totalEditedManually = false;

  alert(navigator.onLine
    ? `Compra de R$ ${totalValue.toFixed(2)} salva com sucesso!`
    : `Compra de R$ ${totalValue.toFixed(2)} salva no celular. Será enviada quando a internet voltar.`);
});

// =========================================================
// INÍCIO
// =========================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Modo offline indisponível:', err);
    });
  });
}

checkSession();
