import { getConfig } from "@/lib/runtime";

export default function LoginPage() {
  const config = getConfig();
  return (
    <div className="login-page">
      <section className="panel login-panel">
        <div className="panel-header">
          <h1 className="panel-title">Sign in</h1>
          {config.allowDevAuth ? <span className="badge warn">Development auth</span> : null}
        </div>
        <div className="panel-body grid">
          {config.oidc?.enabled ? <a className="button" href="/api/auth/oidc/start">Continue with SSO</a> : null}
          {config.allowDevAuth ? (
            <form className="grid" action="/api/auth/dev" method="post">
              <div className="field">
                <label htmlFor="email">Email</label>
                <input className="input" id="email" name="email" defaultValue={config.devAuth.email} />
              </div>
              <button className="button" type="submit">Continue</button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
