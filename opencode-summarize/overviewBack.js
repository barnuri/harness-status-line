// terminal-browser --preload script: a "◀ Back" button and the Escape key quit the browser,
// which hands the pane back to the summarize recap.
const quit = () => globalThis.terminalBrowser?.quit();

window.addEventListener('DOMContentLoaded', () => {
  if (window.top !== window) {
    return;
  }
  const button = document.createElement('button');
  button.textContent = '◀ Back';
  button.title = 'Back to the summarize recap (Esc)';
  button.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;padding:4px 12px;font:600 13px system-ui,sans-serif;border-radius:6px;border:1px solid #888;background:#1f2937;color:#f9fafb;cursor:pointer';
  button.addEventListener('click', quit);
  document.body.append(button);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    quit();
  }
});
