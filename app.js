const $ = (selector) => document.querySelector(selector);
const state = { books: [], user: null, authMode: "register", selectedBook: null, currentOrder: null };
const authDialog = $("#auth-dialog");
const purchaseDialog = $("#purchase-dialog");
const notice = $("#notice");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function money(kes) { return `KSh ${Number(kes || 0).toLocaleString("en-KE")}`; }
function setNotice(message, error = false) {
  notice.textContent = message || "";
  notice.style.color = error ? "#8a3d2d" : "";
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function openAuth(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#auth-eyebrow").textContent = register ? "WELCOME TO YOUR NEXT CHAPTER" : "WELCOME BACK";
  $("#auth-title").textContent = register ? "Join LearnSphere" : "Sign in";
  $("#auth-description").textContent = register ? "Create a free account and receive three introductory books." : "Sign in to access your library and orders.";
  $("#name-field").hidden = !register;
  $("#auth-form [name=name]").required = register;
  $("#auth-form [name=password]").autocomplete = register ? "new-password" : "current-password";
  $("#auth-submit").textContent = register ? "Create free account" : "Sign in";
  $("#auth-switch").innerHTML = register ? 'Already registered? <button type="button" id="switch-login">Sign in</button>' : 'New to LearnSphere? <button type="button" id="switch-register">Join free</button>';
  $("#auth-message").textContent = "";
  authDialog.showModal();
}
document.addEventListener("click", event => {
  if (event.target.id === "switch-login") openAuth("login");
  if (event.target.id === "switch-register") openAuth("register");
});
$("#login-open").addEventListener("click", () => openAuth("login"));
$("#register-open").addEventListener("click", () => openAuth("register"));
$("#hero-join").addEventListener("click", () => openAuth("register"));
$("#auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = { email: form.get("email"), password: form.get("password") };
  if (state.authMode === "register") payload.name = form.get("name");
  const button = $("#auth-submit");
  button.disabled = true;
  $("#auth-message").textContent = "Please wait…";
  try {
    const result = await api(state.authMode === "register" ? "/api/register" : "/api/login", { method: "POST", body: JSON.stringify(payload) });
    state.user = result.user;
    authDialog.close();
    setNotice(result.message || `Welcome${result.user?.name ? `, ${result.user.name}` : ""}.`);
    await loadBooks();
  } catch (error) {
    $("#auth-message").textContent = error.message;
  } finally { button.disabled = false; }
});

async function loadBooks() {
  const params = new URLSearchParams();
  if ($("#search").value.trim()) params.set("q", $("#search").value.trim());
  if ($("#category-filter").value) params.set("category", $("#category-filter").value);
  $("#book-grid").innerHTML = '<p class="muted">Loading library…</p>';
  try {
    state.books = await api(`/api/books?${params.toString()}`);
    const categories = [...new Set(state.books.map(book => book.category))].sort();
    const current = $("#category-filter").value;
    $("#category-filter").innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(current)) $("#category-filter").value = current;
    renderBooks();
  } catch (error) {
    $("#book-grid").innerHTML = `<p class="muted">${escapeHtml(error.message)} Check that the backend is running.</p>`;
  }
}
function renderBooks() {
  if (!state.books.length) {
    $("#book-grid").innerHTML = '<p class="muted">No books matched your search. Try another title or category.</p>';
    return;
  }
  $("#book-grid").innerHTML = state.books.map((book, index) => `
    <article class="book-card">
      <div class="book-cover" style="background:${["#243b32","#3d3430","#2f3b4a","#4b3b25","#353b35"][index % 5]}">
        <span class="cover-initials">KL</span><small>${escapeHtml(book.category)}</small>
      </div>
      <div class="book-body">
        <span class="book-category">${escapeHtml(book.category)}</span>
        <h3>${escapeHtml(book.title)}</h3>
        <div class="book-author">By ${escapeHtml(book.author)}</div>
        <p class="book-description">${escapeHtml(book.description)}</p>
        <div class="book-meta"><span class="book-price">${book.isFree ? "Free" : money(book.priceKes)}</span><span class="book-level">${escapeHtml(book.level)}</span></div>
        <div class="book-actions"><button class="button ${book.isFree ? "button-outline" : "button-gold"}" data-book-id="${book.id}">${book.isFree ? "Get free book" : "Purchase book"}</button></div>
      </div>
    </article>`).join("");
  $("#book-grid").querySelectorAll("[data-book-id]").forEach(button => button.addEventListener("click", () => selectBook(Number(button.dataset.bookId))));
}
async function selectBook(bookId) {
  const book = state.books.find(item => item.id === bookId);
  if (!book) return;
  if (!state.user) return openAuth("login");
  state.selectedBook = book;
  if (book.isFree) {
    try {
      const result = await api("/api/orders", { method: "POST", body: JSON.stringify({ bookId }) });
      setNotice(result.message || "Book added to your library.");
      return;
    } catch (error) {
      if (error.message.includes("already have access")) return setNotice("You already have access. Sign-in library download UI can be added in the next version.");
      setNotice(error.message, true);
      return;
    }
  }
  $("#purchase-title").textContent = book.title;
  $("#purchase-description").textContent = `${money(book.priceKes)} · ${book.category} · ${book.level}`;
  $("#purchase-message").textContent = "";
  state.currentOrder = null;
  try {
    const order = await api("/api/orders", { method: "POST", body: JSON.stringify({ bookId }) });
    state.currentOrder = order;
    purchaseDialog.showModal();
  } catch (error) { setNotice(error.message, true); }
}
$("#book-grid").addEventListener("click", event => {
  const button = event.target.closest("[data-book-id]");
  if (button) selectBook(Number(button.dataset.bookId));
});
$("#stk-button").addEventListener("click", async () => {
  if (!state.currentOrder) return;
  const button = $("#stk-button"); button.disabled = true;
  $("#purchase-message").textContent = "Requesting payment prompt…";
  try {
    const result = await api("/api/payments/mpesa/stk", { method: "POST", body: JSON.stringify({ orderId: state.currentOrder.orderId, phone: $("#mpesa-phone").value }) });
    $("#purchase-message").textContent = result.message || "Payment request sent. Wait for verified confirmation.";
  } catch (error) { $("#purchase-message").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#manual-button").addEventListener("click", async () => {
  if (!state.currentOrder) return;
  const reference = $("#manual-reference").value.trim();
  const button = $("#manual-button"); button.disabled = true;
  try {
    const result = await api("/api/payments/manual", { method: "POST", body: JSON.stringify({ orderId: state.currentOrder.orderId, transactionReference: reference }) });
    $("#purchase-message").textContent = result.message;
  } catch (error) { $("#purchase-message").textContent = error.message; }
  finally { button.disabled = false; }
});
let searchTimer;
$("#search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadBooks, 250); });
$("#category-filter").addEventListener("change", loadBooks);
document.querySelectorAll(".category-card").forEach(button => button.addEventListener("click", () => {
  const map = { Biology: "Biology", Geography: "Geography", Motivation: "Motivation", Inspirational: "Inspirational", Technology: "Technology", Agriculture: "Agriculture" };
  $("#search").value = "";
  $("#category-filter").value = map[button.dataset.category] || "";
  loadBooks();
  $("#library").scrollIntoView({ behavior: "smooth" });
}));
$("#year").textContent = new Date().getFullYear();
(async function init() {
  try {
    const me = await api("/api/me");
    state.user = me.user;
    $("#login-open").textContent = "Account";
  } catch {}
  await loadBooks();
})();
