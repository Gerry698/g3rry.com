// Admin page. Visitor text is only ever written with textContent; the page's CSP also enforces Trusted Types.
const list = document.querySelector('#entries');
const status = document.querySelector('#status');
const more = document.querySelector('#more');
const toggle = document.querySelector('#toggle-open');
const banner = document.querySelector('#closed-banner');
const viewNote = document.querySelector('#view-note');
const bulk = document.querySelector('#bulk');
const spamAll = document.querySelector('#spam-all');
const template = document.querySelector('#entry-template');
const tabs = [...document.querySelectorAll('.tabs [data-view]')];
const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const flagNames = { link: '含链接', 'many-links': '多个链接', repeat: '大量重复字符', duplicate: '与其他留言重复' };
const stateNames = { pending: '待审', approved: '已发布', rejected: '已隐藏', spam: '垃圾' };
// Buttons each view offers; "reject" on a published note takes it down again.
const actionsFor = {
  pending: ['approve', 'reject', 'spam', 'spam-ban', 'delete'],
  approved: ['reject', 'delete'],
  hidden: ['approve', 'delete']
};
const state = { view: 'pending', next: null, open: null, busy: false };

class SessionError extends Error {}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined
      ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch {
    // An expired Access session redirects to the login domain, which fetch cannot follow across origins.
    throw new SessionError();
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) throw new SessionError();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? String(response.status));
  return data;
}

function report(error) {
  if (error instanceof SessionError) {
    status.textContent = '登录已过期或网络中断。刷新页面重新登录。';
  } else {
    status.textContent = '操作失败：' + error.message;
  }
}

async function loadSummary() {
  const summary = await api('/api/summary');
  document.querySelector('#user').textContent = summary.user;
  for (const [view, count] of Object.entries(summary.counts)) document.querySelector('[data-count="' + view + '"]').textContent = String(count);
  state.open = summary.open;
  toggle.textContent = summary.open ? '关闭投稿' : '重新开放投稿';
  toggle.disabled = false;
  banner.hidden = summary.open;
}

function render(entry) {
  const item = template.content.firstElementChild.cloneNode(true);
  item.dataset.id = entry.id;
  const when = item.querySelector('time');
  when.dateTime = new Date(entry.date).toISOString();
  when.textContent = time.format(entry.date);
  item.querySelector('.state').textContent = stateNames[entry.status];
  const where = [entry.country, entry.ip ? 'IP ' + entry.ip + '… 共 ' + entry.ipCount + ' 条' : '', entry.banned ? '已封禁' : ''].filter(Boolean);
  item.querySelector('.where').textContent = where.join(' · ');
  item.querySelector('.flags').textContent = entry.flags.map(flag => flagNames[flag] ?? flag).join(' · ');
  item.querySelector('.name').textContent = entry.name;
  item.querySelector('.message').textContent = entry.message;
  if (entry.reply) {
    item.querySelector('.reply').hidden = false;
    item.querySelector('.reply-text').textContent = entry.reply.message;
    item.querySelector('textarea').value = entry.reply.message;
  }
  // Replies are shown only on published notes.
  if (entry.status !== 'approved') item.querySelector('.reply-editor').remove();
  const allowed = actionsFor[state.view];
  item.querySelectorAll('.actions [data-action]').forEach(button => {
    if (!allowed.includes(button.dataset.action)) button.remove();
    else if (button.dataset.action === 'approve' && state.view === 'hidden') button.textContent = '恢复并发布';
    else if (button.dataset.action === 'reject' && state.view === 'approved') button.textContent = '撤下';
  });
  return item;
}

async function loadEntries(append) {
  state.busy = true;
  more.disabled = true;
  if (!append) {
    list.replaceChildren();
    state.next = null;
  }
  status.textContent = '读取中…';
  bulk.hidden = state.view !== 'pending';
  viewNote.hidden = state.view !== 'hidden';
  viewNote.textContent = '隐藏和垃圾留言会在处理 30 天后自动永久删除；在此之前可以恢复。';
  try {
    const query = '?view=' + state.view + (append && state.next ? '&cursor=' + encodeURIComponent(state.next) : '');
    const data = await api('/api/entries' + query);
    list.append(...data.entries.map(render));
    state.next = data.next;
    spamAll.disabled = state.view === 'pending' && !list.children.length;
    status.textContent = list.children.length ? '' : '这里没有留言。';
  } catch (error) {
    report(error);
  } finally {
    state.busy = false;
    more.disabled = false;
    more.hidden = !state.next;
  }
}

async function act(item, action) {
  const id = item.dataset.id;
  const name = item.querySelector('.name').textContent;
  if (action === 'delete' && !confirm('永久删除「' + name + '」的留言？删除后只能从数据库备份恢复。')) return;
  if (action === 'spam-ban' && !confirm('标为垃圾，并在 30 天内静默丢弃同一网络地址的新留言？')) return;
  const buttons = item.querySelectorAll('button');
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (action === 'reply' || action === 'remove-reply') {
      const draft = action === 'reply' ? item.querySelector('textarea').value : '';
      const { reply } = await api('/api/entries/' + id + '/reply', { reply: draft });
      item.querySelector('.reply').hidden = !reply;
      item.querySelector('.reply-text').textContent = reply;
      item.querySelector('textarea').value = reply;
      status.textContent = reply ? '回复已保存。' : '回复已删除。';
    } else {
      const path = action === 'spam-ban' ? 'spam' : action;
      const result = await api('/api/entries/' + id + '/' + path, action === 'spam-ban' ? { ban: true } : {});
      item.remove();
      status.textContent = action === 'spam-ban' && !result.banned
        ? '已标为垃圾。这条留言超过 30 天，网络地址记录已删除，无法封禁。'
        : { approve: '已发布。', reject: '已隐藏。', spam: '已标为垃圾。', 'spam-ban': '已标为垃圾并封禁。', delete: '已删除。' }[action];
      await loadSummary();
    }
  } catch (error) {
    report(error);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) act(button.closest('.entry'), button.dataset.action);
});

tabs.forEach(tab => tab.addEventListener('click', () => {
  if (state.busy || tab.dataset.view === state.view) return;
  state.view = tab.dataset.view;
  tabs.forEach(other => other.setAttribute('aria-pressed', String(other === tab)));
  loadEntries(false);
}));

more.addEventListener('click', () => { if (!state.busy) loadEntries(true); });

spamAll.addEventListener('click', async () => {
  if (!confirm('把所有待审留言都标为垃圾？用于应对垃圾潮；30 天内可以在“已隐藏”里逐条恢复。')) return;
  spamAll.disabled = true;
  try {
    const { count } = await api('/api/pending/spam', {});
    await loadSummary();
    await loadEntries(false);
    status.textContent = '已把 ' + count + ' 条待审留言标为垃圾。';
  } catch (error) {
    report(error);
    spamAll.disabled = false;
  }
});

toggle.addEventListener('click', async () => {
  if (state.open && !confirm('关闭投稿后访客无法提交新留言，已有留言照常显示。确定关闭？')) return;
  toggle.disabled = true;
  try {
    await api('/api/settings', { open: !state.open });
    await loadSummary();
  } catch (error) {
    report(error);
    toggle.disabled = false;
  }
});

loadSummary().catch(report);
loadEntries(false);
