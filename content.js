(() => {
  const HOST = location.hostname;
  const ID_PARAM = /^\d+$/;

  // storage 구조
  // hidden: { [host]: [{ id(uuid), key, title, at }] }
  // rules:  { [host]: containerSelector }
  let hiddenKeys = new Set();
  let selector = null;
  let smashMode = false;
  let hoverEl = null;
  let banner = null;

  // ---------- 키 추출 ----------
  // 사이트 자체 ID를 키로 쓴다: pathname + 값이 숫자인 쿼리 파라미터만.
  function keyFromHref(href) {
    try {
      const u = new URL(href, location.href);
      if (u.hostname !== HOST) return null;
      if (!u.pathname || u.pathname === "/") {
        if (![...u.searchParams.values()].some((v) => ID_PARAM.test(v))) return null;
      }
      const ids = [...u.searchParams.entries()]
        .filter(([, v]) => ID_PARAM.test(v))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      const hasIdInPath = /\d/.test(u.pathname);
      if (!hasIdInPath && !ids) return null;
      return u.pathname + (ids ? `?${ids}` : "");
    } catch {
      return null;
    }
  }

  function keysOf(container) {
    const keys = [];
    container.querySelectorAll("a[href]").forEach((a) => {
      const k = keyFromHref(a.getAttribute("href"));
      if (k) keys.push(k);
    });
    return keys;
  }

  // 이 카드에만 있는 링크(= 공고 링크)를 키로 고른다.
  // 같은 목록의 다른 카드에도 있는 링크(회사 링크 등)는 제외해서
  // 같은 회사의 다른 공고가 같이 숨겨지는 것을 막는다.
  function pickKey(container) {
    const parent = container.parentElement;
    const others = new Set();
    if (parent) {
      [...parent.children]
        .filter((c) => c !== container && c.tagName === container.tagName)
        .forEach((c) => keysOf(c).forEach((k) => others.add(k)));
    }
    let best = null;
    let bestLen = -1;
    container.querySelectorAll("a[href]").forEach((a) => {
      const k = keyFromHref(a.getAttribute("href"));
      if (!k || others.has(k)) return;
      const len = (a.innerText || "").trim().length;
      if (len > bestLen) {
        best = k;
        bestLen = len;
      }
    });
    return best;
  }

  // ---------- 컨테이너 탐색 ----------
  // 클릭한 요소에서 위로 올라가며 "같은 모양 형제가 3개 이상인" 첫 요소를 항목으로 본다.
  function findContainer(el) {
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      const parent = cur.parentElement;
      if (!parent) break;
      const siblings = [...parent.children].filter((c) => c.tagName === cur.tagName);
      if (siblings.length >= 3 && cur.querySelector("a[href]") && keysOf(cur).length) {
        return cur;
      }
    }
    return null;
  }

  function selectorFor(el) {
    const classes = [...el.classList]
      .filter((c) => !c.startsWith("ps-") && !/\d/.test(c))
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    return el.tagName.toLowerCase() + classes;
  }

  function titleOf(el) {
    return (el.innerText || "").trim().split("\n").filter(Boolean).slice(0, 2).join(" · ").slice(0, 80);
  }

  // ---------- 숨김 적용 ----------
  function applyAll() {
    if (!selector) return;
    document.querySelectorAll(selector).forEach((el) => {
      const hide = keysOf(el).some((k) => hiddenKeys.has(k));
      el.classList.toggle("ps-hidden", hide);
    });
  }

  let timer = null;
  function scheduleApply() {
    clearTimeout(timer);
    timer = setTimeout(applyAll, 100);
  }

  async function load() {
    const { hidden = {}, rules = {} } = await chrome.storage.local.get(["hidden", "rules"]);
    hiddenKeys = new Set((hidden[HOST] || []).map((h) => h.key));
    selector = rules[HOST] || null;
    applyAll();
  }

  async function smash(container) {
    const key = pickKey(container);
    if (!key) return;
    const { hidden = {}, rules = {} } = await chrome.storage.local.get(["hidden", "rules"]);
    const list = hidden[HOST] || [];
    if (!list.some((h) => h.key === key)) {
      list.push({ id: crypto.randomUUID(), key, title: titleOf(container), at: Date.now() });
    }
    hidden[HOST] = list;
    rules[HOST] = selectorFor(container);
    await chrome.storage.local.set({ hidden, rules });
  }

  // ---------- Smash 모드 ----------
  function setHover(el) {
    if (hoverEl) hoverEl.classList.remove("ps-hover");
    hoverEl = el;
    if (hoverEl) hoverEl.classList.add("ps-hover");
  }

  function onMove(e) {
    setHover(findContainer(e.target));
  }

  function onClick(e) {
    const container = findContainer(e.target);
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();
    setHover(null);
    smash(container);
  }

  function onKey(e) {
    if (e.key === "Escape") setSmashMode(false);
  }

  function setSmashMode(on) {
    smashMode = on;
    if (on) {
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      banner = document.createElement("div");
      banner.className = "ps-banner";
      banner.textContent = "💥 Smash 모드 — 숨길 항목을 클릭 (Esc로 종료)";
      document.documentElement.appendChild(banner);
    } else {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      setHover(null);
      banner?.remove();
      banner = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "toggle-smash") setSmashMode(!smashMode);
    if (msg?.type === "get-state") return sendResponse({ smashMode });
    sendResponse({ smashMode });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.hidden || changes.rules)) load();
  });

  new MutationObserver(scheduleApply).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  load();
})();
