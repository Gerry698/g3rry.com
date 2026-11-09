// ⌘K (Ctrl+K elsewhere): a command palette over every page, photograph and year.
const dialog = document.querySelector('#palette');
const input = document.querySelector('#palette-input');
const list = document.querySelector('#palette-list');
let commands = [];
let selected = 0;

const load = async () => {
  if (commands.length) return;
  commands = await fetch('commands.json').then(response => response.json()).catch(() => []);
};

const render = () => {
  const query = input.value.trim().toLowerCase();
  const matches = commands.filter(command => !query || command.title.toLowerCase().includes(query) || command.group.toLowerCase().includes(query)).slice(0, 40);
  selected = Math.min(selected, Math.max(0, matches.length - 1));
  list.replaceChildren();
  let group = null;
  matches.forEach((command, index) => {
    if (command.group !== group) {
      group = command.group;
      const heading = document.createElement('li');
      heading.className = 'group';
      heading.textContent = group;
      list.append(heading);
    }
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = command.href;
    link.setAttribute('role', 'option');
    link.setAttribute('aria-selected', String(index === selected));
    link.textContent = command.title;
    const hint = document.createElement('span');
    hint.textContent = command.href.startsWith('http') ? 'external' : command.href.startsWith('/') ? 'site' : '';
    link.append(hint);
    link.addEventListener('mousemove', () => { if (selected !== index) { selected = index; render(); } });
    item.append(link);
    list.append(item);
  });
  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'group';
    empty.textContent = 'No results';
    list.append(empty);
  }
};

const open = async () => {
  await load();
  input.value = '';
  selected = 0;
  render();
  dialog.showModal();
  input.focus();
};

document.querySelector('#open-palette').addEventListener('click', open);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); dialog.open ? dialog.close() : open(); }
});
input.addEventListener('input', () => { selected = 0; render(); });
input.addEventListener('keydown', event => {
  const links = [...list.querySelectorAll('a')];
  if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(selected + 1, links.length - 1); render(); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(selected - 1, 0); render(); }
  else if (event.key === 'Enter' && links[selected]) { event.preventDefault(); location.href = links[selected].href; }
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
