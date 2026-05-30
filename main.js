// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let accounts     = JSON.parse(localStorage.getItem('fp_accounts')  || '[]');
let transactions = JSON.parse(localStorage.getItem('fp_tx')        || '[]');
let scheduled    = JSON.parse(localStorage.getItem('fp_sched')     || '[]');
let installments = JSON.parse(localStorage.getItem('fp_inst')      || '[]');
let budgets      = JSON.parse(localStorage.getItem('fp_budgets')   || '[]');

let dashYear  = new Date().getFullYear();
let dashMonth = new Date().getMonth();
let currentTxType   = 'expense';
let currentSchedType = 'expense';
let selectedColor    = '#c0392b';
let editingAccountId = null;
let chartInstances   = {};

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const CAT = {
  moradia:'🏠 Moradia', alimentacao:'🍔 Alimentação', transporte:'🚌 Transporte',
  saude:'💊 Saúde', lazer:'🎮 Lazer', tecnologia:'💻 Tecnologia',
  educacao:'📚 Educação', assinaturas:'📱 Assinaturas', academia:'🏋️ Academia',
  vestuario:'👕 Vestuário', outros:'📦 Outros',
  salario:'💼 Salário', freelance:'⚡ Freelance', reembolso:'↩ Reembolso',
  investimento:'📈 Investimento', 'outros-in':'✦ Outros'
};
const ACC_TYPES = {checking:'Conta Corrente',savings:'Poupança',wallet:'Carteira',investment:'Investimento',credit:'Cartão de Crédito'};
const CHART_COLORS = ['#c0392b','#e74c3c','#e67e22','#f39c12','#27ae60','#2980b9','#8e44ad','#16a085','#d35400','#1abc9c'];

