(() => {
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const apiUrl = (window.WEDDING_CONFIG && window.WEDDING_CONFIG.apiUrl ? String(window.WEDDING_CONFIG.apiUrl).trim() : "");

  function setNotice(selector, message) {
    const el = qs(selector);
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearNotice(selector) {
    const el = qs(selector);
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function normalizeUrl(url) {
    return url ? String(url).trim() : "";
  }

  function showToast(message) {
    const existing = qs(".success-toast");
    if (existing) existing.remove();

    const msg = document.createElement("div");
    msg.className = "success-toast";
    msg.textContent = message;
    document.body.appendChild(msg);

    setTimeout(() => msg.classList.add("visible"), 10);
    setTimeout(() => {
      msg.classList.remove("visible");
      msg.classList.add("fade-out");
      setTimeout(() => msg.remove(), 1000);
    }, 6500);
  }

  function jsonp(url, callbackName) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      };

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };

      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + callbackName + "&_=" + Date.now();
      script.onerror = function () {
        cleanup();
        reject(new Error("Could not load data"));
      };
      document.body.appendChild(script);
    });
  }

  function postForm(url, data) {
    return fetch(url, {
      method: "POST",
      body: new URLSearchParams(data)
    }).then(async (response) => {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error("Backend did not return valid JSON: " + text.slice(0, 180));
      }
    });
  }

  function toNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeCategory(category) {
    const value = String(category || "").trim();
    return value || "Other";
  }

  function getTotalQuantity(item) {
    const explicit = toNumber(item.quantity, NaN);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return String(item.purchased).toLowerCase() === "true" ? 1 : 1;
  }

  function getPurchasedCount(item) {
    const explicit = toNumber(item.purchased_count, NaN);
    if (Number.isFinite(explicit) && explicit >= 0) return Math.min(explicit, getTotalQuantity(item));
    return String(item.purchased).toLowerCase() === "true" ? getTotalQuantity(item) : 0;
  }

  function getRemainingCount(item) {
    return Math.max(getTotalQuantity(item) - getPurchasedCount(item), 0);
  }

  function itemIsFullyPurchased(item) {
    return getRemainingCount(item) <= 0;
  }

  function sortRegistryItems(items) {
    return items.slice().sort((a, b) => {
      const pa = itemIsFullyPurchased(a) ? 1 : 0;
      const pb = itemIsFullyPurchased(b) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return Number(a.sort_order || 999999) - Number(b.sort_order || 999999);
    });
  }

  function buildRegistryFilters(items) {
    const filterBar = qs("#registryFilters");
    if (!filterBar) return;

    const categories = Array.from(new Set(items.map((item) => normalizeCategory(item.category)))).sort((a, b) => a.localeCompare(b));

    const buttons = [
      `<button type="button" class="filter-chip is-active" data-filter="all">All items <span>${items.length}</span></button>`
    ].concat(categories.map((category) => {
      const count = items.filter((item) => normalizeCategory(item.category) === category).length;
      return `<button type="button" class="filter-chip" data-filter="${escapeAttr(category)}">${escapeHtml(category)} <span>${count}</span></button>`;
    }));

    filterBar.innerHTML = buttons.join("");
    filterBar.classList.remove("hidden");
  }

  function statusMarkup(item) {
    const purchased = getPurchasedCount(item);
    const total = getTotalQuantity(item);
    const remaining = getRemainingCount(item);
    const soldOut = remaining <= 0;

    const summary = total > 1
      ? `${remaining} left · ${purchased} purchased of ${total}`
      : (soldOut ? "Purchased" : "Available");

    const badgeClass = soldOut ? "status-badge is-complete" : (purchased > 0 ? "status-badge is-partial" : "status-badge");
    const extra = item.purchased_by
      ? `<p class="small muted">Purchased by ${escapeHtml(String(item.purchased_by))}</p>`
      : "";

    return `
      <div class="registry-status-row">
        <span class="${badgeClass}">${escapeHtml(summary)}</span>
      </div>
      ${extra}
    `;
  }

  let registryItemsCache = [];

  function updateLocalRegistryItem(itemId, updates) {
    registryItemsCache = registryItemsCache.map((item) => {
      if (String(item.item_id || "") !== String(itemId || "")) return item;
      return { ...item, ...updates };
    });
  }

  function setRegistryButtonState(form, label, disabled) {
    const btn = form.querySelector("button");
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = !!disabled;
  }

  function renderRegistryItems(items) {
    const container = qs("#registryList");
    const filterBar = qs("#registryFilters");
    if (!container) return;

    if (!Array.isArray(items) || !items.length) {
      if (filterBar) filterBar.classList.add("hidden");
      container.innerHTML = '<div class="card"><p>No registry items yet. Add rows to the Registry sheet and refresh.</p></div>';
      return;
    }

    const sorted = sortRegistryItems(items);
    const activeFilter = (filterBar && filterBar.dataset.activeFilter) || "all";
    const visibleItems = activeFilter === "all"
      ? sorted
      : sorted.filter((item) => normalizeCategory(item.category) === activeFilter);

    if (filterBar) {
      filterBar.querySelectorAll(".filter-chip").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.filter === activeFilter);
      });
    }

    if (!visibleItems.length) {
      container.innerHTML = '<div class="card"><p>No items in this category yet.</p></div>';
      return;
    }

    container.innerHTML = visibleItems.map((item) => {
      const fullyPurchased = itemIsFullyPurchased(item);
      const buttonText = fullyPurchased ? "Fully purchased" : "Mark one as purchased";
      const description = item.description ? `<p>${escapeHtml(item.description)}</p>` : "";
      const store = item.store ? `<span class="pill">${escapeHtml(item.store)}</span>` : "";
      const category = item.category ? `<span class="pill">${escapeHtml(item.category)}</span>` : "";
      const image = item.image_url
        ? `<img class="registry-image"
            src="${escapeAttr(item.image_url)}"
            alt="${escapeAttr(item.item_name || "Registry item")}".`
        : "";
      const link = normalizeUrl(item.url)
        ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">View item</a>`
        : "";
      const disabled = fullyPurchased ? "disabled" : "";

      return `
        <article class="card registry-item ${fullyPurchased ? "is-purchased" : ""}">
          ${image}
          <div class="registry-top">
            <div>
              <h3>${escapeHtml(item.item_name || "Gift item")}</h3>
              ${description}
            </div>
            <div class="price-tag">$${escapeHtml(item.price || "")}</div>
          </div>
          <div class="registry-meta">${store}${category}</div>
          ${statusMarkup(item)}
          <div class="registry-actions">
            ${link}
            <form class="claim-form">
              <input type="hidden" name="itemId" value="${escapeAttr(item.item_id || "")}" />
              <div class="inline-fields">
                <label>
                  Your name
                  <input type="text" name="purchasedBy" ${disabled} required />
                </label>
                <label>
                  Note (optional)
                  <input type="text" name="purchaseNote" ${disabled} />
                </label>
              </div>
              <button type="submit" class="button" ${disabled}>${buttonText}</button>
            </form>
          </div>
        </article>
      `;
    }).join("");

    qsa(".claim-form").forEach((form) => {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitClaim(form);
      });
    });
  }

  function setupRegistryFilters(items) {
    const filterBar = qs("#registryFilters");
    if (!filterBar) return;

    buildRegistryFilters(items);
    filterBar.dataset.activeFilter = filterBar.dataset.activeFilter || "all";

    filterBar.querySelectorAll(".filter-chip").forEach((button) => {
      button.addEventListener("click", function () {
        filterBar.dataset.activeFilter = button.dataset.filter || "all";
        renderRegistryItems(registryItemsCache);
      });
    });
  }

  function setupRSVP() {
    const form = qs("#rsvpForm");
    if (!form) return;
    const success = qs("#rsvpSuccess");
    const frame = qs("#hiddenSubmitFrame");

    if (!apiUrl) {
      setNotice("#apiNotice", "Set your Google Apps Script URL in config.js to activate RSVP submissions.");
      return;
    }

    form.action = apiUrl;
    form.addEventListener("submit", function () {
      success.classList.add("hidden");
      setTimeout(() => {
        success.classList.remove("hidden");
        form.reset();
      }, 900);
    });

    if (frame) {
      frame.addEventListener("load", function () {});
    }
  }

  function loadRegistry() {
    const list = qs("#registryList");
    if (!list) return;
    if (!apiUrl) {
      setNotice("#registryNotice", "Set your Google Apps Script URL in config.js to activate the registry.");
      list.innerHTML = '<div class="card"><p>Once configured, this page will pull live items from your spreadsheet.</p></div>';
      return;
    }

    list.innerHTML = '<div class="card"><p>Loading registry…</p></div>';
    const callbackName = "__registryCallback_" + Math.floor(Math.random() * 1000000);

    jsonp(apiUrl + "?action=registry", callbackName)
      .then((data) => {
        if (!data || data.ok === false) {
          setNotice("#registryNotice", (data && data.error) ? data.error : "Could not load registry.");
          list.innerHTML = "";
          return;
        }
        clearNotice("#registryNotice");
        registryItemsCache = Array.isArray(data.items) ? data.items : [];
        setupRegistryFilters(registryItemsCache);
        renderRegistryItems(registryItemsCache);
      })
      .catch((err) => {
        console.error(err);
        setNotice("#registryNotice", "Could not load registry from your backend. Double-check the deployment URL and Apps Script permissions.");
        list.innerHTML = "";
      });
  }

  function submitClaim(form) {
    if (!apiUrl) return;

    const itemId = (form.querySelector('[name="itemId"]') || {}).value || "";
    const purchasedBy = ((form.querySelector('[name="purchasedBy"]') || {}).value || "").trim();
    const purchaseNote = ((form.querySelector('[name="purchaseNote"]') || {}).value || "").trim();

    if (!purchasedBy) {
      alert("Please enter your name first.");
      return;
    }

    setRegistryButtonState(form, "Saving...", true);
    clearNotice("#registryNotice");

    const claimCallbackName = "__claimCallback_" + Math.floor(Math.random() * 1000000);
    const claimParams = new URLSearchParams({
      action: "claimGift",
      itemId,
      purchasedBy,
      purchaseNote
    }).toString();
    jsonp(apiUrl + "?" + claimParams, claimCallbackName)
      .then((data) => {
        if (!data || data.ok === false) {
          const message = (data && data.error) ? data.error : "Could not mark this item as purchased.";
          setNotice("#registryNotice", message);
          setRegistryButtonState(form, "Mark one as purchased", false);
          return;
        }

        updateLocalRegistryItem(itemId, {
          purchased_count: data.purchased_count,
          quantity: data.quantity,
          purchased: data.purchased,
          purchased_by: data.purchased_by || purchasedBy,
          purchase_note: data.purchase_note || purchaseNote,
          purchased_on: data.purchased_on || ""
        });

        renderRegistryItems(registryItemsCache);
        showToast("Thanks — the registry was updated.");
      })
      .catch((err) => {
        console.error(err);
        setNotice("#registryNotice", "Could not update the registry right now. Please try again.");
        setRegistryButtonState(form, "Mark one as purchased", false);
      });
  }


  function setupCountdown() {
    const el = qs('#countdown');
    if (!el) return;

    const dateStr = window.WEDDING_CONFIG && window.WEDDING_CONFIG.weddingDate;
    if (!dateStr) return;

    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return;

    function tick() {
      const now = new Date();
      const diff = target - now;

      if (diff <= 0) {
        el.textContent = 'Today is the day!';
        return;
      }

      const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      el.innerHTML =
        `<span class="cd-unit"><strong>${days}</strong> days</span>` +
        `<span class="cd-sep">·</span>` +
        `<span class="cd-unit"><strong>${hours}</strong> hrs</span>` +
        `<span class="cd-sep">·</span>` +
        `<span class="cd-unit"><strong>${minutes}</strong> min</span>` +
        `<span class="cd-sep">·</span>` +
        `<span class="cd-unit"><strong>${seconds}</strong> sec</span>`;
    }

    tick();
    setInterval(tick, 1000);
  }

  function boot() {
    setupCountdown();
    setupRSVP();
    loadRegistry();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
