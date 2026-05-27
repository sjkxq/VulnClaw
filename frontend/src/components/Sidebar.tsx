export interface NavItem<T extends string> {
  key: T;
  label: string;
  description: string;
  icon: string;
}

interface SidebarProps<T extends string> {
  activeView: T;
  nav: NavItem<T>[];
  onSelectView: (view: T) => void;
}

export function Sidebar<T extends string>({ activeView, nav, onSelectView }: SidebarProps<T>) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-badge">VC</div>
        <div>
          <div className="brand-kicker">VulnClaw</div>
          <h1>安全测试助手</h1>
          <p>授权范围内的风险检查与报告</p>
        </div>
      </div>

      <nav className="nav-list" aria-label="主导航">
        {nav.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${activeView === item.key ? "active" : ""}`}
            onClick={() => onSelectView(item.key)}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span>Web Console</span>
        <strong>ToC Preview</strong>
      </div>
    </aside>
  );
}