// ═══════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════
const fmt = v => 'R$ ' + Math.abs(v).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const fmtSigned = v => (v < 0 ? '−' : '+') + fmt(v);
const save = () => {
  localStorage.setItem('fp_accounts',  JSON.stringify(accounts));
  localStorage.setItem('fp_tx',        JSON.stringify(transactions));
  localStorage.setItem('fp_sched',     JSON.stringify(scheduled));
  localStorage.setItem('fp_inst',      JSON.stringify(installments));
  localStorage.setItem('fp_budgets',   JSON.stringify(budgets));
};
const mkKey  = (y,m) => `${y}-${String(m+1).padStart(2,'0')}`;
const keyOf  = d    => d.slice(0,7);
const fmtDt  = s    => { const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('pt-BR'); };
const mName  = (y,m) => new Date(y,m,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
const mShort = (y,m) => new Date(y,m,1).toLocaleDateString('pt-BR',{month:'short'});
const today  = ()   => new Date().toISOString().slice(0,10);

function showToast(msg, type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast show ${type}`;
  setTimeout(()=>t.className='toast',2500);
}

function destroyChart(id){
  if(chartInstances[id]){ chartInstances[id].destroy(); delete chartInstances[id]; }
}

// nth business day of month (Mon-Fri)
function getNthBusinessDay(year, month, n){
  let count=0;
  for(let d=1; d<=31; d++){
    const dt=new Date(year,month,d);
    if(dt.getMonth()!==month) break;
    const dow=dt.getDay();
    if(dow!==0 && dow!==6){ count++; if(count===n) return d; }
  }
  return null;
}

function lastDayOfMonth(year,month){ return new Date(year,month+1,0).getDate(); }

function getScheduledDateForMonth(sched, year, month){
  if(sched.dayType==='business') return getNthBusinessDay(year,month,sched.day);
  if(sched.dayType==='lastday')  return lastDayOfMonth(year,month);
  return Math.min(sched.day, lastDayOfMonth(year,month));
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT BALANCE (real-time from transactions)
// ═══════════════════════════════════════════════════════════════════
function getAccountBalance(accId){
  const acc = accounts.find(a=>a.id===accId);
  if(!acc) return 0;
  let bal = acc.initialBalance || 0;
  transactions.filter(t=>t.status==='paid').forEach(t=>{
    if(t.type==='income'    && t.accountId===accId) bal += t.amount;
    if(t.type==='expense'   && t.accountId===accId) bal -= t.amount;
    if(t.type==='transfer'  && t.accountId===accId) bal -= t.amount;
    if(t.type==='transfer'  && t.accountId2===accId) bal += t.amount;
  });
  return bal;
}

function getTotalPatrimony(){
  return accounts.reduce((s,a)=>{
    if(a.type==='credit') return s; // credit cards are liabilities
    return s + getAccountBalance(a.id);
  },0);
}

// ═══════════════════════════════════════════════════════════════════
// GET TX + SCHEDULED FOR MONTH
// ═══════════════════════════════════════════════════════════════════
function getTxForMonth(y,m){
  const k=mkKey(y,m);
  return transactions.filter(t=>keyOf(t.date)===k);
}

function getInstForMonth(y,m){
  return installments.filter(inst=>{
    const [sy,sm]=inst.start.split('-').map(Number);
    const si=sy*12+sm-1, ti=y*12+m;
    return ti>=si && ti<si+inst.count;
  });
}

function getSchedForMonth(y,m){
  return scheduled.filter(s=>s.active).map(s=>{
    const day=getScheduledDateForMonth(s,y,m);
    const dateStr=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return {...s, computedDate:dateStr, computedDay:day};
  });
}

function getMonthIncome(y,m){
  const txs=getTxForMonth(y,m);
  const scheds=getSchedForMonth(y,m).filter(s=>s.type==='income');
  return txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)
       + scheds.reduce((s,sc)=>s+sc.amount,0);
}

function getMonthExpense(y,m){
  const txs=getTxForMonth(y,m);
  const scheds=getSchedForMonth(y,m).filter(s=>s.type==='expense');
  const insts=getInstForMonth(y,m);
  return txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)
       + scheds.reduce((s,sc)=>s+sc.amount,0)
       + insts.reduce((s,i)=>s+i.perMonth,0);
}

// ═══════════════════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════════════════
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    const v=btn.dataset.view;
    document.getElementById('view-'+v).classList.add('active');
    renderView(v);
  });
});

function renderView(v){
  if(v==='dashboard')    renderDashboard();
  if(v==='accounts')     renderAccounts();
  if(v==='scheduled')    renderScheduled();
  if(v==='installments') renderInstallments();
  if(v==='budget')       renderBudget();
  if(v==='reports')      renderReports();
  if(v==='forecast')     renderForecast();
  if(v==='history')      renderHistory();
  updateSidebar();
}

// ═══════════════════════════════════════════════════════════════════
// POPULATE ACCOUNT SELECTS
// ═══════════════════════════════════════════════════════════════════
function populateAccountSelects(){
  const ids=['f-account','f-account2','s-account','i-account'];
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const val=el.value;
    el.innerHTML=accounts.length
      ? accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')
      : '<option value="">Sem contas</option>';
    if(val) el.value=val;
  });
}

// ═══════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════
function updateSidebar(){
  const el=document.getElementById('sb-accounts');
  if(!accounts.length){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="sb-acc-title">Contas</div>`
    + accounts.map(a=>{
      const bal=getAccountBalance(a.id);
      return `<div class="sb-acc-item">
        <div class="sb-acc-left"><div class="sb-acc-dot" style="background:${a.color}"></div><div class="sb-acc-name">${a.name}</div></div>
        <div class="sb-acc-bal" style="color:${bal>=0?'var(--grn-l)':'var(--red-l)'}">${bal<0?'−':''}${fmt(bal).replace('R$ ','')}</div>
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
document.getElementById('dash-prev')?.addEventListener('click',()=>{
  dashMonth--; if(dashMonth<0){dashMonth=11;dashYear--;} renderDashboard();
});
document.getElementById('dash-next')?.addEventListener('click',()=>{
  dashMonth++; if(dashMonth>11){dashMonth=0;dashYear++;} renderDashboard();
});

// ═══════════════════════════════════════════════════════════════════
// ACCOUNTS
// ═══════════════════════════════════════════════════════════════════
function renderAccounts(){
  const grid=document.getElementById('accounts-grid');
  if(!accounts.length){ grid.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nenhuma conta cadastrada.</div>'; return; }
  const icons = typeof BANK_ICONS!=='undefined'?BANK_ICONS:{};
  grid.innerHTML=accounts.map(a=>{
    const bal=getAccountBalance(a.id);
    const icon=icons[a.bank||'generic']||'🏦';
    return `<div class="acc-card">
      <div class="acc-stripe" style="background:${a.color}"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:22px;line-height:1">${icon}</span>
        <div class="acc-type-label" style="margin-bottom:0">${ACC_TYPES[a.type]||a.type}</div>
      </div>
      <div class="acc-name">${a.name}</div>
      <div class="acc-bal" style="color:${bal>=0?'var(--grn-l)':'var(--red-l)'}">${bal<0?'−':''}${fmt(bal)}</div>
      <div class="acc-actions">
        <button class="acc-btn" onclick="editAccount(${a.id})">Editar</button>
        <button class="acc-btn del" onclick="deleteAccount(${a.id})">Excluir</button>
      </div>
    </div>`;
  }).join('');
}

window.editAccount=id=>{
  const a=accounts.find(x=>x.id===id); if(!a) return;
  editingAccountId=id;
  document.getElementById('mac-title').textContent='Editar Conta';
  document.getElementById('ac-name').value=a.name;
  document.getElementById('ac-type').value=a.type;
  document.getElementById('ac-balance').value=a.initialBalance;
  selectedColor=a.color;
  document.querySelectorAll('.color-opt').forEach(o=>o.classList.toggle('selected',o.dataset.color===a.color));
  document.getElementById('modal-account').style.display='flex';
};
window.deleteAccount=id=>{
  if(!confirm('Excluir esta conta? As transações vinculadas serão mantidas.')) return;
  accounts=accounts.filter(a=>a.id!==id); save(); populateAccountSelects(); renderAccounts(); updateSidebar(); showToast('Conta excluída.');
};

// ═══════════════════════════════════════════════════════════════════
// TRANSACTION FORM
// ═══════════════════════════════════════════════════════════════════
document.getElementById('f-date').value=today();
document.querySelectorAll('#view-add .type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#view-add .type-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); currentTxType=btn.dataset.type;
    document.getElementById('f-account2-wrap').style.display=currentTxType==='transfer'?'':'none';
    document.getElementById('f-cat-wrap').style.display=currentTxType==='transfer'?'none':'';
  });
});
document.getElementById('tx-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const desc=document.getElementById('f-desc').value.trim();
  const amount=parseFloat(document.getElementById('f-amount').value);
  const accountId=parseInt(document.getElementById('f-account').value);
  const accountId2=currentTxType==='transfer'?parseInt(document.getElementById('f-account2').value):null;
  const category=currentTxType==='transfer'?'transfer':document.getElementById('f-category').value;
  const date=document.getElementById('f-date').value;
  const status=document.getElementById('f-status').value;
  const note=document.getElementById('f-note').value.trim();
  if(!desc||!amount||!accountId||!date) return showToast('Preencha todos os campos.','error');
  if(currentTxType==='transfer'&&!accountId2) return showToast('Selecione a conta destino.','error');
  if(currentTxType==='transfer'&&accountId===accountId2) return showToast('Contas devem ser diferentes.','error');
  transactions.push({id:Date.now(),desc,amount,accountId,accountId2,category,date,type:currentTxType,status,note});
  save(); e.target.reset(); document.getElementById('f-date').value=today();
  showToast('Transação adicionada!'); renderDashboard(); updateSidebar();
});

// ═══════════════════════════════════════════════════════════════════
// SCHEDULED
// ═══════════════════════════════════════════════════════════════════
let schedType='expense';
document.getElementById('btn-add-sched')?.addEventListener('click',()=>{
  document.getElementById('sched-form').reset();
  schedType='expense';
  document.querySelectorAll('#modal-sched .type-btn').forEach(b=>b.classList.toggle('active',b.dataset.type==='expense'));
  document.getElementById('modal-sched').style.display='flex';
});
document.getElementById('btn-cancel-sched')?.addEventListener('click',()=>document.getElementById('modal-sched').style.display='none');
document.querySelectorAll('#modal-sched .type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#modal-sched .type-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); schedType=btn.dataset.type;
  });
});
document.getElementById('s-daytype')?.addEventListener('change',()=>{
  const dt=document.getElementById('s-daytype').value;
  const lbl=document.getElementById('s-day-label');
  const hint=document.getElementById('s-hint');
  const inp=document.getElementById('s-day');
  if(dt==='lastday'){ lbl.textContent='—'; inp.disabled=true; hint.textContent='Sempre no último dia do mês'; }
  else if(dt==='business'){ lbl.textContent='Nº Dia Útil'; inp.disabled=false; hint.textContent='Ex: "5" = 5º dia útil do mês (ideal para salários)'; }
  else { lbl.textContent='Dia'; inp.disabled=false; hint.textContent='Ex: "5" = todo dia 5 do mês'; }
});
document.getElementById('sched-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const desc=document.getElementById('s-desc').value.trim();
  const amount=parseFloat(document.getElementById('s-amount').value);
  const accountId=parseInt(document.getElementById('s-account').value);
  const category=document.getElementById('s-category').value;
  const dayType=document.getElementById('s-daytype').value;
  const day=dayType==='lastday'?0:parseInt(document.getElementById('s-day').value);
  if(!desc||!amount) return showToast('Preencha todos os campos.','error');
  scheduled.push({id:Date.now(),desc,amount,accountId,category,dayType,day,type:schedType,active:true});
  save(); renderScheduled(); renderDashboard();
  document.getElementById('modal-sched').style.display='none';
  showToast('Agendamento criado!');
});

function renderScheduled(){
  const el=document.getElementById('sched-list');
  if(!scheduled.length){ el.innerHTML='<div class="empty-state">Nenhum agendamento cadastrado.</div>'; return; }
  el.innerHTML=scheduled.map(s=>{
    const acc=accounts.find(a=>a.id===s.accountId);
    let dayLabel='';
    if(s.dayType==='business') dayLabel=`${s.day}º dia útil`;
    else if(s.dayType==='lastday') dayLabel='Último dia';
    else dayLabel=`Dia ${s.day}`;
    return `<div class="sched-item">
      <div class="sched-left">
        <div class="sched-stripe" style="background:${s.type==='income'?'var(--grn)':'var(--red)'}"></div>
        <div>
          <div class="sched-name">${s.desc} ${!s.active?'<span style="font-size:10px;color:var(--tx-3)">(pausado)</span>':''}</div>
          <div class="sched-meta">${CAT[s.category]||s.category} · ${acc?acc.name:'?'} · ${dayLabel}/mês</div>
        </div>
      </div>
      <div class="sched-right">
        <div class="sched-amt" style="color:${s.type==='income'?'var(--grn-l)':'var(--red-l)'}">${s.type==='expense'?'−':'+'}${fmt(s.amount)}</div>
        <button class="small-btn" onclick="toggleSched(${s.id})">${s.active?'Pausar':'Ativar'}</button>
        <button class="small-btn del" onclick="deleteSched(${s.id})">✕</button>
      </div>
    </div>`;
  }).join('');
}
window.toggleSched=id=>{ const s=scheduled.find(x=>x.id===id); if(s){s.active=!s.active;save();renderScheduled();showToast(s.active?'Ativado.':'Pausado.');} };
window.deleteSched=id=>{ scheduled=scheduled.filter(x=>x.id!==id); save(); renderScheduled(); renderDashboard(); showToast('Agendamento removido.'); };

// ═══════════════════════════════════════════════════════════════════
// INSTALLMENTS
// ═══════════════════════════════════════════════════════════════════
document.getElementById('btn-add-inst')?.addEventListener('click',()=>{
  document.getElementById('inst-form').reset();
  const d=new Date(); document.getElementById('i-start').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('modal-inst').style.display='flex';
});
document.getElementById('btn-cancel-inst')?.addEventListener('click',()=>document.getElementById('modal-inst').style.display='none');
document.getElementById('inst-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const desc=document.getElementById('i-desc').value.trim();
  const total=parseFloat(document.getElementById('i-total').value);
  const count=parseInt(document.getElementById('i-count').value);
  const start=document.getElementById('i-start').value;
  const accountId=parseInt(document.getElementById('i-account').value);
  const category=document.getElementById('i-category').value;
  if(!desc||!total||!count||!start) return showToast('Preencha todos os campos.','error');
  installments.push({id:Date.now(),desc,total,count,paid:0,start,accountId,category,perMonth:parseFloat((total/count).toFixed(2))});
  save(); renderInstallments(); renderDashboard();
  document.getElementById('modal-inst').style.display='none';
  showToast('Parcela registrada!');
});

// renderInstallments → replaced below

// ═══════════════════════════════════════════════════════════════════
// BUDGET
// ═══════════════════════════════════════════════════════════════════
function renderBudget(){
  const now=new Date();
  const mk=mkKey(now.getFullYear(),now.getMonth());
  document.getElementById('bud-month-label').textContent=mName(now.getFullYear(),now.getMonth());
  const txs=getTxForMonth(now.getFullYear(),now.getMonth());
  const scheds=getSchedForMonth(now.getFullYear(),now.getMonth()).filter(s=>s.type==='expense');
  const insts=getInstForMonth(now.getFullYear(),now.getMonth());
  const catSpent={};
  txs.filter(t=>t.type==='expense').forEach(t=>{catSpent[t.category]=(catSpent[t.category]||0)+t.amount;});
  scheds.forEach(s=>{catSpent[s.category]=(catSpent[s.category]||0)+s.amount;});
  insts.forEach(i=>{catSpent[i.category]=(catSpent[i.category]||0)+i.perMonth;});
  const monthBudgets=budgets.filter(b=>b.month===mk);
  const grid=document.getElementById('budget-grid');
  if(!monthBudgets.length){ grid.innerHTML='<div class="empty-state" style="grid-column:1/-1">Defina limites abaixo para ver o orçamento.</div>'; }
  else {
    grid.innerHTML=monthBudgets.map(b=>{
      const spent=catSpent[b.category]||0;
      const pct=Math.min(Math.round(spent/b.limit*100),100);
      const color=pct>=100?'var(--red-l)':pct>=75?'var(--ylw-l)':'var(--grn-l)';
      const remaining=b.limit-spent;
      return `<div class="budget-item">
        <div class="bud-top"><span class="bud-cat">${CAT[b.category]||b.category}</span><span class="bud-pct" style="color:${color}">${pct}%</span></div>
        <div class="bud-bar-bg"><div class="bud-bar" style="width:${pct}%;background:${color}"></div></div>
        <div class="bud-vals"><span>${fmt(spent)} gasto</span><span>${remaining>=0?fmt(remaining)+' restante':'Excedeu '+fmt(Math.abs(remaining))}</span></div>
        <div style="text-align:right;margin-top:6px"><button class="small-btn del" onclick="delBudget('${b.category}','${mk}')">✕</button></div>
      </div>`;
    }).join('');
  }
}
document.getElementById('budget-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const cat=document.getElementById('b-cat').value;
  const limit=parseFloat(document.getElementById('b-limit').value);
  const now=new Date(); const mk=mkKey(now.getFullYear(),now.getMonth());
  const existing=budgets.find(b=>b.category===cat&&b.month===mk);
  if(existing) existing.limit=limit;
  else budgets.push({category:cat,limit,month:mk});
  save(); renderBudget(); showToast('Limite definido!');
});
window.delBudget=(cat,mk)=>{ budgets=budgets.filter(b=>!(b.category===cat&&b.month===mk)); save(); renderBudget(); showToast('Limite removido.'); };

// ═══════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════
document.getElementById('rep-period')?.addEventListener('change', renderReports);
function renderReports(){
  const months=parseInt(document.getElementById('rep-period').value);
  const now=new Date(); const labels=[],incArr=[],expArr=[],netArr=[];
  const allCats={};
  for(let i=months-1;i>=0;i--){
    let m=now.getMonth()-i, y=now.getFullYear();
    while(m<0){m+=12;y--;}
    const inc=getMonthIncome(y,m), exp=getMonthExpense(y,m);
    labels.push(mShort(y,m)); incArr.push(inc); expArr.push(exp); netArr.push(inc-exp);
    const txs=getTxForMonth(y,m).filter(t=>t.type==='expense');
    const scheds=getSchedForMonth(y,m).filter(s=>s.type==='expense');
    const insts=getInstForMonth(y,m);
    txs.forEach(t=>{allCats[t.category]=(allCats[t.category]||0)+t.amount;});
    scheds.forEach(s=>{allCats[s.category]=(allCats[s.category]||0)+s.amount;});
    insts.forEach(ii=>{allCats[ii.category]=(allCats[ii.category]||0)+ii.perMonth;});
  }
  destroyChart('r-bar');
  chartInstances['r-bar']=new Chart(document.getElementById('r-bar'),{type:'bar',data:{labels,datasets:[
    {label:'Entradas',data:incArr,backgroundColor:'rgba(39,174,96,.65)',borderRadius:4},
    {label:'Saídas',data:expArr,backgroundColor:'rgba(192,57,43,.65)',borderRadius:4}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#888',font:{size:10}}}},scales:{x:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10}}},y:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10},callback:v=>'R$'+Math.round(v)}}}}});
  destroyChart('r-pie');
  chartInstances['r-pie']=new Chart(document.getElementById('r-pie'),{type:'doughnut',data:{
    labels:Object.keys(allCats).map(c=>CAT[c]||c),
    datasets:[{data:Object.values(allCats),backgroundColor:CHART_COLORS,borderWidth:0,hoverOffset:4}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#888',font:{size:10},padding:7,boxWidth:9}}}}});
  destroyChart('r-net');
  chartInstances['r-net']=new Chart(document.getElementById('r-net'),{type:'line',data:{labels,datasets:[{
    label:'Resultado Mensal',data:netArr,borderColor:'#3498db',backgroundColor:'rgba(52,152,219,.08)',tension:.4,fill:true,pointRadius:4,borderWidth:2
  }]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#888',font:{size:10}}}},scales:{
    x:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10}}},
    y:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10},callback:v=>'R$'+Math.round(v)}}
  }}});
  const avgEl=document.getElementById('r-avg-cats');
  const sorted=Object.entries(allCats).sort((a,b)=>b[1]-a[1]);
  avgEl.innerHTML=sorted.length?`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">`
    +sorted.map(([c,v])=>`<div class="ac-item"><span class="ac-name">${CAT[c]||c}</span><span class="ac-avg">${fmt(v/months)}/mês</span></div>`).join('')+'</div>'
    :'<div class="empty-state">Sem dados suficientes.</div>';
}

// ═══════════════════════════════════════════════════════════════════
// FORECAST
// ═══════════════════════════════════════════════════════════════════
function renderForecast(){
  const now=new Date();
  const activeScheds=scheduled.filter(s=>s.active);
  const schedInc=activeScheds.filter(s=>s.type==='income').reduce((s,t)=>s+t.amount,0);
  const schedExp=activeScheds.filter(s=>s.type==='expense').reduce((s,t)=>s+t.amount,0);
  const banner=document.getElementById('fc-banner');
  banner.textContent=`Baseado em ${activeScheds.filter(s=>s.type==='income').length} entradas e ${activeScheds.filter(s=>s.type==='expense').length} saídas agendadas + parcelas ativas. Entradas recorrentes: ${fmt(schedInc)}/mês · Saídas recorrentes: ${fmt(schedExp)}/mês.`;

  let running=getTotalPatrimony();
  const labels=[],incArr=[],expArr=[],balArr=[],rows=[];
  for(let i=1;i<=6;i++){
    let m=now.getMonth()+i, y=now.getFullYear();
    while(m>11){m-=12;y++;}
    const insts=getInstForMonth(y,m);
    const instExp=insts.reduce((s,ii)=>s+ii.perMonth,0);
    const projInc=schedInc;
    const projExp=schedExp+instExp;
    const projBal=projInc-projExp;
    running+=projBal;
    const lbl=new Date(y,m,1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
    labels.push(lbl); incArr.push(projInc); expArr.push(projExp); balArr.push(running);
    rows.push({lbl,projInc,projExp,projBal,running,instExp});
  }
  destroyChart('c-forecast');
  chartInstances['c-forecast']=new Chart(document.getElementById('c-forecast'),{type:'bar',data:{labels,datasets:[
    {label:'Entradas',data:incArr,backgroundColor:'rgba(39,174,96,.6)',borderRadius:4},
    {label:'Saídas',data:expArr,backgroundColor:'rgba(192,57,43,.6)',borderRadius:4},
    {label:'Saldo Acumulado',data:balArr,type:'line',borderColor:'#3498db',backgroundColor:'transparent',tension:.4,yAxisID:'y2',pointRadius:4,borderWidth:2}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#888',font:{size:10}}}},scales:{
    x:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10}}},
    y:{grid:{color:'#1a1a1f'},ticks:{color:'#555',font:{size:10},callback:v=>'R$'+Math.round(v)}},
    y2:{position:'right',grid:{display:false},ticks:{color:'#3498db',font:{size:10},callback:v=>'R$'+Math.round(v)}}
  }}});
  document.getElementById('fc-table').innerHTML=`<div class="fc-table">
    <div class="fc-head"><div>Mês</div><div>Entradas</div><div>Saídas</div><div>Parcelas</div><div>Resultado</div><div>Saldo Acum.</div></div>
    ${rows.map(r=>`<div class="fc-row">
      <div>${r.lbl}</div>
      <div class="pos">${fmt(r.projInc)}</div>
      <div class="neg">${fmt(r.projExp)}</div>
      <div class="neg">${fmt(r.instExp)}</div>
      <div class="${r.projBal>=0?'pos':'neg'}">${r.projBal>=0?'+':''}${fmt(r.projBal)}</div>
      <div class="${r.running>=0?'pos':'neg'}">${fmt(r.running)}</div>
    </div>`).join('')}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════
function populateHistoryFilters(){
  const months=[...new Set(transactions.map(t=>keyOf(t.date)))].sort().reverse();
  const mSel=document.getElementById('h-month');
  mSel.innerHTML='<option value="all">Todos os meses</option>';
  months.forEach(mk=>{
    const [y,m]=mk.split('-').map(Number);
    const opt=document.createElement('option'); opt.value=mk;
    opt.textContent=new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    mSel.appendChild(opt);
  });
  const aSel=document.getElementById('h-account');
  aSel.innerHTML='<option value="all">Todas as contas</option>';
  accounts.forEach(a=>{ const opt=document.createElement('option'); opt.value=a.id; opt.textContent=a.name; aSel.appendChild(opt); });
  const cats=[...new Set(transactions.map(t=>t.category))];
  const cSel=document.getElementById('h-cat');
  cSel.innerHTML='<option value="all">Todas categorias</option>';
  cats.forEach(c=>{ const opt=document.createElement('option'); opt.value=c; opt.textContent=CAT[c]||c; cSel.appendChild(opt); });
}

function renderHistory(){
  populateHistoryFilters();
  const mf=document.getElementById('h-month').value;
  const af=document.getElementById('h-account').value;
  const tf=document.getElementById('h-type').value;
  const cf=document.getElementById('h-cat').value;
  const sf=document.getElementById('h-status').value;
  let list=[...transactions];
  if(mf!=='all') list=list.filter(t=>keyOf(t.date)===mf);
  if(af!=='all') list=list.filter(t=>String(t.accountId)===af||String(t.accountId2)===af);
  if(tf!=='all') list=list.filter(t=>t.type===tf);
  if(cf!=='all') list=list.filter(t=>t.category===cf);
  if(sf!=='all') list=list.filter(t=>t.status===sf);
  list.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totInc=list.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const totExp=list.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const totBal=totInc-totExp;
  document.getElementById('h-summary').innerHTML=`
    <div class="hs-item"><div class="hs-lbl">Entradas</div><div class="hs-val pos">${fmt(totInc)}</div></div>
    <div class="hs-item"><div class="hs-lbl">Saídas</div><div class="hs-val neg">${fmt(totExp)}</div></div>
    <div class="hs-item"><div class="hs-lbl">Saldo</div><div class="hs-val" style="color:${totBal>=0?'var(--grn-l)':'var(--red-l)'}">${totBal<0?'−':''}${fmt(totBal)}</div></div>`;
  const el=document.getElementById('history-list');
  if(!list.length){ el.innerHTML='<div class="empty-state">Nenhuma transação encontrada.</div>'; return; }
  el.innerHTML=list.map(t=>{
    const acc=accounts.find(a=>a.id===t.accountId);
    const acc2=t.accountId2?accounts.find(a=>a.id===t.accountId2):null;
    const accLabel=acc?(acc2?`${acc.name} → ${acc2.name}`:acc.name):'?';
    return `<div class="h-item">
      <div class="h-left">
        <div class="h-stripe ${t.type}"></div>
        <div>
          <div class="h-desc">${t.desc} ${t.status==='pending'?'<span class="pending-tag">Pendente</span>':''}</div>
          <div class="h-meta">${CAT[t.category]||t.category||'Transferência'} · ${accLabel} · ${fmtDt(t.date)}${t.note?' · '+t.note:''}</div>
        </div>
      </div>
      <div class="h-right">
        <div class="h-amt ${t.type}">${t.type==='expense'?'−':t.type==='income'?'+':'⇄'}${fmt(t.amount)}</div>
        <button class="del-btn" data-id="${t.id}">✕</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.del-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      transactions=transactions.filter(t=>t.id!==parseInt(btn.dataset.id));
      save(); renderHistory(); renderDashboard(); updateSidebar(); showToast('Removido.');
    });
  });
}
['h-month','h-account','h-type','h-cat','h-status'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderHistory));

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
populateAccountSelects();
renderDashboard();
updateSidebar();

