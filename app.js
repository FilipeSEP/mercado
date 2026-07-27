// =========================================================
// Lista do Mercado - agora com login e banco de dados (Supabase)
// A mesma lista fica salva na nuvem e sincroniza entre celulares.
// =========================================================

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

let items = [];

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
const finishBuyBtn = document.getElementById('finish-buy-btn');
const totalAmountInput = document.getElementById('total-amount');
const clearCartBtn = document.getElementById('clear-cart-btn');
const estimatedTotalEl = document.getElementById('estimated-total');

// Fica true assim que o usuário digita algo manualmente no campo de total,
// pra pararmos de sobrescrever o valor dele com o cálculo automático.
let totalEditedManually = false;
totalAmountInput.addEventListener('input', () => { totalEditedManually = true; });

// =========================================================
// AUTENTICAÇÃO
// =========================================================

async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  appRoot.classList.add('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
  loadItems();
  subscribeRealtime();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando...';

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value
  });

  loginBtn.disabled = false;
  loginBtn.textContent = 'Entrar';

  if (error) {
    loginError.textContent = 'E-mail ou senha inválidos.';
    return;
  }

  loginPassword.value = '';
  showApp();
});

logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  showLogin();
});

// =========================================================
// CARREGAR / SINCRONIZAR ITENS COM O BANCO
// =========================================================

async function loadItems() {
  const { data, error } = await supabaseClient
    .from('items')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erro ao carregar itens:', error);
    return;
  }

  items = data;
  renderLists();
}

// Atualiza a tela sempre que outro celular alterar a lista
function subscribeRealtime() {
  supabaseClient
    .channel('items-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
      loadItems();
    })
    .subscribe();
}

// =========================================================
// RENDERIZAÇÃO (mesma lógica de antes)
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
    const qtyLabel = qty !== 1 ? `<span class="qty">x${qty}</span>` : '';
    const priceLabel = (item.checked && item.unit_price != null)
      ? `<span class="price">R$ ${(item.unit_price * qty).toFixed(2)}</span>`
      : '';

    li.innerHTML = `
      <input type="checkbox" ${item.checked ? 'checked' : ''}>
      <span class="name">${item.name}</span>
      ${qtyLabel}
      ${priceLabel}
    `;

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
// AÇÕES (agora gravando direto no banco)
// =========================================================

async function toggleCheck(item) {
  const newChecked = !item.checked;
  let unitPrice = item.unit_price;

  if (newChecked) {
    // Só pergunta o preço quando o item está sendo marcado como comprado
    const resposta = prompt(
      `Preço unitário de "${item.name}" (R$):`,
      item.unit_price != null ? item.unit_price : ''
    );
    if (resposta === null) return; // cancelou, não marca o item

    const parsed = parseFloat(resposta.replace(',', '.'));
    unitPrice = isNaN(parsed) ? null : parsed;
  }

  // Atualiza a tela na hora (otimista) e depois confirma no banco
  items = items.map(i => i.id === item.id ? { ...i, checked: newChecked, unit_price: unitPrice } : i);
  renderLists();

  const { error } = await supabaseClient
    .from('items')
    .update({ checked: newChecked, unit_price: unitPrice })
    .eq('id', item.id);

  if (error) {
    console.error('Erro ao atualizar item:', error);
    loadItems(); // desfaz a mudança visual se der erro
  }
}

clearCartBtn.addEventListener('click', async () => {
  const checkedIds = items.filter(i => i.checked).map(i => i.id);
  if (checkedIds.length === 0) return;

  items = items.map(item => ({ ...item, checked: false }));
  renderLists();

  const { error } = await supabaseClient
    .from('items')
    .update({ checked: false })
    .in('id', checkedIds);

  if (error) {
    console.error('Erro ao esvaziar carrinho:', error);
    loadItems();
  }
});

addBtn.addEventListener('click', async () => {
  const name = itemInput.value.trim();
  if (!name) return;

  const qty = parseFloat(itemQtyInput.value);
  const quantity = isNaN(qty) || qty <= 0 ? 1 : qty;

  itemInput.value = '';
  itemQtyInput.value = 1;

  const { error } = await supabaseClient
    .from('items')
    .insert({ name, checked: false, quantity });

  if (error) {
    console.error('Erro ao adicionar item:', error);
    alert('Não foi possível adicionar o item. Tente novamente.');
  }
  // A lista é atualizada automaticamente pelo realtime,
  // mas recarregamos aqui também para resposta imediata.
  loadItems();
});

itemInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addBtn.click();
  }
});

finishBuyBtn.addEventListener('click', async () => {
  const totalValue = parseFloat(totalAmountInput.value);

  if (isNaN(totalValue) || totalValue <= 0) {
    alert("Por favor, digite o valor total da compra.");
    return;
  }

  const itensComprados = items.filter(item => item.checked).map(i => ({
    name: i.name,
    quantity: Number(i.quantity) || 1,
    unit_price: i.unit_price
  }));

  const { error: purchaseError } = await supabaseClient
    .from('purchases')
    .insert({ total: totalValue, items: itensComprados });

  if (purchaseError) {
    console.error('Erro ao salvar compra:', purchaseError);
    alert('Não foi possível salvar a compra. Tente novamente.');
    return;
  }

  alert(`Compra de R$ ${totalValue.toFixed(2)} salva com sucesso!`);

  const checkedIds = items.filter(i => i.checked).map(i => i.id);
  await supabaseClient.from('items').update({ checked: false, unit_price: null }).in('id', checkedIds);

  totalAmountInput.value = '';
  totalEditedManually = false;
  loadItems();
});

// =========================================================
// INÍCIO
// =========================================================
checkSession();