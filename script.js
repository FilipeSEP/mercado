// Lista base com os 30 itens originais
let items = [
  { id: 1, name: "Manteiga", checked: false },
  { id: 2, name: "Aveia", checked: false },
  { id: 3, name: "Azeite", checked: false },
  { id: 4, name: "Desodorante", checked: false },
  { id: 5, name: "Creme dental", checked: false },
  { id: 6, name: "Detergente", checked: false },
  { id: 7, name: "Cândida", checked: false },
  { id: 8, name: "Amaciante", checked: false },
  { id: 9, name: "Requeijão light", checked: false },
  { id: 10, name: "Pão de forma", checked: false },
  { id: 11, name: "Mussarela", checked: false },
  { id: 12, name: "Iogurte sem sabor", checked: false },
  { id: 13, name: "Cenoura", checked: false },
  { id: 14, name: "Batata", checked: false },
  { id: 15, name: "Cebola", checked: false },
  { id: 16, name: "Alho", checked: false },
  { id: 17, name: "RedBull sem açúcar", checked: false },
  { id: 18, name: "Papel toalha", checked: false },
  { id: 19, name: "Papel alumínio", checked: false },
  { id: 20, name: "Papel manteiga", checked: false },
  { id: 21, name: "Produto para privada", checked: false },
  { id: 22, name: "Perfex", checked: false },
  { id: 23, name: "Lustra Móveis", checked: false },
  { id: 24, name: "Leite", checked: false },
  { id: 25, name: "Mata barata", checked: false },
  { id: 26, name: "Chiclete", checked: false },
  { id: 27, name: "Bala mentos", checked: false },
  { id: 28, name: "Ervilha", checked: false },
  { id: 29, name: "Suco de laranja", checked: false },
  { id: 30, name: "Enxaguante bucal", checked: false }
];

// Elementos do DOM
const shoppingListEl = document.getElementById('shopping-list');
const checkedListEl = document.getElementById('checked-list');
const remainingCountEl = document.getElementById('remaining-count');
const checkedCountEl = document.getElementById('checked-count');
const addBtn = document.getElementById('add-btn');
const itemInput = document.getElementById('item-input');
const finishBuyBtn = document.getElementById('finish-buy-btn');
const totalAmountInput = document.getElementById('total-amount');
const clearCartBtn = document.getElementById('clear-cart-btn');

// Função para renderizar as listas na tela
function renderLists() {
  shoppingListEl.innerHTML = '';
  checkedListEl.innerHTML = '';

  let remainingCount = 0;
  let checkedCount = 0;

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'item-card';
    
    // Clicar em qualquer parte do card alterna o estado
    li.onclick = () => toggleCheck(item.id);

    li.innerHTML = `
      <input type="checkbox" ${item.checked ? 'checked' : ''}>
      <span class="name">${item.name}</span>
    `;

    if (item.checked) {
      checkedListEl.appendChild(li);
      checkedCount++;
    } else {
      shoppingListEl.appendChild(li);
      remainingCount++;
    }
  });

  // Atualiza contadores
  remainingCountEl.textContent = remainingCount;
  checkedCountEl.textContent = checkedCount;

  // Exibe o botão de esvaziar carrinho somente se houver itens marcados
  if (clearCartBtn) {
    clearCartBtn.style.display = checkedCount > 0 ? 'block' : 'none';
  }
}

// Alterna status de um item
function toggleCheck(id) {
  items = items.map(item => item.id === id ? { ...item, checked: !item.checked } : item);
  renderLists();
}

// Ação do botão Esvaziar Carrinho
clearCartBtn.addEventListener('click', () => {
  items = items.map(item => ({ ...item, checked: false }));
  renderLists();
});

// Adicionar um novo item
addBtn.addEventListener('click', () => {
  const name = itemInput.value.trim();
  if (name) {
    items.push({ id: Date.now(), name: name, checked: false });
    itemInput.value = '';
    renderLists();
  }
});

// Permite adicionar item apertando Enter no input
itemInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addBtn.click();
  }
});

// Finalizar Compra e Salvar Valor Total
finishBuyBtn.addEventListener('click', () => {
  const totalValue = parseFloat(totalAmountInput.value);

  if (isNaN(totalValue) || totalValue <= 0) {
    alert("Por favor, digite o valor total da compra.");
    return;
  }

  // Estrutura do JSON que será enviado para a API / Banco de Dados
  const payloadCompra = {
    data: new Date().toISOString(),
    valorTotal: totalValue,
    itensComprados: items.filter(item => item.checked).map(i => i.name)
  };

  console.log("Objeto pronto para o backend:", payloadCompra);
  alert(`Compra de R$ ${totalValue.toFixed(2)} salva com sucesso!`);

  // Reseta os marcadores para a próxima compra e limpa o valor
  items = items.map(item => ({ ...item, checked: false }));
  totalAmountInput.value = '';
  renderLists();
});

// Inicializa a tela ao carregar a página
renderLists();