// ═══════════════════════════════════════════════════════════════════
// CREDIT CARDS STATE
// ═══════════════════════════════════════════════════════════════════
let creditCards = JSON.parse(localStorage.getItem('fp_cards') || '[]');
let invoicePayments = JSON.parse(localStorage.getItem('fp_inv_payments') || '[]');
let selectedCardColor = '#c0392b';
let editingCardId = null;
let viewingCardId = null;
let viewingInvoiceKey = null;
let payingCardId = null;
let payingInvoiceKey = null;

const saveCards = () => {
  localStorage.setItem('fp_cards', JSON.stringify(creditCards));
  localStorage.setItem('fp_inv_payments', JSON.stringify(invoicePayments));
};

// ── INVOICE KEY LOGIC ─────────────────────────────────────────────
// Determines which invoice (YYYY-MM) a purchase date belongs to
function getInvoiceKey(card, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  let m = d.getMonth();
  let y = d.getFullYear();
  // After closing day → goes to next month's invoice
  if (day > card.closingDay) {
    m++; if (m > 11) { m = 0; y++; }
  }
  return mkKey(y, m);
}

function getInvoiceDueDate(card, invKey) {
  // invKey = YYYY-MM of the invoice reference month
  // Due date = dueDay of that same month (or next if dueDay < closingDay)
  const [iy, im] = invKey.split('-').map(Number);
  let dueM = im - 1; // convert to 0-indexed
  let dueY = iy;
  // If due day is less than closing day, the due date is in the next month
  if (card.dueDay <= card.closingDay) {
    dueM++; if (dueM > 11) { dueM = 0; dueY++; }
  }
  const d = Math.min(card.dueDay, lastDayOfMonth(dueY, dueM));
  return `${dueY}-${String(dueM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// ── CARD BALANCE ──────────────────────────────────────────────────
function getCardCurrentInvoiceKey(card) {
  return getInvoiceKey(card, today());
}

function getCardInvoiceTotal(cardId, invKey) {
  return transactions
    .filter(t => t.creditCardId === cardId && t.invoiceKey === invKey && t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
}

function getCardUsed(cardId) {
  // Sum of all unpaid invoices
  const card = creditCards.find(c => c.id === cardId);
  if (!card) return 0;
  const curKey = getCardCurrentInvoiceKey(card);
  // Get all invoice keys for this card
  const keys = [...new Set(transactions.filter(t=>t.creditCardId===cardId).map(t=>t.invoiceKey))];
  let total = 0;
  keys.forEach(k => {
    const paid = invoicePayments.find(p => p.cardId === cardId && p.invoiceKey === k);
    if (!paid) total += getCardInvoiceTotal(cardId, k);
  });
  return total;
}

function getCardAllInvoiceKeys(cardId) {
  const keys = new Set(transactions.filter(t=>t.creditCardId===cardId).map(t=>t.invoiceKey));
  invoicePayments.filter(p=>p.cardId===cardId).forEach(p=>keys.add(p.invoiceKey));
  return [...keys].sort().reverse();
}

function getInvoiceStatus(cardId, invKey) {
  const paid = invoicePayments.find(p=>p.cardId===cardId&&p.invoiceKey===invKey);
  if (paid) return 'paid';
  const card = creditCards.find(c=>c.id===cardId);
  if (!card) return 'open';
  const curKey = getCardCurrentInvoiceKey(card);
  if (invKey < curKey) return 'closed';
  return 'open';
}

// ── POPULATE CREDIT CARD SELECTS ─────────────────────────────────
function populateCreditCardSelects() {
  const els = ['f-creditcard', 'cc-account', 'pay-inv-account'];
  // f-creditcard
  const fc = document.getElementById('f-creditcard');
  if (fc) fc.innerHTML = creditCards.length
    ? creditCards.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">Sem cartões</option>';
  // cc-account (payment account for card)
  const cca = document.getElementById('cc-account');
  if (cca) cca.innerHTML = accounts.length
    ? accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')
    : '<option value="">Sem contas</option>';
  // pay-inv-account
  const pia = document.getElementById('pay-inv-account');
  if (pia) pia.innerHTML = accounts.length
    ? accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')
    : '<option value="">Sem contas</option>';
}

// ── RENDER CARDS VIEW ─────────────────────────────────────────────
function renderCards() {
  populateCreditCardSelects();
  document.getElementById('cards-grid').style.display = '';
  document.getElementById('invoice-panel').style.display = 'none';

  const grid = document.getElementById('cards-grid');
  if (!creditCards.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Nenhum cartão cadastrado. Adicione um cartão para começar.</div>';
    return;
  }
  grid.innerHTML = creditCards.map(card => {
    const used = getCardUsed(card.id);
    const available = card.limit - used;
    const pct = Math.min(Math.round(used / card.limit * 100), 100);
    const curKey = getCardCurrentInvoiceKey(card);
    const curTotal = getCardInvoiceTotal(card.id, curKey);
    const dueDate = getInvoiceDueDate(card, curKey);
    const dueFmt = new Date(dueDate+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const barColor = pct >= 90 ? '#e74c3c' : pct >= 70 ? '#f39c12' : 'rgba(255,255,255,0.9)';
    return `<div class="cc-card" style="background:linear-gradient(135deg,${card.color}dd,${card.color}88)">
      <div class="cc-card-bg"></div>
      <div class="cc-card-top">
        <div><div class="cc-card-name">${card.name}</div><div class="cc-card-type">Cartão de Crédito</div></div>
        <div style="display:flex;gap:6px">
          <button class="cc-btn" onclick="editCard(${card.id})">✎</button>
          <button class="cc-btn" onclick="deleteCard(${card.id})">✕</button>
        </div>
      </div>
      <div class="cc-card-mid">
        <div class="cc-chip"></div>
        <div class="cc-card-limit-used">${fmt(used)}</div>
        <div class="cc-card-limit-total">de ${fmt(card.limit)} · Fatura atual: ${fmt(curTotal)}</div>
      </div>
      <div class="cc-card-bottom">
        <div class="cc-limit-bar-bg"><div class="cc-limit-bar" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="cc-card-info">
          <span>${pct}% usado · ${fmt(available)} disponível</span>
          <span>Vence ${dueFmt} · Fecha dia ${card.closingDay}</span>
        </div>
        <div class="cc-card-actions">
          <button class="cc-btn" onclick="openInvoicePanel(${card.id})">Ver Faturas</button>
          ${curTotal > 0 ? `<button class="cc-btn pay" onclick="openPayInvoice(${card.id},'${curKey}')">Pagar Fatura</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── INVOICE PANEL ─────────────────────────────────────────────────
window.openInvoicePanel = (cardId) => {
  viewingCardId = cardId;
  const card = creditCards.find(c=>c.id===cardId);
  document.getElementById('cards-grid').style.display = 'none';
  document.getElementById('invoice-panel').style.display = '';
  document.getElementById('inv-panel-title').textContent = `Faturas — ${card.name}`;

  // Populate month selector
  const keys = getCardAllInvoiceKeys(cardId);
  const curKey = getCardCurrentInvoiceKey(card);
  if (!keys.includes(curKey)) keys.unshift(curKey);
  const sel = document.getElementById('inv-month-sel');
  sel.innerHTML = keys.map(k => {
    const [y,m] = k.split('-').map(Number);
    const label = new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    return `<option value="${k}">${label}</option>`;
  }).join('');
  sel.value = curKey;
  viewingInvoiceKey = curKey;
  renderInvoiceDetail(cardId, curKey);
};

document.getElementById('inv-month-sel')?.addEventListener('change', e => {
  viewingInvoiceKey = e.target.value;
  renderInvoiceDetail(viewingCardId, viewingInvoiceKey);
});

document.getElementById('btn-close-panel')?.addEventListener('click', () => {
  document.getElementById('cards-grid').style.display = '';
  document.getElementById('invoice-panel').style.display = 'none';
  renderCards();
});

function renderInvoiceDetail(cardId, invKey) {
  const card = creditCards.find(c=>c.id===cardId);
  const expenses = transactions.filter(t=>t.creditCardId===cardId&&t.invoiceKey===invKey&&t.type==='expense');
  const total = expenses.reduce((s,t)=>s+t.amount,0);
  const status = getInvoiceStatus(cardId, invKey);
  const dueDate = getInvoiceDueDate(card, invKey);
  const dueFmt = new Date(dueDate+'T00:00:00').toLocaleDateString('pt-BR');
  const payment = invoicePayments.find(p=>p.cardId===cardId&&p.invoiceKey===invKey);
  const statusLabels = {open:'Em aberto',closed:'Fechada',paid:'Paga'};

  document.getElementById('inv-summary').innerHTML = `
    <div class="inv-kpi"><div class="inv-kpi-lbl">Total da Fatura</div><div class="inv-kpi-val neg">${fmt(total)}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-lbl">Vencimento</div><div class="inv-kpi-val">${dueFmt}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-lbl">Status</div>
      <div class="inv-kpi-val"><span class="inv-status-badge ${status}">${statusLabels[status]}</span></div>
    </div>
    <div class="inv-kpi"><div class="inv-kpi-lbl">Nº de Compras</div><div class="inv-kpi-val">${expenses.length}</div>
      ${status!=='paid'&&total>0?`<button class="small-btn" style="margin-top:8px" onclick="openPayInvoice(${cardId},'${invKey}')">Pagar Fatura</button>`:''}
      ${payment?`<div style="font-size:11px;color:var(--grn-l);margin-top:4px">Pago em ${fmtDt(payment.date)} · ${fmt(payment.amount)}</div>`:''}
    </div>`;

  if (!expenses.length) {
    document.getElementById('inv-expenses').innerHTML = '<div class="empty-state" style="padding:20px">Nenhuma despesa nesta fatura.</div>';
    return;
  }
  const sorted = [...expenses].sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('inv-expenses').innerHTML = `
    <div class="inv-exp-header"><div>Descrição</div><div>Data</div><div>Valor</div></div>
    ${sorted.map(t=>`<div class="inv-exp-row">
      <div><div class="inv-exp-desc">${t.desc}</div><div class="inv-exp-meta">${CAT[t.category]||t.category}${t.note?' · '+t.note:''}</div></div>
      <div style="color:var(--tx-3);font-size:12px;white-space:nowrap">${fmtDt(t.date)}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="neg" style="font-family:var(--fd);font-weight:700">${fmt(t.amount)}</span>
        <button class="del-btn" onclick="delCardTx(${t.id})">✕</button>
      </div>
    </div>`).join('')}`;
}

window.delCardTx = (id) => {
  transactions = transactions.filter(t=>t.id!==id);
  save(); renderInvoiceDetail(viewingCardId, viewingInvoiceKey); renderDashboard();
  showToast('Despesa removida.');
};

// ── PAY INVOICE ───────────────────────────────────────────────────
window.openPayInvoice = (cardId, invKey) => {
  payingCardId = cardId;
  payingInvoiceKey = invKey;
  const card = creditCards.find(c=>c.id===cardId);
  const total = getCardInvoiceTotal(cardId, invKey);
  const [iy,im] = invKey.split('-').map(Number);
  const label = new Date(iy,im-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  document.getElementById('pay-inv-info').innerHTML =
    `<strong>${card.name}</strong> · Fatura de ${label}<br>Total: <strong style="color:var(--red-l)">${fmt(total)}</strong>`;
  document.getElementById('pay-inv-amount').value = total.toFixed(2);
  document.getElementById('pay-inv-date').value = today();
  // pre-select card's payment account
  const payAccSel = document.getElementById('pay-inv-account');
  populateCreditCardSelects();
  if (card.paymentAccountId) payAccSel.value = card.paymentAccountId;
  document.getElementById('modal-pay-inv').style.display = 'flex';
};

document.getElementById('btn-cancel-pay-inv')?.addEventListener('click',()=>document.getElementById('modal-pay-inv').style.display='none');
document.getElementById('pay-inv-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const accountId = parseInt(document.getElementById('pay-inv-account').value);
  const date = document.getElementById('pay-inv-date').value;
  const amount = parseFloat(document.getElementById('pay-inv-amount').value);
  // Create expense transaction on the account
  transactions.push({
    id: Date.now(), desc: `Fatura Cartão`, amount, accountId,
    category: 'outros', date, type: 'expense', status: 'paid',
    note: `Pagamento de fatura — ${creditCards.find(c=>c.id===payingCardId)?.name}`
  });
  // Mark invoice as paid
  invoicePayments = invoicePayments.filter(p=>!(p.cardId===payingCardId&&p.invoiceKey===payingInvoiceKey));
  invoicePayments.push({cardId:payingCardId, invoiceKey:payingInvoiceKey, date, amount});
  save(); saveCards();
  document.getElementById('modal-pay-inv').style.display = 'none';
  showToast('Fatura paga! Débito registrado na conta.');
  if (viewingCardId === payingCardId) renderInvoiceDetail(viewingCardId, viewingInvoiceKey);
  renderCards(); renderDashboard(); updateSidebar();
});

// ── CARD FORM ─────────────────────────────────────────────────────
document.getElementById('btn-add-card')?.addEventListener('click', () => {
  editingCardId = null;
  document.getElementById('mcard-title').textContent = 'Novo Cartão';
  document.getElementById('card-form').reset();
  selectedCardColor = '#c0392b';
  document.querySelectorAll('#cc-color-picker .color-opt').forEach(o=>o.classList.toggle('selected',o.dataset.color===selectedCardColor));
  populateCreditCardSelects();
  document.getElementById('modal-card').style.display = 'flex';
});
document.getElementById('btn-cancel-card')?.addEventListener('click',()=>document.getElementById('modal-card').style.display='none');
document.getElementById('cc-color-picker')?.addEventListener('click', e => {
  const opt = e.target.closest('.color-opt'); if (!opt) return;
  document.querySelectorAll('#cc-color-picker .color-opt').forEach(o=>o.classList.remove('selected'));
  opt.classList.add('selected'); selectedCardColor = opt.dataset.color;
});
document.getElementById('card-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('cc-name').value.trim();
  const limit = parseFloat(document.getElementById('cc-limit').value);
  const closingDay = parseInt(document.getElementById('cc-closing').value);
  const dueDay = parseInt(document.getElementById('cc-due').value);
  const paymentAccountId = parseInt(document.getElementById('cc-account').value)||null;
  if (!name||!limit||!closingDay||!dueDay) return showToast('Preencha todos os campos.','error');
  if (editingCardId) {
    const c = creditCards.find(x=>x.id===editingCardId);
    Object.assign(c, {name,limit,closingDay,dueDay,paymentAccountId,color:selectedCardColor});
  } else {
    creditCards.push({id:Date.now(),name,limit,closingDay,dueDay,paymentAccountId,color:selectedCardColor});
  }
  saveCards(); populateCreditCardSelects(); renderCards();
  document.getElementById('modal-card').style.display = 'none';
  showToast(editingCardId?'Cartão atualizado!':'Cartão criado!');
  editingCardId = null;
});
window.editCard = id => {
  const c = creditCards.find(x=>x.id===id); if (!c) return;
  editingCardId = id;
  document.getElementById('mcard-title').textContent = 'Editar Cartão';
  document.getElementById('cc-name').value = c.name;
  document.getElementById('cc-limit').value = c.limit;
  document.getElementById('cc-closing').value = c.closingDay;
  document.getElementById('cc-due').value = c.dueDay;
  selectedCardColor = c.color;
  document.querySelectorAll('#cc-color-picker .color-opt').forEach(o=>o.classList.toggle('selected',o.dataset.color===c.color));
  populateCreditCardSelects();
  if (c.paymentAccountId) document.getElementById('cc-account').value = c.paymentAccountId;
  document.getElementById('modal-card').style.display = 'flex';
};
window.deleteCard = id => {
  if (!confirm('Excluir este cartão? As despesas vinculadas serão mantidas.')) return;
  creditCards = creditCards.filter(c=>c.id!==id);
  saveCards(); renderCards(); showToast('Cartão excluído.');
};

// ── PAYMENT METHOD TOGGLE (Add Transaction) ───────────────────────
let txPaymentMethod = 'account';
document.getElementById('pay-method-toggle')?.addEventListener('click', e => {
  const btn = e.target.closest('.pay-method-btn'); if (!btn) return;
  document.querySelectorAll('.pay-method-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  txPaymentMethod = btn.dataset.method;
  const isCredit = txPaymentMethod === 'credit';
  const isTransfer = currentTxType === 'transfer';
  document.getElementById('f-account-wrap').style.display = (isCredit||isTransfer) ? 'none' : '';
  document.getElementById('f-creditcard-wrap').style.display = isCredit ? '' : 'none';
  document.getElementById('f-payment-method-wrap').style.display = isTransfer ? 'none' : '';
  // Credit card expenses don't need status field
  document.querySelector('[for="f-status"]')?.closest('.form-group')?.style?.setProperty?.('display', isCredit?'none':'');
  populateCreditCardSelects();
});

// Override the transaction form submit to handle credit cards
const originalTxForm = document.getElementById('tx-form');
originalTxForm.removeEventListener('submit', originalTxForm._handler);
originalTxForm.addEventListener('submit', function txFormHandler(e) {
  e.preventDefault();
  const desc = document.getElementById('f-desc').value.trim();
  const amount = parseFloat(document.getElementById('f-amount').value);
  const date = document.getElementById('f-date').value;
  const status = document.getElementById('f-status').value || 'paid';
  const note = document.getElementById('f-note').value.trim();
  const isCredit = txPaymentMethod === 'credit' && currentTxType !== 'transfer';

  if (!desc || !amount || !date) return showToast('Preencha todos os campos.', 'error');

  if (isCredit) {
    const creditCardId = parseInt(document.getElementById('f-creditcard').value);
    if (!creditCardId) return showToast('Selecione um cartão.', 'error');
    const card = creditCards.find(c=>c.id===creditCardId);
    const invoiceKey = getInvoiceKey(card, date);
    const category = document.getElementById('f-category').value || 'outros';
    transactions.push({id:Date.now(),desc,amount,creditCardId,invoiceKey,category,date,type:'expense',status:'pending',note});
    // Show which invoice it went to
    const [iy,im] = invoiceKey.split('-').map(Number);
    const invLabel = new Date(iy,im-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    showToast(`Lançado na fatura de ${invLabel}`);
  } else {
    const accountId = parseInt(document.getElementById('f-account').value);
    const accountId2 = currentTxType==='transfer' ? parseInt(document.getElementById('f-account2').value) : null;
    const category = currentTxType==='transfer' ? 'transfer' : (document.getElementById('f-category').value||'outros');
    if (!accountId) return showToast('Selecione uma conta.', 'error');
    if (currentTxType==='transfer' && !accountId2) return showToast('Selecione a conta destino.', 'error');
    if (currentTxType==='transfer' && accountId===accountId2) return showToast('Contas devem ser diferentes.', 'error');
    transactions.push({id:Date.now(),desc,amount,accountId,accountId2,category,date,type:currentTxType,status,note});
    showToast('Transação adicionada!');
  }
  save();
  originalTxForm.reset();
  document.getElementById('f-date').value = today();
  renderDashboard(); updateSidebar();
});

// ── UPDATE RENDERNAVVIEW FOR CARDS ────────────────────────────────
const _origRenderView = renderView;
// Patch renderView to include cards
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'cards') { populateCreditCardSelects(); renderCards(); }
  });
});

// ── INCLUDE CREDIT CARD FATURAS IN FORECAST ───────────────────────
// Patch: add upcoming invoice payments to forecast
const _origRenderForecast = renderForecast;
// (forecast already uses getMonthExpense which doesn't include credit yet)
// We'll add credit card upcoming invoices to the fc-table note

// ── DASHBOARD: show credit cards total ────────────────────────────

// Re-init
populateCreditCardSelects();

// ═══════════════════════════════════════════════════════════════════
// EXPORT / IMPORT / CLEAR DATA
// ═══════════════════════════════════════════════════════════════════
function showDataStatus(msg, type='success'){
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.className = `data-status ${type}`;
  el.style.display = '';
  setTimeout(() => el.style.display = 'none', 5000);
}

// EXPORT
document.getElementById('btn-export')?.addEventListener('click', () => {
  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    accounts,
    transactions,
    scheduled,
    installments,
    budgets,
    creditCards,
    invoicePayments
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `finpro-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showDataStatus(
    `✓ Exportado com sucesso: ${accounts.length} contas, ${transactions.length} transações, ` +
    `${creditCards.length} cartões, ${installments.length} parcelas, ${scheduled.length} agendamentos.`
  );
});

