'use client';

import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

/**
 * Full-article styles — larger type than the chat bubble `MarkdownStream`.
 * Designed for reading a ~300-line onboarding document end-to-end.
 */
const components: Components = {
  h1: (p) => (
    <h1
      style={{
        fontSize: 28,
        fontWeight: 700,
        margin: '28px 0 12px',
        borderBottom: '2px solid #e9ebed',
        paddingBottom: 8,
      }}
      {...p}
    />
  ),
  h2: (p) => (
    <h2
      style={{
        fontSize: 22,
        fontWeight: 700,
        margin: '26px 0 10px',
        color: '#16191f',
      }}
      {...p}
    />
  ),
  h3: (p) => (
    <h3 style={{ fontSize: 18, fontWeight: 600, margin: '20px 0 8px' }} {...p} />
  ),
  h4: (p) => (
    <h4 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 6px' }} {...p} />
  ),
  p: (p) => <p style={{ margin: '10px 0', lineHeight: 1.7, fontSize: 15 }} {...p} />,
  ul: (p) => <ul style={{ margin: '8px 0 8px 24px', padding: 0, lineHeight: 1.7 }} {...p} />,
  ol: (p) => <ol style={{ margin: '8px 0 8px 24px', padding: 0, lineHeight: 1.7 }} {...p} />,
  li: (p) => <li style={{ margin: '4px 0', fontSize: 15 }} {...p} />,
  a: (p) => (
    <a
      style={{ color: '#0972d3', textDecoration: 'underline' }}
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote
      style={{
        borderLeft: '4px solid #b0bec5',
        margin: '12px 0',
        padding: '6px 14px',
        background: '#f8f9fa',
        color: '#37474f',
        fontSize: 15,
      }}
      {...p}
    />
  ),
  hr: () => (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid #e9ebed',
        margin: '24px 0',
      }}
    />
  ),
  table: (p) => (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: 14,
          width: '100%',
        }}
        {...p}
      />
    </div>
  ),
  th: (p) => (
    <th
      style={{
        border: '1px solid #d5dbdb',
        padding: '8px 12px',
        background: '#f2f3f3',
        textAlign: 'left',
        fontWeight: 700,
      }}
      {...p}
    />
  ),
  td: (p) => (
    <td
      style={{
        border: '1px solid #d5dbdb',
        padding: '8px 12px',
        verticalAlign: 'top',
      }}
      {...p}
    />
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className || '');
    if (isBlock) {
      return (
        <pre
          style={{
            background: '#272b33',
            color: '#f8f8f2',
            padding: '14px 16px',
            borderRadius: 8,
            overflowX: 'auto',
            fontSize: 13,
            lineHeight: 1.6,
            margin: '12px 0',
          }}
        >
          <code {...rest}>{children}</code>
        </pre>
      );
    }
    return (
      <code
        style={{
          background: '#eef1f3',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 13.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
        {...rest}
      >
        {children}
      </code>
    );
  },
  strong: (p) => <strong style={{ fontWeight: 700 }} {...p} />,
  em: (p) => <em style={{ fontStyle: 'italic' }} {...p} />,
};

export default function TripleDocView({
  markdown,
  error,
}: {
  markdown: string;
  error: string | null;
}) {
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description='RDB를 Neptune에 "트리플"로 올린다는 것의 의미 — 처음 보는 사람을 위한 온보딩'
        >
          RDB → 트리플 변환 개념
        </Header>
      }
    >
      {error ? (
        <Alert type="error" header="문서를 불러올 수 없습니다">
          {error}
        </Alert>
      ) : (
        <Container>
          <Box padding="m">
            <div style={{ maxWidth: 880, margin: '0 auto' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {markdown}
              </ReactMarkdown>
            </div>
          </Box>
        </Container>
      )}
    </ContentLayout>
  );
}
