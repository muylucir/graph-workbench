import type { Metadata } from 'next';
import '@cloudscape-design/global-styles/index.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'travel-graph-lab',
  description: 'RDB → Triple 변환 실험실. GraphRAG workbench.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