// IMPORT
document.getElementById('btn-import')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Isso vai substituir TODOS os dados atuais pelo arquivo selecionado. Continuar?')) {
    e.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      // Validate basic structure
      if (!data.accounts || !data.transactions) throw new Error('Arquivo inválido ou corrompido.');
      // Restore all data
      accounts         = data.accounts         || [];
      transactions     = data.transactions     || [];
      scheduled        = data.scheduled        || [];
      installments     = data.installments     || [];
      budgets          = data.budgets          || [];
      creditCards      = data.creditCards      || [];
      invoicePayments  = data.invoicePayments  || [];
      // Save to localStorage
      save();
      saveCards();
      // Refresh UI
      populateAccountSelects();
      populateCreditCardSelects();
      renderDashboard();
      updateSidebar();
      const exportDate = data.exportedAt
        ? new Date(data.exportedAt).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})
        : 'desconhecida';
      showDataStatus(
        `✓ Importado com sucesso! Backup de ${exportDate} — ` +
        `${accounts.length} contas, ${transactions.length} transações, ` +
        `${creditCards.length} cartões, ${installments.length} parcelas, ${scheduled.length} agendamentos.`
      );
    } catch(err) {
      showDataStatus(`✕ Erro ao importar: ${err.message}`, 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// CLEAR ALL
document.getElementById('btn-clear-data')?.addEventListener('click', () => {
  if (!confirm('Tem certeza? Isso apaga TODOS os dados permanentemente. Não tem como desfazer.')) return;
  if (!confirm('Última confirmação — apagar tudo mesmo?')) return;
  accounts=[];transactions=[];scheduled=[];installments=[];budgets=[];creditCards=[];invoicePayments=[];
  save(); saveCards();
  populateAccountSelects(); populateCreditCardSelects();
  renderDashboard(); updateSidebar();
  showDataStatus('Todos os dados foram apagados.');
});

// ═══════════════════════════════════════════════════════════════════
// OPTION A — CONFIRMED vs PROJECTED
// Agendamentos só somam ao painel quando confirmados manualmente.
// ═══════════════════════════════════════════════════════════════════

let confirmedScheduled = JSON.parse(localStorage.getItem('fp_confirmed_sched') || '[]');
// Each entry: { schedId, invoiceKey (YYYY-MM), txId }
// txId references the real transaction created upon confirmation

const saveConfirmed = () => localStorage.setItem('fp_confirmed_sched', JSON.stringify(confirmedScheduled));

function isSchedConfirmed(schedId, invKey) {
  return confirmedScheduled.some(c => c.schedId === schedId && c.invoiceKey === invKey);
}

function isSchedSkipped(schedId, invKey) {
  return JSON.parse(localStorage.getItem('fp_skipped_sched') || '[]')
    .some(s => s.schedId === schedId && s.invoiceKey === invKey);
}

function skipSched(schedId, invKey) {
  const skipped = JSON.parse(localStorage.getItem('fp_skipped_sched') || '[]');
  if (!skipped.some(s => s.schedId === schedId && s.invoiceKey === invKey)) {
    skipped.push({ schedId, invoiceKey: invKey });
    localStorage.setItem('fp_skipped_sched', JSON.stringify(skipped));
  }
}

// Confirm a scheduled item → creates a real transaction
window.confirmSched = (schedId, invKey) => {
  const sched = scheduled.find(s => s.id === schedId);
  if (!sched) return;
  const [y, m] = invKey.split('-').map(Number);
  const day = getScheduledDateForMonth(sched, y, m - 1);
  const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const txId = Date.now();
  transactions.push({
    id: txId, desc: sched.desc, amount: sched.amount,
    accountId: sched.accountId, category: sched.category,
    date: dateStr, type: sched.type, status: 'paid', note: 'Agendamento confirmado'
  });
  confirmedScheduled.push({ schedId, invoiceKey: invKey, txId });
  save(); saveConfirmed();
  showToast(`"${sched.desc}" confirmado e lançado!`);
  renderDashboard(); updateSidebar();
};

window.skipSchedItem = (schedId, invKey) => {
  skipSched(schedId, invKey);
  showToast('Agendamento ignorado para este mês.');
  renderDashboard();
};

// ── PENDING ITEMS FOR THIS MONTH ──────────────────────────────────
function getPendingForMonth(y, m) {
  const invKey = mkKey(y, m);
  const today_d = new Date();
  return scheduled.filter(s => s.active).filter(s => {
    if (isSchedConfirmed(s.id, invKey)) return false;
    if (isSchedSkipped(s.id, invKey)) return false;
    // Only show if the scheduled day has passed or is today
    const day = getScheduledDateForMonth(s, y, m);
    if (!day) return false;
    const schedDate = new Date(y, m, day);
    return schedDate <= today_d;
  });
}

// ── OVERRIDE renderDashboard to use REAL transactions only ────────
// Remove scheduled from income/expense calculation in dashboard
function renderDashboard() {
  const txs   = getTxForMonth(dashYear, dashMonth);
  const insts = getInstForMonth(dashYear, dashMonth);
  const scheds = getSchedForMonth(dashYear, dashMonth);

  const income  = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const txExp   = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const instExp = insts.reduce((s,i)=>s+i.perMonth,0);
  const fixedExp = scheds.filter(s=>s.type==='expense').reduce((s,sc)=>s+sc.amount,0);
  const fixedInc = scheds.filter(s=>s.type==='income').reduce((s,sc)=>s+sc.amount,0);
  const expense = txExp + instExp;
  const balance = income - expense;
  const net     = getTotalPatrimony();
  const now     = new Date();

  // ── Month label
  document.getElementById('dash-month-label').textContent = mName(dashYear, dashMonth);

  // Status tag removed

  // ── Hero card
  const heroEl = document.getElementById('d-balance');
  if (heroEl) {
    heroEl.textContent = (balance<0?'−':'')+fmt(balance);
    heroEl.style.color = balance>=0 ? '#fff' : 'var(--red-l)';
  }
  const netEl = document.getElementById('d-net');
  if (netEl) {
    netEl.textContent = (net<0?'−':'')+fmt(net);
    netEl.style.color = net>=0 ? 'rgba(255,255,255,.7)' : 'var(--red-l)';
  }

  // ── Hero bar (income vs expense ratio)
  const barFill = document.getElementById('hero-bar-fill');
  const incLabel = document.getElementById('hero-bar-income-label');
  const expLabel = document.getElementById('hero-bar-expense-label');
  if (barFill && income+expense > 0) {
    const pct = Math.min(Math.round(expense/(income||expense)*100),100);
    barFill.style.width = pct+'%';
    barFill.style.background = pct>90?'var(--red-l)':pct>70?'var(--ylw-l)':'var(--grn-l)';
    if (incLabel) incLabel.textContent = '↑ '+fmt(income);
    if (expLabel) expLabel.textContent = '↓ '+fmt(expense);
  } else {
    if (barFill) { barFill.style.width='0%'; }
    if (incLabel) incLabel.textContent = '';
    if (expLabel) expLabel.textContent = '';
  }

  // ── KPI pills
  const incomeEl = document.getElementById('d-income');
  if (incomeEl) incomeEl.textContent = fmt(income);
  const expEl = document.getElementById('d-expense');
  if (expEl) expEl.textContent = fmt(expense);
  const instTotalEl = document.getElementById('d-inst-total');
  if (instTotalEl) instTotalEl.textContent = fmt(instExp);
  const schedTotalEl = document.getElementById('d-sched-total');
  if (schedTotalEl) schedTotalEl.textContent = fmt(fixedExp);

  // ── PENDING BANNER
  const pending = getPendingForMonth(dashYear, dashMonth);
  const banner  = document.getElementById('pending-banner');
  const pList   = document.getElementById('pending-list');
  if (banner && pending.length && dashYear===now.getFullYear() && dashMonth===now.getMonth()) {
    banner.style.display = '';
    const invKey = mkKey(dashYear, dashMonth);
    pList.innerHTML = pending.map(s => {
      const day = getScheduledDateForMonth(s, dashYear, dashMonth);
      const dateStr = `${dashYear}-${String(dashMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const acc = accounts.find(a=>a.id===s.accountId);
      return `<div class="pending-item">
        <div class="pending-item-left">
          <div class="pending-dot ${s.type}"></div>
          <div>
            <div class="pending-item-name">${s.desc}</div>
            <div class="pending-item-meta">Previsto para ${fmtDt(dateStr)} · ${acc?acc.name:'?'}</div>
          </div>
        </div>
        <div class="pending-item-right">
          <div class="pending-item-amt ${s.type}">${s.type==='expense'?'−':'+'}${fmt(s.amount)}</div>
          <button class="btn-confirm" onclick="confirmSched(${s.id},'${invKey}')">✓ Confirmar</button>
          <button class="btn-skip" onclick="skipSchedItem(${s.id},'${invKey}')">Ignorar</button>
        </div>
      </div>`;
    }).join('');
  } else if (banner) {
    banner.style.display = 'none';
  }

  // ── PIE CHART
  const catMap = {};
  txs.filter(t=>t.type==='expense').forEach(t=>{catMap[t.category]=(catMap[t.category]||0)+t.amount;});
  insts.forEach(i=>{catMap[i.category]=(catMap[i.category]||0)+i.perMonth;});

  destroyChart('c-pie');
  const pc = document.getElementById('c-pie');
  if (pc) {
    if (Object.keys(catMap).length) {
      chartInstances['c-pie']=new Chart(pc,{type:'doughnut',data:{
        labels:Object.keys(catMap).map(c=>CAT[c]||c),
        datasets:[{data:Object.values(catMap),backgroundColor:CHART_COLORS,borderWidth:0,hoverOffset:6,borderRadius:4}]
      },options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{
        legend:{position:'bottom',labels:{color:'#777',font:{size:10},padding:8,boxWidth:8,boxHeight:8,usePointStyle:true,pointStyle:'circle'}}
      }}});
    } else {
      const ctx=pc.getContext('2d');ctx.clearRect(0,0,pc.width,pc.height);
      ctx.fillStyle='#333';ctx.textAlign='center';ctx.font='12px DM Sans';
      ctx.fillText('Sem gastos este mês',pc.width/2,pc.height/2);
    }
  }

  // ── LINE CHART
  const ll=[],li=[],le=[],lb=[];
  for(let i=5;i>=0;i--){
    let mo=dashMonth-i,y=dashYear;
    while(mo<0){mo+=12;y--;}
    const mtxs=getTxForMonth(y,mo);
    const minst=getInstForMonth(y,mo);
    const inc=mtxs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const exp=mtxs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)+minst.reduce((s,ii)=>s+ii.perMonth,0);
    ll.push(mShort(y,mo));li.push(inc);le.push(exp);lb.push(inc-exp);
  }
  destroyChart('c-line');
  const lineEl=document.getElementById('c-line');
  if(lineEl){
    chartInstances['c-line']=new Chart(lineEl,{type:'bar',data:{labels:ll,datasets:[
      {label:'Entradas',data:li,backgroundColor:'rgba(39,174,96,.5)',borderRadius:6,borderSkipped:false},
      {label:'Saídas',  data:le,backgroundColor:'rgba(192,57,43,.5)',borderRadius:6,borderSkipped:false},
      {type:'line',label:'Saldo',data:lb,borderColor:'#3498db',backgroundColor:'transparent',tension:.4,pointRadius:4,pointBackgroundColor:'#3498db',borderWidth:2,yAxisID:'y2'}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{
      legend:{labels:{color:'#777',font:{size:10},boxWidth:10,usePointStyle:true,pointStyle:'circle'}}
    },scales:{
      x:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:10}}},
      y:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:10},callback:v=>v===0?'R$0':'R$'+Math.round(v/1000)+'k'}},
      y2:{position:'right',grid:{display:false},ticks:{color:'#3498db',font:{size:9},callback:v=>v===0?'0':'R$'+Math.round(v/1000)+'k'}}
    }}});
  }

  // ── BUDGET panel
  const budEl = document.getElementById('d-budget');
  if (budEl) {
    const mk = mkKey(dashYear,dashMonth);
    const monthBudgets = budgets.filter(b=>b.month===mk);
    if (!monthBudgets.length) {
      budEl.innerHTML='<div class="empty-state">Sem limites definidos.</div>';
    } else {
      budEl.innerHTML=monthBudgets.map(b=>{
        const spent=catMap[b.category]||0;
        const pct=Math.min(Math.round(spent/b.limit*100),100);
        const color=pct>=90?'var(--red-l)':pct>=70?'var(--ylw-l)':'var(--grn-l)';
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span>${CAT[b.category]||b.category}</span><span style="color:${color};font-weight:700">${pct}%</span>
          </div>
          <div style="height:4px;background:var(--bdr);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .5s"></div>
          </div>
          <div style="font-size:10px;color:var(--tx-3);margin-top:3px;display:flex;justify-content:space-between">
            <span>${fmt(spent)}</span><span>de ${fmt(b.limit)}</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── INSTALLMENTS panel
  const diEl = document.getElementById('d-inst');
  if (diEl) {
    const active=installments.filter(i=>getInstPaidCount(i)<i.count);
    diEl.innerHTML=active.length?active.slice(0,4).map(i=>{
      const pct=Math.round(getInstPaidCount(i)/i.count*100);
      const next=getInstNextUnpaid(i);
      const isOver=next&&getInstParcelaStatus(i,next)==='overdue';
      return `<div class="di-item">
        <div class="di-top">
          <span style="color:${isOver?'var(--red-l)':'var(--tx)'}">${i.desc}${isOver?' ⚠':''}</span>
          <span style="color:var(--red-l);font-weight:600">${fmt(i.perMonth)}</span>
        </div>
        <div class="di-bar-bg"><div class="di-bar" style="width:${pct}%;background:${isOver?'var(--red-l)':'var(--blu-l)'}"></div></div>
        <div style="font-size:10px;color:var(--tx-3);margin-top:2px">${getInstPaidCount(i)}/${i.count} pagas</div>
      </div>`;
    }).join(''):'<div class="empty-state">Sem parcelas ativas.</div>';
  }

  // ── UPCOMING SCHEDULED panel
  const today_d=new Date();
  const upcoming=scheds.filter(s=>new Date(s.computedDate)>today_d).sort((a,b)=>a.computedDay-b.computedDay).slice(0,5);
  const sEl=document.getElementById('d-sched');
  if(sEl) sEl.innerHTML=upcoming.length?upcoming.map(s=>`<div class="sc-item">
    <div><div class="sc-name">${s.desc}</div><div class="sc-day">Dia ${s.computedDay}</div></div>
    <div class="sc-amt ${s.type}">${s.type==='expense'?'−':'+'}${fmt(s.amount)}</div>
  </div>`).join(''):'<div class="empty-state">Sem agendamentos futuros.</div>';

  // ── RECENT TRANSACTIONS
  const recEl=document.getElementById('d-recent');
  if(recEl){
    const recent=[...txs].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
    recEl.innerHTML=recent.length?recent.map(t=>`<div class="r-item">
      <div class="r-info"><div class="r-dot ${t.type}"></div>
        <div><div class="r-desc">${t.desc}</div><div class="r-date">${fmtDt(t.date)}</div></div>
      </div>
      <div class="r-amt ${t.type}">${t.type==='expense'?'−':'+'}${fmt(t.amount)}</div>
    </div>`).join(''):'<div class="empty-state">Sem transações.</div>';
  }
}
// ═══════════════════════════════════════════════════════════════════
// ACCESS CODE GATE
// ═══════════════════════════════════════════════════════════════════
const ACCESS_CODE = 'finpro2026';

async function hashStr(str, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const hashPassword     = (p)  => hashStr(p.toLowerCase().trim() + p, 'finpro_salt_2026');
const hashRecoveryCode = (c)  => hashStr(c.replace(/-/g,'').toUpperCase(), 'finpro_recovery_2026');
const hashAccessCode   = (c)  => hashStr(c.toLowerCase().trim(), 'finpro_access');

function getStoredHash()    { return localStorage.getItem('fp_pass_hash'); }
function getStoredRecovery(){ return localStorage.getItem('fp_recovery_hash'); }

function showApp() {
  document.getElementById('loading-screen').style.display  = 'none';
  document.getElementById('lock-screen').style.display     = 'none';
  document.getElementById('setup-screen').style.display    = 'none';
  document.getElementById('main-app').style.display        = '';
  sessionStorage.setItem('fp_unlocked','1');
}

function generateRecoveryCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  for(let i=0;i<16;i++){ if(i>0&&i%4===0) code+='-'; code+=chars[Math.floor(Math.random()*chars.length)]; }
  return code;
}

async function initAccessCode() {
  if(!localStorage.getItem('fp_access_hash')) {
    localStorage.setItem('fp_access_hash', await hashAccessCode(ACCESS_CODE));
  }
}

async function initLock() {
  try {
    document.getElementById('loading-screen').style.display = 'none';
    if(sessionStorage.getItem('fp_unlocked')==='1'){ showApp(); return; }
    const hash = getStoredHash();
    if(!hash) {
      document.getElementById('lock-screen').style.display          = 'none';
      document.getElementById('setup-screen').style.display         = 'flex';
      document.getElementById('setup-card-access').style.display    = '';
      document.getElementById('setup-card-form').style.display      = 'none';
      document.getElementById('setup-card-recovery').style.display  = 'none';
    } else {
      document.getElementById('lock-screen').style.display  = 'flex';
      document.getElementById('setup-screen').style.display = 'none';
      const hint = localStorage.getItem('fp_pass_hint');
      document.getElementById('lock-footer').innerHTML =
        (hint?`<div style="font-size:11px;color:var(--tx-3);margin-bottom:8px">💡 Dica: <em>${hint}</em></div>`:'') +
        `<span style="font-size:11px;color:var(--tx-3)">Esqueceu a senha? <button onclick="showRecoveryInput()" style="background:none;border:none;color:var(--red-l);cursor:pointer;font-size:11px;text-decoration:underline">Usar código de recuperação</button></span>`;
    }
  } catch(err) {
    console.error('initLock error:', err);
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display   = 'flex';
    document.getElementById('setup-card-access').style.display = '';
    document.getElementById('setup-card-form').style.display    = 'none';
    document.getElementById('setup-card-recovery').style.display = 'none';
  }
}

// ACCESS FORM
document.getElementById('access-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('access-code-input').value;
  const inputHash = await hashAccessCode(input);
  const err = document.getElementById('access-error');
  if(inputHash === localStorage.getItem('fp_access_hash')) {
    err.style.display='none';
    document.getElementById('setup-card-access').style.display = 'none';
    document.getElementById('setup-card-form').style.display   = '';
  } else {
    err.style.display='';
    document.getElementById('access-code-input').value='';
    document.getElementById('access-code-input').focus();
  }
});

// SETUP FORM
document.getElementById('setup-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const p1=document.getElementById('setup-pass1').value;
  const p2=document.getElementById('setup-pass2').value;
  const hint=document.getElementById('setup-hint').value.trim();
  const err=document.getElementById('setup-error');
  if(p1.length<4){err.textContent='Senha deve ter pelo menos 4 caracteres.';err.style.display='';return;}
  if(p1!==p2){err.textContent='As senhas não coincidem.';err.style.display='';return;}
  err.style.display='none';
  localStorage.setItem('fp_pass_hash', await hashPassword(p1));
  if(hint) localStorage.setItem('fp_pass_hint',hint);
  const code=generateRecoveryCode();
  localStorage.setItem('fp_recovery_hash', await hashRecoveryCode(code));
  document.getElementById('setup-card-form').style.display     = 'none';
  document.getElementById('setup-card-recovery').style.display = '';
  document.getElementById('recovery-code-display').textContent  = code;
});

// LOGIN FORM
document.getElementById('lock-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const password=document.getElementById('lock-password').value;
  const err=document.getElementById('lock-error');
  if(await hashPassword(password)===getStoredHash()) {
    err.style.display='none'; showApp();
  } else {
    err.style.display='';
    document.getElementById('lock-password').value='';
    document.getElementById('lock-password').focus();
    const card=document.querySelector('#lock-screen .lock-card');
    if(card){card.style.animation='shake .4s ease';setTimeout(()=>card.style.animation='',400);}
  }
});

document.getElementById('lock-toggle-vis')?.addEventListener('click',()=>{
  const inp=document.getElementById('lock-password');
  inp.type=inp.type==='password'?'text':'password';
});

// RECOVERY CODE
document.getElementById('btn-copy-recovery')?.addEventListener('click',()=>{
  const code=document.getElementById('recovery-code-display').textContent;
  navigator.clipboard.writeText(code).then(()=>{
    document.getElementById('btn-copy-recovery').textContent='✓ Copiado!';
    setTimeout(()=>document.getElementById('btn-copy-recovery').textContent='📋 Copiar código',2000);
  });
});
document.getElementById('btn-confirm-recovery')?.addEventListener('click',()=>{ showApp(); showToast('Bem-vindo ao FinPro!'); });

window.showRecoveryInput=()=>{ document.getElementById('recovery-input-section').style.display=''; document.getElementById('recovery-input').focus(); };
window.hideRecoveryInput=()=>{ document.getElementById('recovery-input-section').style.display='none'; document.getElementById('recovery-error').style.display='none'; };

document.getElementById('recovery-input')?.addEventListener('input',e=>{
  let val=e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,16);
  e.target.value=val.match(/.{1,4}/g)?.join('-')||val;
});

document.getElementById('recovery-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const code=document.getElementById('recovery-input').value;
  const newPass=document.getElementById('recovery-new-pass').value;
  const err=document.getElementById('recovery-error');
  if(newPass.length<4){err.textContent='Nova senha deve ter pelo menos 4 caracteres.';err.style.display='';return;}
  if(await hashRecoveryCode(code)!==getStoredRecovery()){err.textContent='Código inválido.';err.style.display='';return;}
  localStorage.setItem('fp_pass_hash', await hashPassword(newPass));
  const newCode=generateRecoveryCode();
  localStorage.setItem('fp_recovery_hash', await hashRecoveryCode(newCode));
  err.style.display='none'; hideRecoveryInput(); showApp();
  setTimeout(()=>alert(`✅ Senha redefinida!\n\nNovo código de recuperação:\n\n${newCode}\n\nGuarde-o em local seguro!`),500);
  showToast('Senha redefinida!');
});

// CHANGE PASSWORD
document.getElementById('btn-change-pass')?.addEventListener('click',()=>{
  ['cp-current','cp-new1','cp-new2'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cp-error').style.display='none';
  document.getElementById('modal-change-pass').style.display='flex';
});
document.getElementById('btn-cancel-cp')?.addEventListener('click',()=>document.getElementById('modal-change-pass').style.display='none');
document.getElementById('change-pass-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const current=document.getElementById('cp-current').value;
  const new1=document.getElementById('cp-new1').value;
  const new2=document.getElementById('cp-new2').value;
  const err=document.getElementById('cp-error');
  if(await hashPassword(current)!==getStoredHash()){err.textContent='Senha atual incorreta.';err.style.display='';return;}
  if(new1.length<4){err.textContent='Nova senha deve ter pelo menos 4 caracteres.';err.style.display='';return;}
  if(new1!==new2){err.textContent='As senhas não coincidem.';err.style.display='';return;}
  localStorage.setItem('fp_pass_hash', await hashPassword(new1));
  const newCode=generateRecoveryCode();
  localStorage.setItem('fp_recovery_hash', await hashRecoveryCode(newCode));
  document.getElementById('modal-change-pass').style.display='none';
  setTimeout(()=>alert(`✅ Senha alterada!\n\nNovo código de recuperação:\n\n${newCode}\n\nGuarde-o em local seguro!`),300);
  showToast('Senha alterada!');
});

window.forgotPassword=()=>{
  if(!confirm('Isso vai APAGAR todos os dados e redefinir. Tem certeza?')) return;
  if(!confirm('Última confirmação?')) return;
  localStorage.clear();sessionStorage.clear();location.reload();
};

// SHAKE
const _ss=document.createElement('style');
_ss.textContent='@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}';
document.head.appendChild(_ss);

// EXPORT / IMPORT / CLEAR
document.getElementById('btn-export')?.addEventListener('click',()=>{
  const payload={version:'1.1',exportedAt:new Date().toISOString(),accounts,transactions,scheduled,installments,budgets,creditCards,invoicePayments,confirmedScheduled:JSON.parse(localStorage.getItem('fp_confirmed_sched')||'[]'),skippedScheduled:JSON.parse(localStorage.getItem('fp_skipped_sched')||'[]')};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`finpro-backup-${today()}.json`;a.click();
  URL.revokeObjectURL(url);
  showToast('Dados exportados!');
});

document.getElementById('btn-import')?.addEventListener('change',e=>{
  const file=e.target.files[0];if(!file)return;
  if(!confirm('Isso vai substituir TODOS os dados atuais. Continuar?')){e.target.value='';return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(!data.accounts||!data.transactions) throw new Error('Arquivo inválido.');
      accounts=data.accounts||[];transactions=data.transactions||[];
      scheduled=data.scheduled||[];installments=data.installments||[];
      budgets=data.budgets||[];creditCards=data.creditCards||[];
      invoicePayments=data.invoicePayments||[];
      if(data.confirmedScheduled) localStorage.setItem('fp_confirmed_sched',JSON.stringify(data.confirmedScheduled));
      if(data.skippedScheduled) localStorage.setItem('fp_skipped_sched',JSON.stringify(data.skippedScheduled));
      save();saveCards();
      populateAccountSelects();populateCreditCardSelects();
      renderDashboard();updateSidebar();
      showToast('Dados importados!');
    }catch(err){showToast('Erro ao importar: '+err.message,'error');}
    e.target.value='';
  };
  reader.readAsText(file);
});

document.getElementById('btn-clear-data')?.addEventListener('click',()=>{
  if(!confirm('Apagar TODOS os dados permanentemente?')) return;
  if(!confirm('Última confirmação?')) return;
  accounts=[];transactions=[];scheduled=[];installments=[];budgets=[];creditCards=[];invoicePayments=[];
  save();saveCards();
  populateAccountSelects();populateCreditCardSelects();
  renderDashboard();updateSidebar();
  showToast('Todos os dados apagados.');
});

// INIT
async function startApp() {
  await initAccessCode();
  initLock();
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',startApp);
} else {
  startApp();
}

// ═══════════════════════════════════════════════════════════════════
// INSTALLMENTS — FULL SYSTEM (cards, edit, pay, settle)
// ═══════════════════════════════════════════════════════════════════
let editingInstId = null, payingInstId = null, settlingInstId = null;

function migrateInstallments() {
  installments.forEach(inst => {
    if (!inst.paidDates) {
      inst.paidDates = [];
      inst.dueDay = inst.dueDay || 10;
      const oldPaid = inst.paid || 0;
      for (let n = 1; n <= oldPaid; n++) {
        const due = getInstDueDate(inst, n);
        inst.paidDates.push({ parcelaNum: n, date: due.str, txId: null });
      }
    }
  });
  save();
}

function getInstDueDate(inst, n) {
  const [sy, sm] = inst.start.split('-').map(Number);
  let m = sm - 1 + (n - 1), y = sy;
  while (m > 11) { m -= 12; y++; }
  const day = Math.min(inst.dueDay || 10, lastDayOfMonth(y, m));
  return { y, m, day, str: `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` };
}
function getInstParcelaStatus(inst, n) {
  if (!inst.paidDates) inst.paidDates = [];
  if (inst.paidDates.find(p => p.parcelaNum === n)) return 'paid';
  const due = getInstDueDate(inst, n);
  const now = new Date(); now.setHours(0,0,0,0);
  if (new Date(due.str+'T00:00:00') < now) return 'overdue';
  if (mkKey(due.y, due.m) === mkKey(new Date().getFullYear(), new Date().getMonth())) return 'pending';
  return 'future';
}
function getInstNextUnpaid(inst) {
  if (!inst.paidDates) inst.paidDates = [];
  for (let n = 1; n <= inst.count; n++) {
    if (!inst.paidDates.find(p => p.parcelaNum === n)) return n;
  }
  return null;
}
function getInstPaidCount(inst) { return inst.paidDates ? inst.paidDates.length : (inst.paid || 0); }
function getInstRemainingAmount(inst) { return inst.perMonth * (inst.count - getInstPaidCount(inst)); }

function renderInstallments() {
  migrateInstallments();
  const filter = document.getElementById('inst-filter')?.value || 'active';
  const allActive = installments.filter(i => getInstPaidCount(i) < i.count);
  const totalDebt = allActive.reduce((s,i) => s + getInstRemainingAmount(i), 0);
  const nextMonthExp = allActive.reduce((s,i) => s + i.perMonth, 0);
  const overdueCount = installments.filter(i => { const n=getInstNextUnpaid(i); return n && getInstParcelaStatus(i,n)==='overdue'; }).length;
  const doneCount = installments.filter(i => getInstPaidCount(i) >= i.count).length;

  const bar = document.getElementById('inst-summary-bar');
  if (bar) bar.innerHTML = `
    <div class="isb-item"><div class="isb-lbl">Dívida Total</div><div class="isb-val neg">${fmt(totalDebt)}</div></div>
    <div class="isb-item"><div class="isb-lbl">Próximo Mês</div><div class="isb-val neg">${fmt(nextMonthExp)}</div></div>
    <div class="isb-item"><div class="isb-lbl">Atrasadas</div><div class="isb-val" style="color:${overdueCount?'var(--red-l)':'var(--tx-1)'}">${overdueCount}</div></div>
    <div class="isb-item"><div class="isb-lbl">Quitadas</div><div class="isb-val pos">${doneCount}</div></div>`;

  let list = [...installments];
  if (filter === 'active') list = list.filter(i => getInstPaidCount(i) < i.count);
  if (filter === 'done')   list = list.filter(i => getInstPaidCount(i) >= i.count);

  const el = document.getElementById('inst-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhuma parcela encontrada.</div>'; return; }
  el.innerHTML = list.map(inst => {
    const paidCount = getInstPaidCount(inst);
    const isDone = paidCount >= inst.count;
    const rem = inst.count - paidCount;
    const pct = Math.round(paidCount / inst.count * 100);
    const remAmt = getInstRemainingAmount(inst);
    const acc = accounts.find(a => a.id === inst.accountId);
    const nextNum = getInstNextUnpaid(inst);
    const isOverdue = nextNum && getInstParcelaStatus(inst, nextNum) === 'overdue';
    const barColor = isDone ? 'var(--grn-l)' : isOverdue ? 'var(--red-l)' : 'var(--blu-l)';
    const nextDue = nextNum ? getInstDueDate(inst, nextNum) : null;
    const rows = Array.from({length: inst.count}, (_,i) => {
      const n = i+1, due = getInstDueDate(inst, n);
      const status = getInstParcelaStatus(inst, n);
      const paidRec = inst.paidDates?.find(p => p.parcelaNum === n);
      const labels = {paid:'Paga',pending:'A vencer',overdue:'Atrasada',future:'Futura'};
      return `<div class="inst-parcela-row ${status}">
        <div class="ipr-num">${n}/${inst.count}</div>
        <div class="ipr-date">${status==='paid'&&paidRec?fmtDt(paidRec.date)+' ✓':fmtDt(due.str)}</div>
        <div class="ipr-amount neg">${fmt(inst.perMonth)}</div>
        <div class="ipr-status"><span class="status-chip ${status}">${labels[status]}</span></div>
      </div>`;
    }).join('');
    return `<div class="inst-card${isDone?' done':''}${isOverdue?' overdue':''}" data-id="${inst.id}">
      <div class="inst-card-header">
        <div class="ich-left">
          <div class="ich-color" style="background:${barColor}"></div>
          <div class="ich-info">
            <div class="ich-name">${inst.desc}${isOverdue?' ⚠':''}</div>
            <div class="ich-meta">${CAT[inst.category]||inst.category} · ${acc?acc.name:'?'}${inst.note?' · '+inst.note:''}</div>
          </div>
        </div>
        <div class="ich-right">
          <div class="ich-amounts">
            <div class="ich-per-month" style="color:${isDone?'var(--grn-l)':'var(--red-l)'}">${isDone?'Quitada':fmt(inst.perMonth)+'/mês'}</div>
            <div class="ich-remaining">${isDone?paidCount+' pagas':rem+' restantes · '+fmt(remAmt)}</div>
          </div>
          <div class="ich-chevron">▾</div>
        </div>
      </div>
      <div class="inst-card-progress">
        <div class="icp-bar-bg"><div class="icp-bar" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="icp-labels"><span>${paidCount}/${inst.count} (${pct}%)</span><span>${isDone?'Quitada':nextDue?'Próx: '+fmtDt(nextDue.str):''}</span></div>
      </div>
      <div class="inst-card-actions">
        ${!isDone&&nextNum?`<button class="small-btn" onclick="openPayInst(${inst.id})">💰 Pagar parcela ${nextNum}</button>`:''}
        ${!isDone?`<button class="small-btn" onclick="openSettleInst(${inst.id})">⚡ Quitar tudo</button>`:''}
        <button class="small-btn" onclick="editInst(${inst.id})">✎ Editar</button>
        <button class="small-btn del" onclick="delInst(${inst.id})">✕ Excluir</button>
      </div>
      <div class="inst-card-body">
        <div class="inst-parcela-header"><div>Nº</div><div>Data</div><div>Valor</div><div>Status</div></div>
        <div class="inst-parcela-list">${rows}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.inst-card-header').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('.inst-card').classList.toggle('expanded'));
  });
}

window.openPayInst = (id) => {
  payingInstId = id;
  const inst = installments.find(i => i.id === id);
  const nextNum = getInstNextUnpaid(inst);
  if (!nextNum) return showToast('Todas as parcelas já foram pagas!');
  const due = getInstDueDate(inst, nextNum);
  document.getElementById('mpinst-title').textContent = `Parcela ${nextNum}/${inst.count} — ${inst.desc}`;
  document.getElementById('mpinst-info').innerHTML = `Vencimento: <strong>${fmtDt(due.str)}</strong> · Valor: <strong style="color:var(--red-l)">${fmt(inst.perMonth)}</strong>`;
  document.getElementById('pi-amount').value = inst.perMonth.toFixed(2);
  document.getElementById('pi-date').value = today();
  const acc = document.getElementById('pi-account');
  acc.innerHTML = accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if (inst.accountId) acc.value = inst.accountId;
  document.getElementById('modal-pay-inst').style.display = 'flex';
};

document.getElementById('btn-cancel-pay-inst')?.addEventListener('click', () => document.getElementById('modal-pay-inst').style.display='none');
document.getElementById('pay-inst-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const inst = installments.find(i => i.id === payingInstId);
  const nextNum = getInstNextUnpaid(inst);
  const accountId = parseInt(document.getElementById('pi-account').value);
  const date = document.getElementById('pi-date').value;
  const amount = parseFloat(document.getElementById('pi-amount').value);
  const txId = Date.now();
  transactions.push({id:txId,desc:`${inst.desc} (${nextNum}/${inst.count})`,amount,accountId,category:inst.category,date,type:'expense',status:'paid',note:`Parcela ${nextNum} de ${inst.count}`});
  if (!inst.paidDates) inst.paidDates = [];
  inst.paidDates.push({parcelaNum:nextNum,date,txId});
  inst.paid = inst.paidDates.length;
  save();
  document.getElementById('modal-pay-inst').style.display = 'none';
  showToast(`Parcela ${nextNum}/${inst.count} paga!`);
  renderInstallments(); renderDashboard(); updateSidebar();
});

window.openSettleInst = (id) => {
  settlingInstId = id;
  const inst = installments.find(i => i.id === id);
  const remAmt = getInstRemainingAmount(inst);
  document.getElementById('msettle-info').innerHTML = `<strong>${inst.desc}</strong><br>${inst.count-getInstPaidCount(inst)} parcelas · <strong style="color:var(--red-l)">${fmt(remAmt)}</strong>`;
  document.getElementById('si-amount').value = remAmt.toFixed(2);
  document.getElementById('si-date').value = today();
  const acc = document.getElementById('si-account');
  acc.innerHTML = accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if (inst.accountId) acc.value = inst.accountId;
  document.getElementById('modal-settle-inst').style.display = 'flex';
};

document.getElementById('btn-cancel-settle')?.addEventListener('click', () => document.getElementById('modal-settle-inst').style.display='none');
document.getElementById('settle-inst-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const inst = installments.find(i => i.id === settlingInstId);
  const accountId = parseInt(document.getElementById('si-account').value);
  const date = document.getElementById('si-date').value;
  const amount = parseFloat(document.getElementById('si-amount').value);
  const txId = Date.now();
  transactions.push({id:txId,desc:`${inst.desc} — Quitação antecipada`,amount,accountId,category:inst.category,date,type:'expense',status:'paid'});
  if (!inst.paidDates) inst.paidDates = [];
  for (let n = 1; n <= inst.count; n++) {
    if (!inst.paidDates.find(p => p.parcelaNum === n)) inst.paidDates.push({parcelaNum:n,date,txId});
  }
  inst.paid = inst.count;
  save();
  document.getElementById('modal-settle-inst').style.display = 'none';
  showToast(`${inst.desc} quitada!`);
  renderInstallments(); renderDashboard(); updateSidebar();
});

window.editInst = (id) => {
  const inst = installments.find(i => i.id === id); if (!inst) return;
  editingInstId = id;
  document.getElementById('minst-title').textContent = 'Editar Parcela';
  document.getElementById('i-desc').value    = inst.desc;
  document.getElementById('i-total').value   = inst.total;
  document.getElementById('i-count').value   = inst.count;
  document.getElementById('i-start').value   = inst.start;
  document.getElementById('i-dueday').value  = inst.dueDay || 10;
  document.getElementById('i-category').value = inst.category;
  document.getElementById('i-note').value    = inst.note || '';
  const acc = document.getElementById('i-account');
  acc.innerHTML = accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if (inst.accountId) acc.value = inst.accountId;
  document.getElementById('modal-inst').style.display = 'flex';
};

window.delInst = (id) => {
  if (!confirm('Excluir esta parcela?')) return;
  installments = installments.filter(i => i.id !== id);
  save(); renderInstallments(); renderDashboard(); showToast('Parcela excluída.');
};

document.getElementById('inst-filter')?.addEventListener('change', renderInstallments);

// Preview per-month
['i-total','i-count'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const t=parseFloat(document.getElementById('i-total')?.value);
    const c=parseInt(document.getElementById('i-count')?.value);
    const p=document.getElementById('i-preview');
    const pt=document.getElementById('i-preview-text');
    if(p&&pt&&t>0&&c>0){pt.textContent=`${c}x de ${fmt(t/c)} = Total ${fmt(t)}`;p.style.display='';}
    else if(p) p.style.display='none';
  });
});

