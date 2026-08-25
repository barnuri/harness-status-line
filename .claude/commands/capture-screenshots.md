# capture-screenshots

Regenerate all preview images and the animated GIF for the README.

## Steps

1. Run `bun run scripts/preview.ts` → `docs/preview.html`
2. Run `bun run scripts/animated-preview.ts` → `docs/animated.html`
3. Start a local HTTP server on port 7823 serving the `docs/` directory:
   ```bash
   bun --eval "Bun.serve({port:7823, fetch(r){return new Response(Bun.file('/Users/barnu/sandbox/private/harness-status-line/docs'+new URL(r.url).pathname),{headers:{'Content-Type':'text/html'}})}})" &
   ```
4. Use Playwright MCP to navigate to `http://localhost:7823/preview.html`.
5. Take a full-page screenshot → `docs/screenshot-all-scenarios.png`.
6. Screenshot each `.scenario:nth-child(N)` element:
   - `docs/frame-0-healthy.png` (nth-child 2)
   - `docs/frame-1-warning.png` (nth-child 3)
   - `docs/frame-2-critical.png` (nth-child 4)
   - `docs/frame-3-wrapped.png` (nth-child 5)
7. Navigate to `http://localhost:7823/animated.html` → screenshot `docs/screenshot-animated-frame.png`.
8. Kill the HTTP server.
9. Run `bun run scripts/make-gif.ts` to combine the 4 frames into `docs/demo.gif`.
10. Verify all files exist in `docs/`.
11. Remind the user to commit `docs/` and push to GitHub to update README images.

## Shortcut

```bash
# Regenerates HTML + GIF (does not retake Playwright screenshots)
bun run capture
```
