/**
 * Gallivanter CRM landing page.
 * Design language: warm cream background, coral accent, deep teal,
 * DM Sans body + DM Serif Display headings.
 */
// Sign-in goes through the Worker; returning users skip straight to the app.
import "./landing.css";

export function LandingPage() {
  const login = () => { window.location.href = "/api/auth/google?next=/app"; };
  const checking = false;

  return (
    <div className="lp-page">
      {/* ── Nav ── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#top" onClick={(e) => e.preventDefault()}>
            <span className="lp-brand-mark">G</span>
            <span className="lp-brand-name">Gallivanter CRM</span>
          </a>
          <nav className="lp-nav-links" aria-label="Landing navigation">
            <a href="#how">How it works</a>
            <a href="#ai">AI</a>
            <a href="#mcp">Claude MCP</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={login} type="button">
            Log in with Google
          </button>
        </div>
      </header>

      <main id="top">
        {/* ── Hero ── */}
        <section className="lp-hero">
          <div className="lp-hero-inner">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">AI-driven CRM · also fully manual</p>
              <h1 className="lp-h1">The CRM you run by hand, by voice, or by AI</h1>
              <p className="lp-lede">
                Manage leads, deals and tasks the classic way, or let the built-in AI and your own
                tools, including Claude, do the work. Sign in with Google, then optionally store
                everything in your own Google Drive.
              </p>
              <div className="lp-hero-actions">
                <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={login} type="button">
                  Continue with Google
                </button>
                {checking ? <span className="lp-checking">Checking connection…</span> : null}
              </div>
              <p className="lp-fineprint">Free to start · No separate database to set up</p>
            </div>

            <div className="lp-hero-visual" aria-hidden="true">
              <div className="lp-mock">
                <div className="lp-mock-head">
                  <span className="lp-mock-title">Leads</span>
                  <span className="lp-mock-pill">+ New</span>
                </div>
                <div className="lp-mock-row">
                  <span className="lp-mock-dot" />
                  <div>
                    <strong>Asha Rao · Qualified</strong>
                    <span>Northwind Ltd · Proposal sent</span>
                  </div>
                </div>
                <div className="lp-mock-row">
                  <span className="lp-mock-dot lp-mock-dot-warn" />
                  <div>
                    <strong>Kiran Das · Follow up Friday</strong>
                    <span>Voice task created by AI</span>
                  </div>
                </div>
                <div className="lp-mock-voice">
                  <span className="lp-mock-mic">🎙</span>
                  <p>“Add a follow-up with Kiran on Friday and draft the email.”</p>
                  <span className="lp-mock-done">Done: task created, draft ready.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="lp-works-with">
            <span className="lp-works-label">Works with</span>
            <ul>
              <li>Google Sign-in</li>
              <li>Google Drive</li>
              <li>Claude (MCP)</li>
              <li>Cloudflare Workers</li>
              <li>Any AI model</li>
            </ul>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="lp-section" id="how">
          <h2 className="lp-h2">Up and running in three steps</h2>
          <p className="lp-section-sub">No server to deploy and no database to manage.</p>
          <div className="lp-grid-3">
            <div className="lp-card">
              <span className="lp-step-num">1</span>
              <h3>Log in with Google</h3>
              <p>One click sign-in. Your session stays secure so you don't have to log in again and again.</p>
            </div>
            <div className="lp-card">
              <span className="lp-step-num">2</span>
              <h3>Connect Google Drive (optional)</h3>
              <p>Use your Drive as the database. Your CRM lives in a file you own. Skip it and data stays on your device.</p>
            </div>
            <div className="lp-card">
              <span className="lp-step-num">3</span>
              <h3>Work your way</h3>
              <p>Click through it manually, talk to it, or hand tasks to the built-in AI or your connected tools.</p>
            </div>
          </div>
        </section>

        {/* ── CRM features ── */}
        <section className="lp-section lp-section-tint">
          <h2 className="lp-h2">A complete CRM, not just a contact list</h2>
          <p className="lp-section-sub">
            Everything you need to run the full sales cycle, with custom fields, views and filters.
          </p>
          <div className="lp-grid-3">
            <div className="lp-feature">
              <h3>Leads, contacts and accounts</h3>
              <p>Full create, edit and delete with custom fields, saved views and filters.</p>
            </div>
            <div className="lp-feature">
              <h3>Deals, campaigns and products</h3>
              <p>Track the pipeline from first touch to close.</p>
            </div>
            <div className="lp-feature">
              <h3>Quotes, orders and invoices</h3>
              <p>Price books, sales orders, purchase orders, invoices and vendors.</p>
            </div>
            <div className="lp-feature">
              <h3>Tasks, meetings and calls</h3>
              <p>Activities and follow-ups on one timeline.</p>
            </div>
            <div className="lp-feature">
              <h3>Cases and solutions</h3>
              <p>Handle support alongside sales.</p>
            </div>
            <div className="lp-feature">
              <h3>Reports and dashboards</h3>
              <p>Saved reports and widgets that summarize your data.</p>
            </div>
          </div>
        </section>

        {/* ── AI ── */}
        <section className="lp-section" id="ai">
          <h2 className="lp-h2">AI built in, and your choice of model</h2>
          <p className="lp-section-sub">A native assistant that can work the CRM for you. It isn't tied to one provider.</p>
          <div className="lp-grid-2">
            <div className="lp-feature">
              <h3>Any model, with instructions</h3>
              <p>Plug in the model you prefer. Proper system instructions keep it focused on your CRM.</p>
            </div>
            <div className="lp-feature">
              <h3>Free-model management</h3>
              <p>A routing layer can use the free AI models available to power the native features.</p>
            </div>
            <div className="lp-feature">
              <h3>Voice mode</h3>
              <p>Speak to your CRM. Speech is transcribed with Whisper on Cloudflare, then acted on.</p>
            </div>
            <div className="lp-feature">
              <h3>Manual always works</h3>
              <p>Every action is available without AI, so nothing depends on it.</p>
            </div>
          </div>
        </section>

        {/* ── Claude MCP ── */}
        <section className="lp-section lp-section-dark" id="mcp">
          <h2 className="lp-h2 lp-h2-light">Bring Claude into your CRM</h2>
          <p className="lp-section-sub lp-sub-light">
            Gallivanter runs as an MCP server on Cloudflare Workers. Connect it to Claude and Claude
            can use the CRM's tools alongside its own, so one conversation can research a lead,
            update the deal and schedule the follow-up.
          </p>
          <div className="lp-mcp-demo" aria-hidden="true">
            <div className="lp-mcp-line">
              <span className="lp-mcp-you">You</span>
              <p>“Find leads quiet for 30 days and draft check-ins.”</p>
            </div>
            <div className="lp-mcp-line lp-mcp-line-tools">
              <code>crm.search_leads</code>
              <code>crm.create_task</code>
            </div>
            <div className="lp-mcp-line">
              <span className="lp-mcp-claude">Claude</span>
              <p>4 drafts ready for review.</p>
            </div>
          </div>
          <div className="lp-center">
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={login} type="button">
              Continue with Google
            </button>
          </div>
        </section>

        {/* ── Data ownership ── */}
        <section className="lp-section">
          <h2 className="lp-h2">Your data stays yours</h2>
          <p className="lp-section-sub">
            The whole workspace is one file in your own Google Drive. No vendor database holds your
            customers, and you can export or move it any time.
          </p>
          <div className="lp-grid-3">
            <div className="lp-feature">
              <h3>Drive as database</h3>
              <p>Connect after login, only if you want.</p>
            </div>
            <div className="lp-feature">
              <h3>Mobile-first PWA</h3>
              <p>Install on your phone with a touch-friendly layout and offline support.</p>
            </div>
            <div className="lp-feature">
              <h3>Desktop ready</h3>
              <p>Also available as a desktop app.</p>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="lp-section lp-section-tint" id="faq">
          <h2 className="lp-h2">Frequently Asked Questions</h2>
          <div className="lp-faq">
            <details>
              <summary>Do I have to connect Google Drive?</summary>
              <p>No. You log in with Google first. Connecting Drive as your database is optional, and without it data is kept locally.</p>
            </details>
            <details>
              <summary>Can I use it without AI?</summary>
              <p>Yes. Every CRM function works manually. AI and voice are additions.</p>
            </details>
            <details>
              <summary>Which AI models can I use?</summary>
              <p>The native assistant can work with different models, and you can connect outside AI tools such as Claude through MCP.</p>
            </details>
            <details>
              <summary>How does voice mode work?</summary>
              <p>Your speech is transcribed with Whisper running on Cloudflare and then handled like any other command.</p>
            </details>
            <details>
              <summary>Can Claude use my CRM?</summary>
              <p>Yes. Add Gallivanter as an MCP server and Claude can call its CRM tools together with its own.</p>
            </details>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="lp-section lp-cta">
          <h2 className="lp-h2">Start your CRM in one click</h2>
          <p className="lp-section-sub">Log in with Google and add Drive whenever you're ready.</p>
          <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={login} type="button">
            Continue with Google
          </button>
        </section>
      </main>

      <footer className="lp-footer">
        <p>© 2026 Gallivanter CRM · <a href="#top">Privacy</a> · <a href="#top">Terms</a></p>
      </footer>
    </div>
  );
}