migrateInstallments();

// ═══════════════════════════════════════════════════════════════════
// PHASE 1 — IMPROVEMENTS (clean, no function redeclarations)
// ═══════════════════════════════════════════════════════════════════

// ── CHART STATE ───────────────────────────────────────────────────
let chartPieType    = 'doughnut';
let chartLineType   = 'bar';
let chartLinePeriod = 6;

// 15 distinct high-contrast colors
const PIE_COLORS = [
  '#ef4444','#3b82f6','#22c55e','#f59e0b','#a78bfa',
  '#ec4899','#06b6d4','#84cc16','#f97316','#14b8a6',
  '#8b5cf6','#fb923c','#4ade80','#60a5fa','#fbbf24'
];

const BANK_ICONS = {
  generic:'💳', nubank:'🟣', itau:'🟠', bradesco:'🔴',
  bb:'💛', caixa:'🔵', inter:'🟡', xp:'⬛', c6:'🖤', picpay:'💚'
};
const BANK_COLORS = {
  generic:'#6b21a8', nubank:'#820ad1', itau:'#f97316', bradesco:'#cc0000',
  bb:'#f59e0b', caixa:'#1d4ed8', inter:'#ea580c', xp:'#111', c6:'#1a1a1a', picpay:'#21c25e'
};

