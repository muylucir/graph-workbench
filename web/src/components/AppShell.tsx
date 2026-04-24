'use client';

import { usePathname, useRouter } from 'next/navigation';
import AppLayout from '@cloudscape-design/components/app-layout';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';

const NAV = [
  { type: 'link' as const, text: 'Home', href: '/' },
  { type: 'link' as const, text: 'RDB → 트리플 개념', href: '/triple' },
  { type: 'link' as const, text: 'RDB Viewer', href: '/rdb' },
  { type: 'divider' as const },
  { type: 'link' as const, text: 'Slot A', href: '/slot/A' },
  { type: 'link' as const, text: 'Slot B', href: '/slot/B' },
  { type: 'link' as const, text: 'Slot C', href: '/slot/C' },
  { type: 'divider' as const },
  { type: 'link' as const, text: 'Compare', href: '/compare' },
  { type: 'link' as const, text: 'Questionnaire', href: '/questionnaire' },
  { type: 'link' as const, text: 'Cypher Console', href: '/cypher' },
  { type: 'link' as const, text: 'NL Chat (Agent)', href: '/chat' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const items: Array<{ text: string; href: string }> = [{ text: 'travel-graph-lab', href: '/' }];
  if (pathname === '/triple') items.push({ text: 'RDB → 트리플 개념', href: '/triple' });
  if (pathname === '/rdb') items.push({ text: 'RDB Viewer', href: '/rdb' });
  if (pathname?.startsWith('/slot/')) {
    const s = pathname.split('/')[2];
    items.push({ text: `Slot ${s}`, href: pathname });
  }
  if (pathname === '/compare') items.push({ text: 'Compare', href: '/compare' });
  if (pathname === '/questionnaire') items.push({ text: 'Questionnaire', href: '/questionnaire' });
  if (pathname === '/cypher') items.push({ text: 'Cypher Console', href: '/cypher' });
  if (pathname === '/chat') items.push({ text: 'NL Chat', href: '/chat' });

  return (
    <>
      <TopNavigation
        identity={{ href: '/', title: 'travel-graph-lab' }}
        utilities={[
          { type: 'button', text: 'V0.5 MVP', iconName: 'status-info', disableUtilityCollapse: true },
        ]}
      />
      <AppLayout
        toolsHide
        navigation={
          <SideNavigation
            activeHref={pathname}
            header={{ text: 'Workbench', href: '/' }}
            items={NAV}
            onFollow={(e) => {
              if (!e.detail.external) {
                e.preventDefault();
                router.push(e.detail.href);
              }
            }}
          />
        }
        breadcrumbs={
          <BreadcrumbGroup
            items={items}
            onFollow={(e) => {
              e.preventDefault();
              router.push(e.detail.href);
            }}
          />
        }
        content={children}
      />
    </>
  );
}
