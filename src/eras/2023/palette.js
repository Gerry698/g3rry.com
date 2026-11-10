// ⌘K (Ctrl+K elsewhere): a command palette over every page, photograph and year.
// The search field is a combobox: the results are a listbox of options in labelled groups, and the option the
// arrow keys have reached is its active descendant, so the focus never leaves the field.
const dialog = document.querySelector('#palette');
const input = document.querySelector('#palette-input');
const list = document.querySelector('#palette-list');
let commands = [];
let options = [];
let selected = 0;

const load = async () => {
  if (commands.length) return;
  commands = await fetch('commands.json').then(response => response.json()).catch(() => []);
};

const mark = () => {
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
  const active = options[selected];
  if (active) { input.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
  else input.removeAttribute('aria-activedescendant');
};

const render = () => {
  const query = input.value.trim().toLowerCase();
  const matches = commands.filter(command => !query || command.title.toLowerCase().includes(query) || command.group.toLowerCase().includes(query)).slice(0, 40);
  selected = Math.min(selected, Math.max(0, matches.length - 1));
  list.replaceChildren();
  options = [];
  let group = null, members = null;
  matches.forEach((command, index) => {
    if (command.group !== group) {
      group = command.group;
      const wrap = document.createElement('li');
      wrap.setAttribute('role', 'none');
      const heading = document.createElement('p');
      heading.className = 'group';
      heading.id = 'palette-group-' + group.toLowerCase();
      heading.setAttribute('aria-hidden', 'true');
      heading.textContent = group;
      members = document.createElement('ul');
      members.setAttribute('role', 'group');
      members.setAttribute('aria-labelledby', heading.id);
      wrap.append(heading, members);
      list.append(wrap);
    }
    const item = document.createElement('li');
    item.setAttribute('role', 'none');
    const option = document.createElement('a');
    option.href = command.href;
    option.id = 'palette-option-' + index;
    option.tabIndex = -1;
    option.setAttribute('role', 'option');
    option.textContent = command.title;
    const hint = document.createElement('span');
    hint.textContent = command.href.startsWith('http') ? 'external' : command.href.startsWith('/') ? 'site' : '';
    option.append(hint);
    option.addEventListener('mousemove', () => { if (selected !== index) { selected = index; mark(); } });
    item.append(option);
    members.append(item);
    options.push(option);
  });
  if (!matches.length) {
    const empty = document.createElement('li');
    empty.setAttribute('role', 'none');
    empty.className = 'group';
    empty.textContent = 'No results';
    list.append(empty);
  }
  mark();
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
  if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(selected + 1, options.length - 1); mark(); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(selected - 1, 0); mark(); }
  else if (event.key === 'Enter' && options[selected]) { event.preventDefault(); location.href = options[selected].href; }
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