let selectedBank    = 'generic';
let editingSchedId  = null;

// ── CHART CONTROLS ────────────────────────────────────────────────
document.querySelectorAll('[data-pie]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-pie]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartPieType = btn.dataset.pie;
    renderDashboard();
  });
});

document.querySelectorAll('[data-line]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-line]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartLineType = btn.dataset.line;
    renderDashboard();
  });
});

document.getElementById('line-period')?.addEventListener('change', e => {
  chartLinePeriod = parseInt(e.target.value);
  renderDashboard();
});

// ── STANDALONE CHART RENDERER (called from renderDashboard) ──────
function renderDashCharts(txs, insts) {
  // PIE
  const catMap = {};
  txs.filter(t => t.type==='expense').forEach(t => { catMap[t.category]=(catMap[t.category]||0)+t.amount; });
  insts.forEach(i => { catMap[i.category]=(catMap[i.category]||0)+i.perMonth; });

  destroyChart('c-pie');
  const pc = document.getElementById('c-pie');
  if (pc) {
    if (Object.keys(catMap).length) {
      const labels = Object.keys(catMap).map(c=>CAT[c]||c);
      const values = Object.values(catMap);
      const colors = PIE_COLORS.slice(0, labels.length);
      const isBar  = chartPieType === 'bar';
      chartInstances['c-pie'] = new Chart(pc, {
        type: isBar ? 'bar' : chartPieType,
        data: isBar
          ? { labels, datasets:[{data:values, backgroundColor:colors, borderRadius:6, borderSkipped:false}] }
          : { labels, datasets:[{data:values, backgroundColor:colors, borderWidth:2, borderColor:'rgba(0,0,0,.2)', hoverOffset:8}] },
        options: {
          responsive:true, maintainAspectRatio:false,
          cutout: chartPieType==='doughnut' ? '65%' : undefined,
          plugins: {
            legend:{ position:'bottom', labels:{color:'#888',font:{size:10},padding:8,boxWidth:10,usePointStyle:!isBar,pointStyle:'circle'} },
            tooltip:{ backgroundColor:'rgba(15,15,20,.95)', padding:10, titleColor:'#fff', bodyColor:'#aaa', borderColor:'rgba(255,255,255,.08)', borderWidth:1,
              callbacks:{ label: ctx => ` ${fmt(isBar ? ctx.parsed.y : ctx.parsed)}`, title: ctx => ctx[0]?.label||'' } }
          },
          scales: isBar ? {
            x:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:9},maxRotation:35}},
            y:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:9},callback:v=>'R$'+Math.round(v)}}
          } : undefined
        }
      });
    } else {
      const ctx=pc.getContext('2d'); ctx.clearRect(0,0,pc.width,pc.height);
      ctx.fillStyle='#333'; ctx.textAlign='center'; ctx.font='12px DM Sans';
      ctx.fillText('Sem gastos este mês', pc.width/2, pc.height/2);
    }
  }

  // LINE
  const ll=[],li=[],le=[],lb=[];
  for (let i=chartLinePeriod-1; i>=0; i--) {
    let mo=dashMonth-i, y=dashYear;
    while(mo<0){mo+=12;y--;}
    const mt=getTxForMonth(y,mo), mi=getInstForMonth(y,mo);
    const inc=mt.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const exp=mt.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)+mi.reduce((s,ii)=>s+ii.perMonth,0);
    ll.push(mShort(y,mo)); li.push(inc); le.push(exp); lb.push(inc-exp);
  }
  destroyChart('c-line');
  const lineEl = document.getElementById('c-line');
  if (!lineEl) return;
  const isLine=chartLineType==='line'||chartLineType==='area';
  const isArea=chartLineType==='area';
  const ttOpts={ backgroundColor:'rgba(15,15,20,.95)', padding:12, titleColor:'#fff', bodyColor:'#aaa',
    borderColor:'rgba(255,255,255,.08)', borderWidth:1, mode:'index', intersect:false,
    callbacks:{ label: ctx=>`  ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } };
  chartInstances['c-line'] = new Chart(lineEl, {
    type: isLine ? 'line' : 'bar',
    data:{ labels:ll, datasets:[
      { label:'Entradas', data:li,
        backgroundColor: isLine?(isArea?'rgba(34,197,94,.1)':'transparent'):'rgba(34,197,94,.55)',
        borderColor:'#22c55e', borderWidth:isLine?2:0, tension:.4, fill:isArea,
        pointRadius:isLine?4:0, pointBackgroundColor:'#22c55e', pointHoverRadius:7,
        borderRadius:isLine?0:6, borderSkipped:false },
      { label:'Saídas', data:le,
        backgroundColor: isLine?(isArea?'rgba(239,68,68,.1)':'transparent'):'rgba(239,68,68,.55)',
        borderColor:'#ef4444', borderWidth:isLine?2:0, tension:.4, fill:isArea,
        pointRadius:isLine?4:0, pointBackgroundColor:'#ef4444', pointHoverRadius:7,
        borderRadius:isLine?0:6, borderSkipped:false },
      { label:'Saldo', data:lb, type:'line',
        borderColor:'#3b82f6', backgroundColor:'transparent',
        borderWidth:2, borderDash:[5,3], tension:.4,
        pointRadius:4, pointBackgroundColor:'#3b82f6', pointHoverRadius:7, yAxisID:'y2' }
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{labels:{color:'#777',font:{size:10},boxWidth:10,usePointStyle:true,pointStyle:'circle'}}, tooltip:ttOpts },
      scales:{
        x:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:10}}},
        y:{grid:{color:'rgba(255,255,255,.03)'},ticks:{color:'#555',font:{size:10},callback:v=>v===0?'0':'R$'+Math.round(v/1000)+'k'}},
        y2:{position:'right',grid:{display:false},ticks:{color:'#3b82f6',font:{size:9},callback:v=>'R$'+Math.round(v/1000)+'k'}}
      }
    }
  });
}

// ── PATCH renderDashboard to call renderDashCharts ────────────────
// Store original and wrap (only once)
const _rd_original = renderDashboard;
renderDashboard = function() {
  _rd_original();
  const txs   = getTxForMonth(dashYear, dashMonth);
  const insts = getInstForMonth(dashYear, dashMonth);
  requestAnimationFrame(() => renderDashCharts(txs, insts));
};

// ── EDIT SCHEDULED ────────────────────────────────────────────────
window.editSched = (id) => {
  const s = scheduled.find(x=>x.id===id); if(!s) return;
  editingSchedId = id;
  editSchedType = s.type || 'expense';
  const modal = document.getElementById('modal-edit-sched');
  if (!modal) { showToast('Modal não encontrado.','error'); return; }
  document.getElementById('es-desc').value     = s.desc;
  document.getElementById('es-amount').value   = s.amount;
  document.getElementById('es-category').value = s.category;
  document.getElementById('es-daytype').value  = s.dayType;
  document.getElementById('es-day').value      = s.day || 5;
  document.querySelectorAll('#es-type-toggle .type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === s.type);
  });
  const acc = document.getElementById('es-account');
  acc.innerHTML = accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if(s.accountId) acc.value = s.accountId;
  modal.style.display='flex';
};
document.getElementById('btn-cancel-edit-sched')?.addEventListener('click',()=>
  document.getElementById('modal-edit-sched').style.display='none');
// Edit sched type toggle
let editSchedType = 'expense';
document.getElementById('es-type-toggle')?.addEventListener('click', e => {
  const btn = e.target.closest('.type-btn'); if(!btn) return;
  document.querySelectorAll('#es-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); editSchedType = btn.dataset.type;
});

document.getElementById('edit-sched-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const s=scheduled.find(x=>x.id===editingSchedId); if(!s) return;
  s.desc=document.getElementById('es-desc').value.trim();
  s.amount=parseFloat(document.getElementById('es-amount').value);
  s.category=document.getElementById('es-category').value;
  s.dayType=document.getElementById('es-daytype').value;
  s.day=parseInt(document.getElementById('es-day').value)||0;
  s.accountId=parseInt(document.getElementById('es-account').value);
  s.type=editSchedType;
  save(); renderScheduled(); renderDashboard();
  document.getElementById('modal-edit-sched').style.display='none';
  showToast('Agendamento atualizado!'); editingSchedId=null;
});

// ── OVERRIDE renderScheduled with edit button ─────────────────────
renderScheduled = function() {
  const el=document.getElementById('sched-list');
  if(!el) return;
  if(!scheduled.length){el.innerHTML='<div class="empty-state">Nenhum agendamento cadastrado.</div>';return;}
  el.innerHTML=scheduled.map(s=>{
    const acc=accounts.find(a=>a.id===s.accountId);
    const dayLabel=s.dayType==='business'?`${s.day}º dia útil`:s.dayType==='lastday'?'Último dia':`Dia ${s.day}`;
    return `<div class="sched-item">
      <div class="sched-left">
        <div class="sched-stripe" style="background:${s.type==='income'?'var(--grn-l)':'var(--red-l)'}"></div>
        <div>
          <div class="sched-name">${s.desc}${!s.active?' <span style="font-size:10px;color:var(--tx-3)">(pausado)</span>':''}</div>
          <div class="sched-meta">${CAT[s.category]||s.category} · ${acc?acc.name:'?'} · ${dayLabel}/mês</div>
        </div>
      </div>
      <div class="sched-right">
        <div class="sched-amt" style="color:${s.type==='income'?'var(--grn-l)':'var(--red-l)'}">${s.type==='expense'?'−':'+'}${fmt(s.amount)}</div>
        <div style="display:flex;gap:6px">
          <button class="small-btn" onclick="editSched(${s.id})">✎</button>
          <button class="small-btn" onclick="toggleSched(${s.id})">${s.active?'⏸':'▶'}</button>
          <button class="small-btn del" onclick="deleteSched(${s.id})">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
};

// ── OVERRIDE renderBudget with edit + real overflow ───────────────
renderBudget = function() {
  const now=new Date(), mk=mkKey(now.getFullYear(),now.getMonth());
  const budMonthEl=document.getElementById('bud-month-label');
  if(budMonthEl) budMonthEl.textContent=mName(now.getFullYear(),now.getMonth());
  const txs=getTxForMonth(now.getFullYear(),now.getMonth());
  const scheds=getSchedForMonth(now.getFullYear(),now.getMonth()).filter(s=>s.type==='expense');
  const insts=getInstForMonth(now.getFullYear(),now.getMonth());
  const catSpent={};
  txs.filter(t=>t.type==='expense').forEach(t=>{catSpent[t.category]=(catSpent[t.category]||0)+t.amount;});
  scheds.forEach(s=>{catSpent[s.category]=(catSpent[s.category]||0)+s.amount;});
  insts.forEach(i=>{catSpent[i.category]=(catSpent[i.category]||0)+i.perMonth;});
  const grid=document.getElementById('budget-grid');
  if(!grid) return;
  const monthBudgets=budgets.filter(b=>b.month===mk);
  if(!monthBudgets.length){grid.innerHTML='<div class="empty-state" style="grid-column:1/-1">Defina limites abaixo para ver o orçamento.</div>';return;}
  grid.innerHTML=monthBudgets.map(b=>{
    const spent=catSpent[b.category]||0;
    const rawPct=Math.round(spent/b.limit*100);
    const barPct=Math.min(rawPct,100);
    const isOver=rawPct>100;
    const color=isOver?'var(--red-l)':rawPct>=75?'var(--ylw-l)':'var(--grn-l)';
    const overflow=isOver?spent-b.limit:0;
    return `<div class="budget-item">
      <div class="bud-top">
        <span class="bud-cat">${CAT[b.category]||b.category}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="bud-pct" style="color:${color}">${rawPct}%${isOver?' ⚠':''}</span>
          <button class="small-btn" onclick="editBudgetLimit('${b.category}','${mk}')">✎</button>
          <button class="small-btn del" onclick="delBudget('${b.category}','${mk}')">✕</button>
        </div>
      </div>
      <div class="bud-bar-bg"><div class="bud-bar" style="width:${barPct}%;background:${color}"></div></div>
      <div class="bud-vals">
        <span>${fmt(spent)} gasto</span>
        <span style="color:${isOver?'var(--red-l)':'var(--tx-3)'}">${isOver?'+'+fmt(overflow)+' acima':fmt(b.limit-spent)+' restante'}</span>
      </div>
    </div>`;
  }).join('');
};

window.editBudgetLimit=(cat,mk)=>{
  const b=budgets.find(x=>x.category===cat&&x.month===mk); if(!b) return;
  document.getElementById('b-cat').value=cat;
  document.getElementById('b-limit').value=b.limit;
  document.getElementById('b-limit').focus();
  showToast('Edite o valor e clique em Definir Limite.');
};

// ── BANK ICON PICKER ──────────────────────────────────────────────
document.getElementById('bank-icon-picker')?.addEventListener('click',e=>{
  const btn=e.target.closest('.bank-icon-btn'); if(!btn) return;
  document.querySelectorAll('.bank-icon-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); selectedBank=btn.dataset.bank;
  const color=BANK_COLORS[selectedBank];
  if(color){
    selectedCardColor=color;
    document.querySelectorAll('#cc-color-picker .color-opt').forEach(o=>o.classList.remove('selected'));
  }
});

// ── OVERRIDE renderCards with bank icons ──────────────────────────
renderCards = function() {
  populateCreditCardSelects();
  document.getElementById('cards-grid').style.display='';
  document.getElementById('invoice-panel').style.display='none';
  const grid=document.getElementById('cards-grid');
  if(!creditCards.length){grid.innerHTML='<div class="empty-state" style="grid-column:1/-1">Nenhum cartão cadastrado.</div>';return;}
  grid.innerHTML=creditCards.map(card=>{
    const used=getCardUsed(card.id);
    const available=card.limit-used;
    const pct=Math.min(Math.round(used/card.limit*100),100);
    const curKey=getCardCurrentInvoiceKey(card);
    const curTotal=getCardInvoiceTotal(card.id,curKey);
    const dueDate=getInvoiceDueDate(card,curKey);
    const dueFmt=new Date(dueDate+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const barColor=pct>=90?'#ef4444':pct>=70?'#f59e0b':'rgba(255,255,255,.85)';
    const bankIcon=BANK_ICONS[card.bank||'generic']||'💳';
    const cardColor=card.color||BANK_COLORS[card.bank||'generic']||'#6b21a8';
    return `<div class="cc-card" style="background:linear-gradient(135deg,${cardColor}dd,${cardColor}88)">
      <div class="cc-card-bg"></div>
      <div class="cc-card-top">
        <div>
          <div style="font-size:24px;margin-bottom:4px;line-height:1">${bankIcon}</div>
          <div class="cc-card-name">${card.name}</div>
          <div class="cc-card-type">Cartão de Crédito</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="cc-btn" onclick="editCard(${card.id})">✎</button>
          <button class="cc-btn" onclick="deleteCard(${card.id})">✕</button>
        </div>
      </div>
      <div class="cc-card-mid">
        <div class="cc-chip"></div>
        <div class="cc-card-limit-used">${fmt(used)}</div>
        <div class="cc-card-limit-total">de ${fmt(card.limit)} · Fatura atual: ${fmt(curTotal)}</div>
      </div>
      <div class="cc-card-bottom">
        <div class="cc-limit-bar-bg"><div class="cc-limit-bar" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="cc-card-info">
          <span>${pct}% · ${fmt(available)} disponível</span>
          <span>Vence ${dueFmt} · Fecha dia ${card.closingDay}</span>
        </div>
        <div class="cc-card-actions">
          <button class="cc-btn" onclick="openInvoicePanel(${card.id})">Ver Faturas</button>
          ${curTotal>0?`<button class="cc-btn pay" onclick="openPayInvoice(${card.id},'${curKey}')">Pagar</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
};

// ── SAVE BANK IN CARD FORM ────────────────────────────────────────
// Patch editCard to also restore bank icon
const _baseEditCard = window.editCard;
window.editCard = id => {
  _baseEditCard(id);
  const c=creditCards.find(x=>x.id===id); if(!c) return;
  selectedBank=c.bank||'generic';
  document.querySelectorAll('.bank-icon-btn').forEach(b=>b.classList.toggle('active',b.dataset.bank===selectedBank));
};

// Override card form submit to include bank
document.getElementById('card-form')?.addEventListener('submit', e => {
  // Find the card that was just saved and add the bank
  setTimeout(() => {
    const lastCard = creditCards[creditCards.length - 1];
    if (lastCard && !lastCard.bank) {
      lastCard.bank = selectedBank;
      saveCards();
    }
    // Also update if editing
    if (editingCardId) {
      const c = creditCards.find(x=>x.id===editingCardId);
      if (c) { c.bank = selectedBank; saveCards(); }
    }
  }, 50);
});

// ── INIT ──────────────────────────────────────────────────────────
renderDashboard();
renderScheduled();
renderBudget();
