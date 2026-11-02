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
const compose = document.querySelector('#compose');
const composeText = document.querySelector('#compose-text');
const composePin = document.querySelector('#compose-pin');
const composeSend = document.querySelector('#compose-send');
const tabs = [...document.querySelectorAll('.tabs [data-view]')];
const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const flagNames = { link: '含链接', 'many-links': '多个链接', repeat: '大量重复字符', duplicate: '与其他留言重复' };
const stateNames = { pending: '待审', approved: '已发布', rejected: '已隐藏', spam: '垃圾' };
const viewNotes = {
  approved: '按页面上的顺序显示：置顶在前，其余按时间。改动最多 1 分钟后出现在页面上。',
  hidden: '隐藏和垃圾留言会在处理 30 天后自动永久删除；在此之前可以恢复。'
};
const errorNames = {
  too_many_pinned: '最多置顶 3 条，先取消一条。',
  not_published: '只有已发布的留言可以置顶。',
  invalid_message: '内容不能为空，最多 1000 字。',
  invalid_reply: '回复最多 1000 字。',
  not_owner_note: '只能编辑自己的留言。'
};
// Buttons each view offers; "reject" on a published note takes it down again.
const actionsFor = {
  pending: ['approve', 'reject', 'spam', 'spam-ban', 'delete'],
  approved: ['pin', 'reject', 'delete'],
  hidden: ['approve', 'delete']
};
const state = { view: 'pending', next: null, open: null, busy: false, pinned: new Set() };

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
    status.textContent = '操作失败：' + (errorNames[error.message] ?? error.message);
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
  item.dataset.pinned = String(entry.pinned);
  item.classList.toggle('is-pinned', entry.pinned);
  const when = item.querySelector('time');
  when.dateTime = new Date(entry.date).toISOString();
  when.textContent = time.format(entry.date);
  item.querySelector('.state').textContent = [stateNames[entry.status], entry.owner && '站主', entry.pinned && '已置顶'].filter(Boolean).join(' · ');
  const where = [entry.country, entry.ip ? 'IP ' + entry.ip + '… 共 ' + entry.ipCount + ' 条' : '', entry.banned ? '已封禁' : ''].filter(Boolean);
  item.querySelector('.where').textContent = where.join(' · ');
  item.querySelector('.flags').textContent = entry.flags.map(flag => flagNames[flag] ?? flag).join(' · ');
  item.querySelector('.name').textContent = entry.name;
  item.querySelector('.message').textContent = entry.message;
  if (entry.reply) {
    item.querySelector('.reply').hidden = false;
    item.querySelector('.reply-text').textContent = entry.reply.message;
    item.querySelector('.reply-editor textarea').value = entry.reply.message;
    item.querySelector('.reply-editor summary').textContent = '编辑回复';
  }
  // Replies are shown only on published visitor notes; only the owner's own notes can be edited.
  if (entry.status !== 'approved' || entry.owner) item.querySelector('.reply-editor').remove();
  if (entry.owner) item.querySelector('.edit-editor textarea').value = entry.message;
  else item.querySelector('.edit-editor').remove();
  const allowed = actionsFor[state.view];
  item.querySelectorAll('.actions [data-action]').forEach(button => {
    if (!allowed.includes(button.dataset.action)) button.remove();
    else if (button.dataset.action === 'approve' && state.view === 'hidden') button.textContent = '恢复并发布';
    else if (button.dataset.action === 'reject' && state.view === 'approved') button.textContent = '撤下';
    else if (button.dataset.action === 'pin' && entry.pinned) button.textContent = '取消置顶';
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
  compose.hidden = state.view !== 'approved';
  viewNote.hidden = !viewNotes[state.view];
  viewNote.textContent = viewNotes[state.view] ?? '';
  try {
    const query = '?view=' + state.view + (append && state.next ? '&cursor=' + encodeURIComponent(state.next) : '');
    const data = await api('/api/entries' + query);
    if (!append) {
      state.pinned = new Set((data.pinned ?? []).map(entry => entry.id));
      list.append(...(data.pinned ?? []).map(render));
    }
    list.append(...data.entries.filter(entry => !state.pinned.has(entry.id)).map(render));
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
      const editor = item.querySelector('.reply-editor textarea');
      const { reply } = await api('/api/entries/' + id + '/reply', { reply: action === 'reply' ? editor.value : '' });
      item.querySelector('.reply').hidden = !reply;
      item.querySelector('.reply-text').textContent = reply;
      editor.value = reply;
      item.querySelector('.reply-editor summary').textContent = reply ? '编辑回复' : '写回复';
      status.textContent = reply ? '回复已保存。' : '回复已删除。';
    } else if (action === 'edit') {
      const editor = item.querySelector('.edit-editor textarea');
      const { message } = await api('/api/entries/' + id + '/edit', { message: editor.value });
      item.querySelector('.message').textContent = message;
      editor.value = message;
      item.querySelector('.edit-editor').open = false;
      status.textContent = '修改已保存。';
    } else if (action === 'pin') {
      const pinned = item.dataset.pinned !== 'true';
      await api('/api/entries/' + id + '/pin', { pinned });
      // Pinning changes the order, so the list is read again as the page will show it.
      await loadEntries(false);
      status.textContent = pinned ? '已置顶。' : '已取消置顶。';
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

composeSend.addEventListener('click', async () => {
  if (!composeText.value.trim()) {
    status.textContent = '先写点内容。';
    composeText.focus();
    return;
  }
  composeSend.disabled = true;
  try {
    await api('/api/notes', { message: composeText.value, pinned: composePin.checked });
    composeText.value = '';
    composePin.checked = false;
    await loadSummary();
    await loadEntries(false);
    status.textContent = '已发布，最多 1 分钟后出现在页面上。';
  } catch (error) {
    report(error);
  } finally {
    composeSend.disabled = false;
  }
});

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
