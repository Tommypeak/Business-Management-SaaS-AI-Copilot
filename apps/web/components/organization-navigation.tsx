'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Permission, type PermissionCode, type OrganizationResponse } from '@saas/types';
export function OrganizationNavigation({
  org,
  organizations,
  permissions,
}: {
  org: string;
  organizations: OrganizationResponse[];
  permissions: PermissionCode[];
}) {
  const pathname = usePathname(),
    router = useRouter(),
    [open, setOpen] = useState(false);
  const base = `/app/${org}`;
  const sections = [
    {
      title: 'Workspace',
      items: [
        ['AI Copilot', 'ai', Permission.AI_USE, '✳'],
        ['Dashboard', 'dashboard', Permission.ANALYTICS_VIEW, '◫'],
        ['Sales', 'sales', Permission.SALES_VIEW, '↗'],
        ['Customers', 'customers', Permission.CUSTOMERS_VIEW, '◉'],
        ['Catalog', 'catalog', Permission.CATALOG_VIEW, '▦'],
        ['Inventory', 'inventory', Permission.INVENTORY_VIEW, '▤'],
        ['Purchasing', 'purchasing', Permission.PURCHASING_VIEW, '⇄'],
        ['Suppliers', 'suppliers', Permission.SUPPLIERS_VIEW, '◇'],
        ['Expenses', 'expenses', Permission.EXPENSES_VIEW, '−'],
        ['Accounts Payable', 'accounts-payable', Permission.ACCOUNTS_PAYABLE_VIEW, '≋'],
      ],
    },
    {
      title: 'Analytics',
      items: [
        ['Sales analytics', 'analytics/sales', Permission.ANALYTICS_VIEW, '↗'],
        ['Inventory analytics', 'analytics/inventory', Permission.ANALYTICS_VIEW, '▥'],
        ['Purchasing analytics', 'analytics/purchasing', Permission.ANALYTICS_VIEW, '⇄'],
        ['Finance', 'finance', Permission.FINANCE_VIEW, '◈'],
      ],
    },
    {
      title: 'Organization',
      items: [
        ['Overview', '', Permission.ORGANIZATION_VIEW, '○'],
        ['Locations', 'locations', Permission.LOCATIONS_VIEW, '⌖'],
        ['Settings', 'settings', Permission.ORGANIZATION_UPDATE, '⚙'],
        ['AI Settings', 'ai/settings', Permission.AI_MANAGE, '✧'],
      ],
    },
  ];
  return (
    <aside className="organization-sidebar">
      <div className="sidebar-brand">
        <span className="brand-symbol" aria-hidden="true">
          ✳
        </span>
        <div>
          <strong>Business Management</strong>
          <small>Workspace intelligence</small>
        </div>
      </div>
      <label className="field organization-select">
        <span className="sr-only">Organization</span>
        <select
          aria-label="Organization"
          value={org}
          onChange={(e) => router.push(`/app/${e.target.value}`)}
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="mobile-nav-toggle"
        aria-expanded={open}
        aria-controls="organization-navigation"
        onClick={() => setOpen(!open)}
      >
        ☰ Navigation
      </button>
      <nav
        id="organization-navigation"
        aria-label="Organization pages"
        className={open ? 'is-open' : ''}
      >
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <p>{section.title}</p>
            {section.items
              .filter(
                ([, route, p]) =>
                  permissions.includes(p as PermissionCode) &&
                  (route !== '' || !permissions.includes(Permission.ANALYTICS_VIEW)),
              )
              .map(([label, route, , icon]) => {
                const href = `${base}${route ? '/' + route : ''}`,
                  active = pathname === href || (!!route && pathname.startsWith(href + '/'));
                return (
                  <Link
                    key={route}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span aria-hidden="true">{icon}</span>
                    {label}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="status-dot" />
        Your business, in perspective
      </div>
    </aside>
  );
}
export function ThemeToggle({ initial }: { initial: 'light' | 'dark' }) {
  const [theme, setTheme] = useState(initial);
  return (
    <button
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      onClick={() => {
        const next = theme === 'light' ? 'dark' : 'light';
        setTheme(next);
        const root = document.querySelector<HTMLElement>('.application-root');
        if (root) root.dataset.theme = next;
        document.cookie = `workspace-theme=${next};path=/;max-age=31536000;SameSite=Lax`;
      }}
    >
      {theme === 'light' ? '☾' : '☀'}
      <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
