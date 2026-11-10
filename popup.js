const listEl = document.getElementById("list");
const hostEl = document.getElementById("host");
let host = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render() {
  const { hidden = {} } = await chrome.storage.local.get("hidden");
  const items = hidden[host] || [];
  hostEl.textContent = `${host} · 숨긴 항목 ${items.length}개`;
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = '<li class="empty">숨긴 항목이 없습니다.</li>';
    return;
  }
  for (const item of items.slice().reverse()) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = item.title || item.key;
    span.title = item.key;
    const btn = document.createElement("button");
    btn.textContent = "복원";
    btn.onclick = async () => {
      const { hidden = {} } = await chrome.storage.local.get("hidden");
      hidden[host] = (hidden[host] || []).filter((h) => h.id !== item.id);
      await chrome.storage.local.set({ hidden });
      render();
    };
    li.append(span, btn);
    listEl.append(li);
  }
}

document.getElementById("smash").onclick = async () => {
  const tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-smash" });
    window.close();
  } catch {
    hostEl.textContent = "이 페이지에서는 사용할 수 없습니다. 새로고침 후 다시 시도하세요.";
  }
};

(async () => {
  const tab = await activeTab();
  try {
    host = new URL(tab.url).hostname;
  } catch {
    host = null;
  }
  if (host) render();
})();
