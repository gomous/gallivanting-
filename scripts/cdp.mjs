// Live browser test/probe transport. No remote page scripts are saved or executed locally.
export async function connectPage(targetId, expectedOrigin, endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222") {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("CDP endpoint must be literal loopback HTTP.");
  const targets = await (await fetch(new URL("/json/list", url))).json();
  const target = targets.find((item) => targetId ? item.id === targetId : item.type === "page" && new URL(item.url).origin === expectedOrigin);
  if (!target || new URL(target.url).origin !== expectedOrigin) throw new Error("Selected live page is unavailable or has changed origin.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  let sequence = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id);
      if (call) { clearTimeout(call.timer); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
    } else for (const listener of listeners) listener(message);
  };
  socket.onclose = () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("CDP disconnected")); } pending.clear(); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const waitFor = async (fn, timeout = 20000, ...args) => {
    const start = Date.now();
    do { if (await evaluate(fn, ...args)) return; await new Promise((resolve) => setTimeout(resolve, 250)); } while (Date.now() - start < timeout);
    throw new Error("Expected page state did not appear before timeout");
  };
  return { target, send, evaluate, waitFor, onEvent: (listener) => listeners.add(listener), close: () => socket.close() };
}

export function controlsSnapshot() {
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  };
  const text = (node) => (node.innerText ?? node.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    url: location.href, title: document.title,
    controls: Array.from(document.querySelectorAll("button,a,[role=button],[role=menuitem],lyte-button,lyte-menu-item,lyte-dropdown,[data-zcqa],[role=option]"))
      .filter(visible).map((node) => ({ tag: node.tagName, role: node.getAttribute("role"), text: text(node), label: node.getAttribute("aria-label"), title: node.getAttribute("title"), qa: node.getAttribute("data-zcqa"), id: node.id, href: node.getAttribute("href") })),
    forms: Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea")).filter(visible)
      .map((node) => ({ tag: node.tagName, type: node.type, label: node.getAttribute("aria-label"), name: node.name, placeholder: node.getAttribute("placeholder"), required: node.required || node.getAttribute("aria-required") === "true" })),
  };
}
