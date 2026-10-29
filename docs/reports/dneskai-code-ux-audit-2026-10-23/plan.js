'use strict';
(() => {
  const data = window.AUDIT_DATA;
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const source = (path, line = 1) => `https://github.com/lukaskourilcz/own-dashboard/blob/${data.baseline}/${path}#L${line}`;
  const evidence = id => data.evidence.find(item => item.id === id);
  const pill = (text, tone='') => `<span class="pill ${tone}">${text}</span>`;
  const action = (text, ghost=false) => `<span class="proto-action${ghost?' ghost':''}">${text}</span>`;
  const row = (title, meta, end) => `<div class="proto-row"><div>${title}${meta?`<small>${meta}</small>`:''}</div>${end||''}</div>`;
  let selected = data.spots[0].id;
  let catalogView = 'destinations';
  let imageOpener = null;
  function prototype(id) {
    if (id === 'lab') return `<div class="proto-top"><strong>DNESKAi</strong>${pill('Instagram','blue')}${pill('Refresh')}</div><div class="proto-top"><strong>Topics</strong>${pill('6 waiting')}${pill('Open inbox →')}</div><div class="proto-editor"><div class="proto-box"><h4>Review queue</h4>${row('Today','Decisions & exceptions',pill('Review'))}${row('Tomorrow','Next scheduled posts','')}</div><div><figure class="proto-slide actual" style="margin:0"><img src="assets/existing-fixture-slide.png" alt="Current DNESKAi fixture render, captured in Chrome"><small>Current fixture render · screenshot crop</small></figure></div><div class="proto-box"><h4>Selected post</h4><div class="proto-field"><small>Headline</small>Editable content and live fit feedback</div><div class="proto-actions">${action('Save & render')}${action('Approve',true)}${pill('Unsaved changes guarded')}</div></div></div>`;
    if (id === 'sources') return `<div class="proto-top"><strong>Sources</strong>${pill('Daily mix')}${pill('Music')}</div><div class="proto-toolbar">${pill('Search sources…')}${pill('All types')}${pill('Status')}${action('Add source')}</div><div class="proto-box">${row('Source name','Kind · publisher',pill('Status','green'))}${row('Instagram profile','Last read · freshness',pill('Edit'))}${row('Website feed','Last read · freshness',pill('Edit'))}</div><p class="proto-subtle">Stable columns on desktop. Name and essential status stay together when narrow.</p>`;
    if (id === 'mix') return `<div class="proto-top"><strong>Sources</strong>${pill('Daily mix','blue')}${pill('Music')}</div><div class="proto-box proto-mix"><h4>Daily mix</h4><p class="proto-subtle">Choose counts and the active Prague times.</p><div class="proto-mix-controls"><div class="proto-field"><small>News / day</small>2 ▾</div><div class="proto-field"><small>Education / day</small>2 ▾</div><div class="proto-field proto-times"><small>Active times</small>08:00 · 12:30 · 17:00 · 20:00</div>${action('Save')}</div></div><p class="proto-subtle">Content-sized desktop row. At narrow widths, labelled groups wrap with 44 px hit areas.</p>`;
    if (id === 'work') return `<div class="proto-toolbar">${pill('Projects')}${pill('Follow-ups')}${pill('Invoices')}${pill('Clients')}</div><div class="proto-grid"><div class="proto-list"><div class="proto-box"><h4>Needs attention</h4>${row('DNESKAi','One actionable issue',pill('Review','blue'))}</div><div class="proto-box"><h4>Upcoming work</h4>${row('Next deadline','Date · project','')}${row('Recent delivery','Project · outcome','')}</div></div><div class="proto-box"><h4>Weekly planning</h4>${row('Time by channel','Keep the existing analysis','')}${row('Weekly review','Current step · next action','')}<div class="proto-actions">${action('Continue')}</div><p class="proto-subtle">This panel keeps its natural height. The attention card does not stretch beside it.</p></div></div>`;
    if (id === 'settings') return `<div class="proto-top"><strong>Settings</strong>${pill('Preferences','blue')}${pill('Projects')}${pill('Integrations')}</div><div class="proto-box proto-settings"><h4>Preferences</h4>${row('Language','',pill('Čeština')+pill('English','blue'))}${row('Appearance','',pill('Light','blue')+pill('Dark'))}${row('Currency','',pill('CZK ▾'))}${row('Task density','',pill('5 ▾'))}${row('Renewal warnings','Next renewal stays explicit',pill('On','green'))}</div><p class="proto-subtle">Centered bounded label/control grid; optional detail below each relevant setting.</p>`;
    if (id === 'finance') return `<div class="proto-top"><strong>Accounts</strong>${action('Add account')}</div><div class="proto-box"><h4>Account balances</h4>${row('Checking','CZK · account type',pill('Balance'))}${row('Savings','CZK · account type',pill('Balance'))}</div><div class="proto-box" style="margin-top:10px"><h4>Related actions</h4>${row('Import a statement','Open only when needed',pill('Import'))}${row('Money overview','Charts and cross-account analysis',pill('Open →'))}</div><p class="proto-subtle">Transactions opens its records; Categories opens its own management list.</p>`;
    if (id === 'mobile') return `<div class="proto-top"><strong>Settings</strong></div><div class="proto-box proto-settings"><h4>Preferences</h4>${row('Language','',pill('Čeština')+pill('English','blue'))}${row('Appearance','',pill('Light','blue')+pill('Dark'))}${row('Currency','',pill('CZK ▾'))}${row('Task density','',pill('5 ▾'))}</div><p class="proto-subtle">One title, useful section label, matching row controls and 44 px mobile hit areas.</p>`;
    return `<div class="proto-top"><strong>Tasks</strong>${action('Add task')}</div><div class="proto-toolbar">${action('Filters',true)}${pill('Active filters')}${pill('Clear all')}</div><div class="proto-box"><h4>Project tasks</h4>${row('Task title','Due date · owner · project',pill('Open'))}${row('Next task','Due date · owner · project',pill('Open'))}</div><p class="proto-subtle">Use a sheet for the existing filter groups on mobile. Keep inline filters on desktop.</p>`;
  }
  function renderSpot() {
    $('spot-nav').innerHTML = data.spots.map((spot,index) => `<button data-spot="${spot.id}" aria-pressed="${selected===spot.id}"><span class="nav-index">${String(index+1).padStart(2,'0')}</span><span>${escape(spot.area)}</span></button>`).join('');
    const spot = data.spots.find(s => s.id===selected), ev = evidence(spot.evidence);
    $('spot-detail').innerHTML = `<div class="detail-head"><span class="priority ${spot.priority.toLowerCase()}">${spot.priority}</span><div><h3>${escape(spot.title)}</h3><p>${spot.refs} · ${escape(spot.area)}</p></div></div><div class="comparison"><section class="evidence-panel" aria-label="Current UI"><div class="panel-label"><b>Current UI</b><button data-expand="${ev.id}">Enlarge ↗</button></div><div class="shot${ev.width<600?' phone':''}"><img src="${ev.image}" alt="Current ${escape(spot.area)} screen, ${ev.lang.toUpperCase()}, ${ev.theme}, ${ev.width} by ${ev.height} pixels"><div class="hotspots" aria-hidden="true">${spot.hotspots.map((h,i)=>`<div class="hotspot" style="left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%"><span>${i+1}</span></div>`).join('')}</div></div><ol class="hotspot-legend">${spot.hotspots.map((h,i)=>`<li><b>${i+1}</b> ${escape(h.label)}</li>`).join('')}</ol><div class="panel-body"><p>${escape(spot.problem)}</p></div></section><section class="proposal-panel" aria-label="Proposed layout"><div class="panel-label"><b>Proposed layout</b><div class="proposal-controls" role="group" aria-label="Proposed layout width"><button data-width="wide" aria-pressed="true">Desktop</button><button data-width="narrow" aria-pressed="false">Narrow</button></div></div><div class="prototype-wrap"><div class="prototype" id="prototype" aria-label="Illustrative component structure, not an implemented screen">${prototype(spot.id)}</div></div><div class="panel-body"><p>${escape(spot.proposal)}</p></div></section></div><ul class="criteria">${spot.criteria.map(c=>`<li>${escape(c)}</li>`).join('')}</ul><a class="source-link" href="${source(spot.path,spot.line)}">${escape(spot.path)}:${spot.line} ↗</a>`;
  }
  function renderCode() {
    $('code-list').innerHTML = data.code.map(item=>`<a class="code-row" href="code-review.html#${item.id.toLowerCase()}" aria-label="${item.id}: ${escape(item.title)}, ${item.priority}"><span class="code-id">${item.id}</span><span class="priority ${item.priority.toLowerCase()}">${item.priority}</span><strong class="code-title">${escape(item.title)}</strong><span class="code-proof">${escape(item.proof)}</span><span class="code-arrow" aria-hidden="true">↗</span></a>`).join('');
  }
  function renderCatalog() {
    const query = $('coverage-search').value.toLowerCase().trim();
    for(const view of ['destinations','components','evidence']) $(view+'-view').setAttribute('aria-pressed',String(catalogView===view));
    let items = catalogView==='destinations'?data.areas:catalogView==='components'?data.components:data.evidence;
    items = items.filter(item => JSON.stringify(item).toLowerCase().includes(query));
    $('catalog-count').textContent = `${items.length} ${catalogView==='destinations'?'destinations':catalogView==='components'?'source components':'captures'}${query?' match your search':''}`;
    $('catalog').innerHTML = items.length ? items.map(item=> {
      if (catalogView==='destinations') return `<article class="catalog-card"><h3>${escape(item.title)}</h3><p>${escape(item.change)}</p><div class="catalog-meta"><span>${escape(item.refs)}</span>${item.evidence?`<button data-expand="${item.evidence}">View current UI ↗</button>`:''}</div></article>`;
      if (catalogView==='components') return `<article class="catalog-card component-card"><h3><a href="${source(item.path)}">${escape(item.path)} ↗</a></h3><p>${escape(item.family)} · ${item.lines} lines<br>Source scan; visual evidence by family.</p><div class="catalog-meta"><span>${item.recommendations.join(' · ')}</span></div></article>`;
      return `<article class="catalog-card gallery-card"><button data-expand="${item.id}" aria-label="Enlarge ${escape(item.id)}"><img src="${item.image}" alt="${escape(item.id)} current UI capture" loading="lazy"></button><div class="gallery-info"><h3>${escape(item.id)}</h3><p>${item.width} × ${item.height} · ${item.lang.toUpperCase()} · ${item.theme} · <a href="${item.metrics}">Measurements ↗</a></p></div></article>`;
    }).join('') : '<p class="empty">No matches. Try a screen name, component path or recommendation ID.</p>';
  }
  function showEvidence(id, opener) {
    const ev = evidence(id); if (!ev) return;
    imageOpener = opener;
    $('image-title').textContent = 'Current UI · '+ev.id;
    $('expanded-image').src = ev.image;
    $('expanded-image').alt = `${ev.id}: authentic fixture screenshot`;
    $('image-caption').textContent = `${ev.width} × ${ev.height} px · ${ev.lang.toUpperCase()} · ${ev.theme} · Synthetic preview data. Development indicators may appear. This image is unchanged.`;
    $('image-dialog').showModal();
  }
  document.addEventListener('click',event=> {
    const spotButton = event.target.closest('[data-spot]');
    if(spotButton) { selected=spotButton.dataset.spot; renderSpot(); document.querySelector(`[data-spot="${selected}"]`).focus(); }
    const expand = event.target.closest('[data-expand]');
    if(expand) showEvidence(expand.dataset.expand,expand);
    const width = event.target.closest('[data-width]');
    if(width) { $('prototype').classList.toggle('narrow',width.dataset.width==='narrow'); document.querySelectorAll('[data-width]').forEach(b=>b.setAttribute('aria-pressed',String(b===width))); }
  });
  for(const view of ['destinations','components','evidence']) $(view+'-view').addEventListener('click',()=>{catalogView=view;renderCatalog();});
  $('coverage-search').addEventListener('input',renderCatalog);
  $('close-image').addEventListener('click',()=>$('image-dialog').close());
  $('image-dialog').addEventListener('close',()=>{ imageOpener?.focus(); });
  renderSpot();renderCode();renderCatalog();
})();
