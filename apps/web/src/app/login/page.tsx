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
        <form className="panel-body grid" action="/api/auth/dev" method="post">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input className="input" id="email" name="email" defaultValue={config.devAuth.email} />
          </div>
          <button className="button" type="submit">Continue</button>
        </form>
      </section>
    </div>
  );
}
