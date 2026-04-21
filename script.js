(() => {
  const KEYS = {
    leads: 'leads',
    tarefas: 'tarefas',
    origens: 'origens',
    loggedIn: 'crmLoggedIn',
    user: 'crmUser',
  };

  const DEFAULT_ORIGENS = ['WhatsApp', 'Ligação', 'E-mail'];
  const PAGE = document.body?.dataset?.page;

  init();

  function init() {
    seedData();
    if (PAGE !== 'login') {
      if (!isLogged()) return redirect('index.html');
      renderSidebar();
    }
    if (PAGE === 'login' && isLogged()) return redirect('dashboard.html');

    const handlers = {
      login: setupLogin,
      dashboard: setupDashboard,
      cadastro: setupCadastro,
      leads: setupLeads,
      origens: setupOrigens,
      tarefas: setupTarefas,
    };
    handlers[PAGE]?.();
  }

  function setupLogin() {
    const form = byId('loginForm');
    const error = byId('loginError');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = String(byId('username').value || '').trim();
      const password = String(byId('password').value || '').trim();
      if (!((username === 'admin' || username === 'sdr') && password === '123')) {
        error.textContent = 'Credenciais inválidas.';
        return;
      }
      sessionStorage.setItem(KEYS.loggedIn, 'true');
      sessionStorage.setItem(KEYS.user, username);
      redirect('dashboard.html');
    });
  }

  function setupDashboard() {
    const leads = getLeads();
    const tarefas = getTarefasAtualizadas();

    const porClassificacao = countBy(leads, 'classificacao');
    const porOrigem = countBy(leads, 'origem');
    const pendentes = tarefas.filter((t) => t.status === 'pendente').length;
    const concluidas = tarefas.filter((t) => t.status === 'concluída').length;
    const atrasadas = tarefas.filter((t) => t.status === 'atrasada').length;

    byId('kpiGrid').innerHTML = [
      cardKpi('Total de leads', leads.length),
      cardKpi('Leads frios', porClassificacao.Frio || 0),
      cardKpi('Leads mornos', porClassificacao.Morno || 0),
      cardKpi('Leads quentes', porClassificacao.Quente || 0),
      cardKpi('Tarefas pendentes', pendentes),
      cardKpi('Tarefas concluídas', concluidas),
      cardKpi('Tarefas atrasadas', atrasadas),
    ].join('');

    renderStats('classificacaoChart', porClassificacao);
    renderStats('origemChart', porOrigem);

    const quentes = leads
      .filter((l) => l.classificacao === 'Quente')
      .sort((a, b) => new Date(a.vendedor?.agendamentoISO || Infinity) - new Date(b.vendedor?.agendamentoISO || Infinity))
      .slice(0, 6);
    renderList(
      'proximosQuentes',
      quentes.map((l) => `${l.nome} • ${l.vendedor?.agendamento || 'Não informado'}`),
    );

    const proximas = tarefas
      .sort((a, b) => new Date(`${a.data}T${a.hora}`) - new Date(`${b.data}T${b.hora}`))
      .slice(0, 6);
    renderList('proximasTarefas', proximas.map((t) => `${t.titulo} • ${t.leadNome} • ${toDateTime(t.data, t.hora)}`));
  }

  function setupCadastro() {
    const form = byId('leadForm');
    const origem = byId('origem');
    const classificacao = byId('classificacao');
    const vendedorBox = byId('vendedorBox');
    const cnpj = byId('cnpj');
    const title = byId('leadFormTitle');

    fillOrigensSelect(origem);
    cnpj?.addEventListener('input', () => (cnpj.value = maskCnpj(cnpj.value)));
    classificacao?.addEventListener('change', () => toggleVendedor());

    const editId = new URLSearchParams(location.search).get('id');
    if (editId) {
      const lead = getLeads().find((l) => l.id === editId);
      if (lead) {
        title.textContent = 'Editar Lead';
        fillLeadForm(lead);
      }
    }
    toggleVendedor();

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const error = byId('leadFormError');
      error.textContent = '';
      const now = new Date();
      const fd = new FormData(form);
      const lead = {
        id: String(fd.get('leadId') || '') || uid(),
        nome: val(fd, 'nome'),
        empresa: val(fd, 'empresa'),
        email: val(fd, 'email'),
        telefone: val(fd, 'telefone'),
        cnpj: maskCnpj(val(fd, 'cnpj')),
        origem: val(fd, 'origem'),
        classificacao: val(fd, 'classificacao'),
        observacao: val(fd, 'observacao'),
        createdAtISO: now.toISOString(),
        createdAtFormatted: formatDate(now.toISOString()),
      };

      if (!lead.nome || !lead.empresa || !lead.email || !lead.telefone || !lead.cnpj || !lead.origem || !lead.classificacao) {
        error.textContent = 'Preencha todos os campos obrigatórios.';
        return;
      }

      if (lead.classificacao === 'Quente') {
        const data = val(fd, 'agendamentoData');
        const hora = val(fd, 'agendamentoHora');
        lead.vendedor = {
          nome: val(fd, 'vendedorNome'),
          agendamento: data && hora ? toDateTime(data, hora) : 'Não informado',
          agendamentoISO: data && hora ? new Date(`${data}T${hora}`).toISOString() : null,
          status: val(fd, 'vendedorStatus') || 'Não informado',
        };
        if (!lead.vendedor.nome || !data || !hora || !val(fd, 'vendedorStatus')) {
          error.textContent = 'Preencha os dados do vendedor para lead quente.';
          return;
        }
      }

      const leads = getLeads();
      const idx = leads.findIndex((l) => l.id === lead.id);
      if (idx >= 0) {
        lead.createdAtISO = leads[idx].createdAtISO;
        lead.createdAtFormatted = leads[idx].createdAtFormatted;
        leads[idx] = lead;
      } else {
        leads.push(lead);
      }
      setLeads(leads);

      if (val(fd, 'tarefaTitulo')) {
        const tarefas = getTarefas();
        const d = val(fd, 'tarefaData');
        const h = val(fd, 'tarefaHora');
        tarefas.push({
          id: uid(),
          titulo: val(fd, 'tarefaTitulo'),
          descricao: val(fd, 'tarefaDescricao') || 'Não informado',
          leadId: lead.id,
          leadNome: lead.nome,
          responsavel: val(fd, 'tarefaResponsavel') || getUser(),
          data: d || now.toISOString().slice(0, 10),
          hora: h || now.toTimeString().slice(0, 5),
          status: 'pendente',
          createdAtISO: now.toISOString(),
          createdAtFormatted: formatDate(now.toISOString()),
        });
        setTarefas(tarefas);
      }

      redirect('leads.html');
    });

    function toggleVendedor() {
      const quente = classificacao.value === 'Quente';
      vendedorBox.classList.toggle('hidden', !quente);
    }

    function fillLeadForm(lead) {
      byId('leadId').value = lead.id;
      byId('nome').value = lead.nome || '';
      byId('empresa').value = lead.empresa || '';
      byId('email').value = lead.email || '';
      byId('telefone').value = lead.telefone || '';
      byId('cnpj').value = lead.cnpj || '';
      byId('origem').value = lead.origem || '';
      byId('classificacao').value = lead.classificacao || '';
      byId('observacao').value = lead.observacao || '';
      if (lead.vendedor) {
        byId('vendedorNome').value = lead.vendedor.nome || '';
        byId('vendedorStatus').value = lead.vendedor.status || '';
        const dt = lead.vendedor.agendamentoISO ? new Date(lead.vendedor.agendamentoISO) : null;
        if (dt) {
          byId('agendamentoData').value = dt.toISOString().slice(0, 10);
          byId('agendamentoHora').value = dt.toTimeString().slice(0, 5);
        }
      }
    }
  }

  function setupLeads() {
    const tbody = byId('leadsTbody');
    const filters = ['leadSearch', 'leadFiltroOrigem', 'leadFiltroClassificacao', 'leadFiltroResponsavel'];
    fillOrigensSelect(byId('leadFiltroOrigem'), true);

    filters.forEach((id) => byId(id)?.addEventListener('input', render));
    byId('exportLeadsCsv')?.addEventListener('click', () => exportCsv('leads.csv', leadsRows(getLeads()), leadsHeaders()));
    byId('exportLeadsPdf')?.addEventListener('click', () => exportPdf('Leads', leadsHeaders(), leadsRows(getLeads())));

    tbody?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.edit) redirect(`cadastro.html?id=${t.dataset.edit}`);
      if (t.dataset.del && confirm('Excluir lead?')) {
        setLeads(getLeads().filter((l) => l.id !== t.dataset.del));
        setTarefas(getTarefas().filter((task) => task.leadId !== t.dataset.del));
        render();
      }
    });

    render();

    function render() {
      const search = byId('leadSearch').value.toLowerCase();
      const origem = byId('leadFiltroOrigem').value;
      const classe = byId('leadFiltroClassificacao').value;
      const resp = byId('leadFiltroResponsavel').value.toLowerCase();
      const list = getLeads().filter((l) => {
        const blob = `${l.nome} ${l.empresa} ${l.email} ${l.telefone}`.toLowerCase();
        return (!search || blob.includes(search)) && (!origem || l.origem === origem) && (!classe || l.classificacao === classe) && (!resp || (l.vendedor?.nome || '').toLowerCase().includes(resp));
      });
      tbody.innerHTML = list.length
        ? list
            .map(
              (l) => `<tr>
            <td>${esc(l.nome)}</td><td>${esc(l.empresa)}</td><td>${esc(l.origem)}</td>
            <td><span class="badge badge-${l.classificacao.toLowerCase()}">${esc(l.classificacao)}</span></td>
            <td>${esc(l.email)}<br>${esc(l.telefone)}</td>
            <td>${esc(l.createdAtFormatted || 'Não informado')}</td>
            <td><div class="actions-row"><button data-edit="${l.id}" class="btn-secondary" type="button">Editar</button><button data-del="${l.id}" class="btn-primary" type="button">Excluir</button></div></td>
          </tr>`,
            )
            .join('')
        : '<tr><td colspan="7">Nenhum lead encontrado.</td></tr>';
    }
  }

  function setupOrigens() {
    const form = byId('origemForm');
    const nome = byId('origemNome');
    const id = byId('origemId');
    const lista = byId('origensLista');
    const error = byId('origemError');
    const cancel = byId('cancelarEdicaoOrigem');

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      error.textContent = '';
      const n = nome.value.trim();
      if (!n) return (error.textContent = 'Origem não pode ser vazia.');
      const origens = getOrigens();
      if (origens.some((o) => o.toLowerCase() === n.toLowerCase() && o !== id.dataset.original)) {
        error.textContent = 'Origem duplicada.';
        return;
      }
      if (id.value) {
        const idx = origens.findIndex((o) => o === id.dataset.original);
        if (idx >= 0) origens[idx] = n;
      } else origens.push(n);
      setOrigens(origens);
      reset();
      render();
    });

    lista?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const edit = t.dataset.edit;
      const del = t.dataset.del;
      const origens = getOrigens();
      if (edit) {
        id.value = edit;
        id.dataset.original = edit;
        nome.value = edit;
        cancel.classList.remove('hidden');
      }
      if (del && confirm(`Excluir origem "${del}"?`)) {
        setOrigens(origens.filter((o) => o !== del));
        render();
      }
    });

    cancel?.addEventListener('click', reset);
    render();

    function reset() {
      form.reset();
      id.value = '';
      id.dataset.original = '';
      cancel.classList.add('hidden');
      error.textContent = '';
    }

    function render() {
      lista.innerHTML = getOrigens()
        .map((o) => `<li><span>${esc(o)}</span><div class="actions-row"><button data-edit="${esc(o)}" class="btn-secondary" type="button">Editar</button><button data-del="${esc(o)}" class="btn-primary" type="button">Excluir</button></div></li>`)
        .join('');
    }
  }

  function setupTarefas() {
    const form = byId('tarefaForm');
    const tbody = byId('tarefasTbody');
    const leadSelect = byId('tarefaLeadForm');
    const error = byId('tarefaError');

    byId('novaTarefaBtn')?.addEventListener('click', () => {
      resetForm();
      form.classList.toggle('hidden');
    });
    byId('cancelarTarefa')?.addEventListener('click', () => form.classList.add('hidden'));

    ['filtroStatusTarefa', 'filtroResponsavelTarefa', 'filtroInicioTarefa', 'filtroFimTarefa'].forEach((id) =>
      byId(id)?.addEventListener('input', render),
    );

    byId('exportTarefasCsv')?.addEventListener('click', () => exportCsv('tarefas.csv', tarefasRows(getTarefasAtualizadas()), tarefasHeaders()));
    byId('exportTarefasPdf')?.addEventListener('click', () => exportPdf('Tarefas', tarefasHeaders(), tarefasRows(getTarefasAtualizadas())));

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      error.textContent = '';
      const now = new Date();
      const id = byId('tarefaId').value || uid();
      const leadId = byId('tarefaLeadForm').value;
      const lead = getLeads().find((l) => l.id === leadId);
      const task = {
        id,
        titulo: byId('tarefaTituloForm').value.trim(),
        descricao: byId('tarefaDescricaoForm').value.trim(),
        leadId,
        leadNome: lead?.nome || 'Não informado',
        responsavel: byId('tarefaRespForm').value.trim(),
        data: byId('tarefaDataForm').value,
        hora: byId('tarefaHoraForm').value,
        status: byId('tarefaStatusForm').value,
        createdAtISO: now.toISOString(),
        createdAtFormatted: formatDate(now.toISOString()),
      };
      if (!task.titulo || !task.descricao || !task.leadId || !task.responsavel || !task.data || !task.hora) {
        error.textContent = 'Preencha todos os campos obrigatórios da tarefa.';
        return;
      }
      const tarefas = getTarefas();
      const idx = tarefas.findIndex((t) => t.id === id);
      if (idx >= 0) {
        task.createdAtISO = tarefas[idx].createdAtISO;
        task.createdAtFormatted = tarefas[idx].createdAtFormatted;
        tarefas[idx] = task;
      } else tarefas.push(task);
      setTarefas(tarefas);
      form.classList.add('hidden');
      render();
    });

    tbody?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const edit = t.dataset.edit;
      const del = t.dataset.del;
      const done = t.dataset.done;
      const tarefas = getTarefas();
      if (edit) {
        const item = tarefas.find((x) => x.id === edit);
        if (!item) return;
        form.classList.remove('hidden');
        byId('tarefaId').value = item.id;
        byId('tarefaTituloForm').value = item.titulo;
        byId('tarefaDescricaoForm').value = item.descricao;
        byId('tarefaLeadForm').value = item.leadId;
        byId('tarefaRespForm').value = item.responsavel;
        byId('tarefaDataForm').value = item.data;
        byId('tarefaHoraForm').value = item.hora;
        byId('tarefaStatusForm').value = item.status;
      }
      if (del && confirm('Excluir tarefa?')) {
        setTarefas(tarefas.filter((x) => x.id !== del));
        render();
      }
      if (done) {
        const idx = tarefas.findIndex((x) => x.id === done);
        if (idx >= 0) tarefas[idx].status = 'concluída';
        setTarefas(tarefas);
        render();
      }
    });

    render();

    function render() {
      const leads = getLeads();
      leadSelect.innerHTML = '<option value="">Selecione</option>' + leads.map((l) => `<option value="${l.id}">${esc(l.nome)} - ${esc(l.empresa)}</option>`).join('');

      const st = byId('filtroStatusTarefa').value;
      const rp = byId('filtroResponsavelTarefa').value.toLowerCase();
      const di = byId('filtroInicioTarefa').value;
      const df = byId('filtroFimTarefa').value;
      const tarefas = getTarefasAtualizadas().filter((t) => {
        const d = t.data;
        return (!st || t.status === st) && (!rp || t.responsavel.toLowerCase().includes(rp)) && (!di || d >= di) && (!df || d <= df);
      });

      tbody.innerHTML = tarefas.length
        ? tarefas
            .map(
              (t) => `<tr>
              <td>${esc(t.titulo)}<br><small>${esc(t.descricao)}</small></td>
              <td>${esc(t.leadNome)}</td>
              <td>${esc(t.responsavel)}</td>
              <td>${toDateTime(t.data, t.hora)}</td>
              <td><span class="badge badge-${t.status}">${esc(t.status)}</span></td>
              <td>${esc(t.createdAtFormatted || 'Não informado')}</td>
              <td><div class="actions-row"><button data-edit="${t.id}" class="btn-secondary" type="button">Editar</button><button data-done="${t.id}" class="btn-secondary" type="button">Concluir</button><button data-del="${t.id}" class="btn-primary" type="button">Excluir</button></div></td>
            </tr>`,
            )
            .join('')
        : '<tr><td colspan="7">Nenhuma tarefa encontrada.</td></tr>';
    }

    function resetForm() {
      form.reset();
      byId('tarefaId').value = '';
      byId('tarefaStatusForm').value = 'pendente';
    }
  }

  function renderSidebar() {
    const user = getUser();
    byId('sidebar').innerHTML = `
      <div class="logo-wrap">
        <img src="assets/logo.png" alt="Voice Data" class="logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" />
        <span class="logo-fallback" style="display:none">Voice Data</span>
      </div>
      <div class="user-box"><strong>${esc(user)}</strong></div>
      <nav>
        ${navItem('dashboard.html', 'Dashboard', 'dashboard')}
        ${navItem('leads.html', 'Leads', 'leads')}
        ${navItem('cadastro.html', 'Cadastro', 'cadastro')}
        ${navItem('origens.html', 'Origens', 'origens')}
        ${navItem('tarefas.html', 'Tarefas', 'tarefas')}
      </nav>
      <button id="logoutBtn" class="btn-secondary" type="button">Sair</button>
    `;
    byId('logoutBtn')?.addEventListener('click', () => {
      sessionStorage.clear();
      redirect('index.html');
    });
  }

  function getTarefasAtualizadas() {
    const now = new Date();
    const tarefas = getTarefas();
    let changed = false;
    tarefas.forEach((t) => {
      if (t.status === 'pendente' && new Date(`${t.data}T${t.hora}`) < now) {
        t.status = 'atrasada';
        changed = true;
      }
    });
    if (changed) setTarefas(tarefas);
    return tarefas;
  }

  function exportPdf(title, headers, rows) {
    const lines = [title, `Gerado em: ${formatDate(new Date().toISOString())}`, '', headers.join(' | ')];
    rows.forEach((r) => lines.push(r.map((v) => v || 'Não informado').join(' | ')));
    const pdf = createPdfFromText(lines.join('\n'));
    downloadBlob(`${title.toLowerCase()}.pdf`, 'application/pdf', pdf);
  }

  function createPdfFromText(text) {
    const sanitized = text.replace(/[()\\]/g, '\\$&').split('\n');
    const content = sanitized.map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${line.slice(0, 120)}) Tj ET`).join('\n');
    const objects = [];
    const addObj = (str) => {
      objects.push(str);
      return objects.length;
    };
    const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const streamId = addObj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    const pagesId = addObj(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
    const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, idx) => {
      offsets.push(pdf.length);
      pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((off) => (pdf += `${String(off).padStart(10, '0')} 00000 n \n`));
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function exportCsv(filename, rows, headers) {
    const csv = [headers.join(';'), ...rows.map((r) => r.map((v) => `"${String(v || 'Não informado').replaceAll('"', '""')}"`).join(';'))].join('\n');
    downloadBlob(filename, 'text/csv;charset=utf-8;', new Blob([csv]));
  }

  function leadsHeaders() { return ['Nome', 'Empresa', 'E-mail', 'Telefone', 'CNPJ', 'Origem', 'Classificação', 'Observação', 'Cadastro']; }
  function tarefasHeaders() { return ['Título', 'Descrição', 'Lead', 'Responsável', 'Data/Hora', 'Status', 'Cadastro']; }
  function leadsRows(leads) {
    return leads.map((l) => [l.nome, l.empresa, l.email, l.telefone, l.cnpj, l.origem, l.classificacao, l.observacao || 'Não informado', l.createdAtFormatted || 'Não informado']);
  }
  function tarefasRows(tarefas) {
    return tarefas.map((t) => [t.titulo, t.descricao, t.leadNome, t.responsavel, toDateTime(t.data, t.hora), t.status, t.createdAtFormatted || 'Não informado']);
  }

  function fillOrigensSelect(select, keepAll = false) {
    const options = getOrigens().map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    select.innerHTML = `${keepAll ? '<option value="">Todas origens</option>' : '<option value="">Selecione</option>'}${options}`;
  }

  function renderStats(id, data) {
    const el = byId(id);
    const entries = Object.entries(data);
    el.innerHTML = entries.length ? entries.map(([k, v]) => `<div class="stat-row"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('') : '<p>Sem dados.</p>';
  }

  function renderList(id, values) {
    byId(id).innerHTML = values.length ? values.map((v) => `<li>${esc(v)}</li>`).join('') : '<li>Sem dados.</li>';
  }

  function navItem(href, label, page) { return `<a class="nav-link ${PAGE === page ? 'active' : ''}" href="${href}">${label}</a>`; }
  function cardKpi(label, value) { return `<article class="kpi"><p>${label}</p><strong>${value}</strong></article>`; }
  function countBy(arr, key) { return arr.reduce((a, x) => ((a[x[key] || 'Não informado'] = (a[x[key] || 'Não informado'] || 0) + 1), a), {}); }
  function toDateTime(date, time) {
    if (!date || !time) return 'Não informado';
    const dt = new Date(`${date}T${time}`);
    return Number.isNaN(dt.getTime()) ? 'Não informado' : formatDate(dt.toISOString());
  }
  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Não informado';
    const p = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    const h = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return `${p} ${h}`;
  }
  function maskCnpj(value) {
    const d = value.replace(/\D/g, '').slice(0, 14);
    return d
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  function seedData() {
    if (!localStorage.getItem(KEYS.origens)) localStorage.setItem(KEYS.origens, JSON.stringify(DEFAULT_ORIGENS));
    if (!localStorage.getItem(KEYS.leads)) localStorage.setItem(KEYS.leads, '[]');
    if (!localStorage.getItem(KEYS.tarefas)) localStorage.setItem(KEYS.tarefas, '[]');
  }

  function byId(id) { return document.getElementById(id); }
  function val(fd, key) { return String(fd.get(key) || '').trim(); }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function esc(v) { return String(v || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
  function isLogged() { return sessionStorage.getItem(KEYS.loggedIn) === 'true' && !!sessionStorage.getItem(KEYS.user); }
  function getUser() { return sessionStorage.getItem(KEYS.user) || 'Usuário'; }
  function redirect(url) { window.location.href = url; }
  function downloadBlob(name, type, blob) {
    const b = blob instanceof Blob ? blob : new Blob([blob], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
  function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
  function getLeads() { return readJson(KEYS.leads, []); }
  function setLeads(v) { localStorage.setItem(KEYS.leads, JSON.stringify(v)); }
  function getTarefas() { return readJson(KEYS.tarefas, []); }
  function setTarefas(v) { localStorage.setItem(KEYS.tarefas, JSON.stringify(v)); }
  function getOrigens() { return readJson(KEYS.origens, DEFAULT_ORIGENS); }
  function setOrigens(v) { localStorage.setItem(KEYS.origens, JSON.stringify(v)); }
})();